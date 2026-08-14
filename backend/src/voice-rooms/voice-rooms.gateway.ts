import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth/auth.service';
import { VoiceRoomsService, VoiceRoomParticipant } from './voice-rooms.service';
import { PrismaService } from '../prisma/prisma.service';

// Dedicated namespace, separate socket connection from the main app
// gateway (roadpilot.gateway.ts) — voice rooms are an independent,
// additive feature and this keeps its connection lifecycle, auth
// handshake, and event names from ever colliding with existing
// real-time features (friend locations, group chat, 1:1 voice calls).
@WebSocketGateway({
  cors: {
    origin: function (origin: string, callback: (err: Error | null, allow?: boolean) => void) {
      const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000').split(',');
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  },
  namespace: '/voice',
  transports: ['websocket', 'polling'],
})
export class VoiceRoomsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(VoiceRoomsGateway.name);
  // socketId -> authenticated user, populated by the namespace middleware
  // below (afterInit) before the connection handshake ever completes. Every
  // handler below re-reads from this map rather than trusting a
  // client-supplied userId, so a socket can never act as anyone else.
  private readonly connectedUsers = new Map<string, { userId: string; displayName: string; avatar?: string | null }>();

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private authService: AuthService,
    private voiceRoomsService: VoiceRoomsService,
    private prisma: PrismaService,
  ) {}

  // Socket.IO namespace middleware runs as part of the connection handshake
  // itself — the client's 'connect' event (and therefore its first emitted
  // message, e.g. room:join) can only fire *after* this resolves. Doing the
  // JWT verify + DB lookup here (instead of in handleConnection) closes a
  // race where a client emits room:join immediately after connecting, before
  // an async handleConnection had finished populating connectedUsers, and
  // got wrongly rejected as Unauthorized.
  afterInit(server: Server) {
    server.use(async (client: Socket, next: (err?: Error) => void) => {
      try {
        const token =
          client.handshake.auth?.token ||
          client.handshake.headers?.authorization?.replace('Bearer ', '');
        if (!token) return next(new Error('Unauthorized'));

        const payload = this.jwtService.verify(token, { secret: this.configService.get('JWT_SECRET') });
        const user = await this.authService.validateJwtPayload(payload);
        if (!user) return next(new Error('Unauthorized'));

        this.connectedUsers.set(client.id, {
          userId: user.id,
          displayName: user.displayName || user.username || 'User',
          avatar: user.avatar,
        });
        next();
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Unauthorized voice connection from ${client.id}: ${msg}`);
        next(new Error('Unauthorized'));
      }
    });

    // Live participant counts are in-memory only (see voice-rooms.service.ts)
    // and every restart/redeploy starts that Map empty — any room whose last
    // participant left via a clean disconnect gets closed automatically now
    // (closeRoomIfEmpty), but rooms are per-call sessions the frontend
    // creates fresh on every "start call" rather than reusable channels, so
    // one that was live across a restart has no participants left to
    // reconnect anyway. Sweep isActive rooms once at boot so a redeploy
    // doesn't leave them stuck "active" with a permanent 0/N forever.
    this.prisma.voiceRoom.updateMany({ where: { isActive: true }, data: { isActive: false } })
      .then(({ count }) => { if (count) this.logger.log(`Closed ${count} stale voice room(s) left active from before this boot`); })
      .catch((err) => this.logger.warn(`Startup voice room sweep failed: ${(err as Error).message}`));
  }

  handleConnection(client: Socket) {
    const user = this.connectedUsers.get(client.id);
    this.logger.log(`Voice socket connected: ${client.id} (user: ${user?.userId})`);
  }

  async handleDisconnect(client: Socket) {
    this.connectedUsers.delete(client.id);
    await this.leaveCurrentRoom(client);
  }

  @SubscribeMessage('room:join')
  async handleJoin(@ConnectedSocket() client: Socket, @MessageBody() data: { roomId: string }) {
    const user = this.connectedUsers.get(client.id);
    if (!user || !data?.roomId) return { error: 'Unauthorized' };

    // A client can be mid-reconnect or switching rooms — always drop any
    // previous membership first so a stale entry (and its socket.io room
    // subscription) never lingers under a new roomId.
    await this.leaveCurrentRoom(client);

    const room = await this.prisma.voiceRoom.findUnique({ where: { id: data.roomId } });
    if (!room || !room.isActive) return { error: 'Room not found' };

    // A group-linked room is only discoverable through that group's chat
    // (excluded from the public listActiveRooms directory), but the join
    // event itself has no membership check without this — anyone who
    // learned the roomId (e.g. from a screenshot, or by joining the group
    // briefly and then leaving/being kicked) could still connect directly.
    if (room.groupId) {
      const member = await this.prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId: room.groupId, userId: user.userId } },
      });
      if (!member || member.isBanned) return { error: 'Not a member of this group' };
    }

    const participant: VoiceRoomParticipant = {
      socketId: client.id,
      userId: user.userId,
      displayName: user.displayName,
      avatar: user.avatar,
      micEnabled: false,
      isSpeaking: false,
      joinedAt: Date.now(),
    };

    let participants: VoiceRoomParticipant[];
    try {
      participants = this.voiceRoomsService.addParticipant(data.roomId, participant, room.maxParticipants);
    } catch {
      return { error: 'Room is full' };
    }

    client.join(`voice:${data.roomId}`);

    // Existing members never proactively offer to a newcomer — only the
    // newcomer initiates an RTCPeerConnection + offer to each existing
    // participant. This one-directional rule is what avoids "offer glare"
    // (both sides creating simultaneous offers) without needing a full
    // perfect-negotiation implementation for what's still a fairly small
    // mesh (a handful of participants per room).
    client.to(`voice:${data.roomId}`).emit('room:user-joined', participant);

    this.logger.log(`User ${user.userId} joined voice room ${data.roomId}`);
    return { participants: participants.filter((p) => p.socketId !== client.id) };
  }

  @SubscribeMessage('room:leave')
  async handleLeave(@ConnectedSocket() client: Socket) {
    await this.leaveCurrentRoom(client);
  }

  // Closing a room (VoiceRoomsController#close) only ever flipped isActive
  // in the DB — it never touched anyone already connected, so a "closed"
  // room kept its live call running indefinitely with no way for the owner
  // to actually end it.
  evictRoom(roomId: string) {
    const room = `voice:${roomId}`;
    this.server.to(room).emit('room:closed');
    this.server.in(room).fetchSockets().then((sockets) => {
      for (const s of sockets) {
        this.leaveCurrentRoom(s as unknown as Socket);
        s.disconnect(true);
      }
    }).catch(() => {});
  }

  private async leaveCurrentRoom(client: Socket) {
    const result = this.voiceRoomsService.removeParticipant(client.id);
    if (!result) return;
    const { roomId, participant } = result;
    client.leave(`voice:${roomId}`);
    this.server.to(`voice:${roomId}`).emit('room:user-left', { userId: participant.userId, socketId: client.id });
    this.logger.log(`User ${participant.userId} left voice room ${roomId}`);
    try {
      await this.voiceRoomsService.closeRoomIfEmpty(roomId);
    } catch (err) {
      this.logger.warn(`Failed to auto-close empty room ${roomId}: ${(err as Error).message}`);
    }
  }

  // ── WebRTC signaling relay ──────────────────────────────────────────
  // The gateway never inspects or terminates SDP/ICE payloads — it only
  // relays them to the intended peer's socket, scoped to sockets that are
  // both actually in the same room, so a client can't use these events to
  // probe/signal an arbitrary socket it was never introduced to.

  @SubscribeMessage('webrtc:offer')
  handleOffer(@ConnectedSocket() client: Socket, @MessageBody() data: { targetSocketId: string; sdp: RTCSessionDescriptionInit }) {
    this.relay(client, data.targetSocketId, 'webrtc:offer', { sdp: data.sdp });
  }

  @SubscribeMessage('webrtc:answer')
  handleAnswer(@ConnectedSocket() client: Socket, @MessageBody() data: { targetSocketId: string; sdp: RTCSessionDescriptionInit }) {
    this.relay(client, data.targetSocketId, 'webrtc:answer', { sdp: data.sdp });
  }

  @SubscribeMessage('webrtc:ice-candidate')
  handleIceCandidate(@ConnectedSocket() client: Socket, @MessageBody() data: { targetSocketId: string; candidate: RTCIceCandidateInit }) {
    this.relay(client, data.targetSocketId, 'webrtc:ice-candidate', { candidate: data.candidate });
  }

  private relay(client: Socket, targetSocketId: string, event: string, payload: object) {
    const user = this.connectedUsers.get(client.id);
    if (!user || !targetSocketId) return;
    const roomId = this.voiceRoomsService.getRoomForSocket(client.id);
    if (!roomId || this.voiceRoomsService.getRoomForSocket(targetSocketId) !== roomId) return;

    this.server.to(targetSocketId).emit(event, { fromSocketId: client.id, fromUserId: user.userId, ...payload });
  }

  // ── Push-to-talk state ───────────────────────────────────────────────

  @SubscribeMessage('ptt:start')
  handlePttStart(@ConnectedSocket() client: Socket) {
    this.broadcastSpeaking(client, true);
  }

  @SubscribeMessage('ptt:stop')
  handlePttStop(@ConnectedSocket() client: Socket) {
    this.broadcastSpeaking(client, false);
  }

  private broadcastSpeaking(client: Socket, isSpeaking: boolean) {
    const roomId = this.voiceRoomsService.getRoomForSocket(client.id);
    if (!roomId) return;
    const participant = this.voiceRoomsService.setSpeaking(roomId, client.id, isSpeaking);
    if (!participant) return;
    this.server.to(`voice:${roomId}`).emit('room:user-speaking', { userId: participant.userId, socketId: client.id, isSpeaking });
  }

  @SubscribeMessage('mic:state')
  handleMicState(@ConnectedSocket() client: Socket, @MessageBody() data: { micEnabled: boolean }) {
    const roomId = this.voiceRoomsService.getRoomForSocket(client.id);
    if (!roomId) return;
    const participant = this.voiceRoomsService.setMicEnabled(roomId, client.id, !!data?.micEnabled);
    if (!participant) return;
    this.server.to(`voice:${roomId}`).emit('room:user-mic-state', { userId: participant.userId, socketId: client.id, micEnabled: participant.micEnabled });
  }
}
