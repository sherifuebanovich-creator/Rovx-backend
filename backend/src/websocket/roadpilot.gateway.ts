import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { GatewayService } from './gateway.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { AuthService } from '../auth/auth.service';

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
  namespace: '/',
  transports: ['websocket', 'polling'],
})
export class RovxGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(RovxGateway.name);
  private readonly connectedUsers = new Map<string, string>();
  private readonly userConnections = new Map<string, Set<string>>();
  private readonly USER_ONLINE_TTL = 1800;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private gatewayService: GatewayService,
    private prisma: PrismaService,
    private redis: RedisService,
    private authService: AuthService,
  ) {}

  afterInit(server: Server) {
    this.gatewayService.setServer(server);
    this.logger.log('WebSocket Gateway initialized');
    this.cleanupInterval = setInterval(() => this.cleanupStaleOnlineUsers(), 600_000);
  }

  onModuleDestroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  async handleConnection(client: Socket) {
    try {
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        client.disconnect(true);
        return;
      }

      const payload = this.jwtService.verify(token, {
        secret: this.configService.get('JWT_SECRET'),
      });

      const user = await this.authService.validateJwtPayload(payload);
      if (!user) {
        this.logger.warn(`Rejected connection for ${client.id}: token blacklisted or user banned/inactive`);
        client.disconnect(true);
        return;
      }

      // validateJwtPayload is a DB round-trip — if the client disconnected
      // while we were awaiting it, handleDisconnect already ran and found
      // nothing (connectedUsers wasn't populated yet), so it was a no-op.
      // Registering this now-dead socket anyway would leak a phantom entry
      // that never gets cleaned up, and (on first connection) mark the user
      // online in Redis for a connection that no longer exists.
      if (!client.connected) {
        this.logger.debug(`Client ${client.id} disconnected during auth, skipping registration`);
        return;
      }

      const userId = payload.sub;
      this.connectedUsers.set(client.id, userId);
      (client as any).userId = userId;

      let conns = this.userConnections.get(userId);
      const isFirstConnection = !conns || conns.size === 0;
      if (!conns) {
        conns = new Set();
        this.userConnections.set(userId, conns);
      }
      conns.add(client.id);

      client.join(`user:${userId}`);

      if (isFirstConnection) {
        await this.redis.sadd('online:users', userId);
        await this.redis.set(`online:ts:${userId}`, Date.now().toString(), this.USER_ONLINE_TTL);
        await this.notifyFriendsOnlineStatus(userId, true);
      }

      await this.redis.set(`socket:${userId}:${client.id}`, '1', 86400);

      this.logger.log(`Client connected: ${client.id} (user: ${userId}, connections: ${conns.size})`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Unauthorized connection attempt from ${client.id}: ${msg}`);
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: Socket) {
    const userId = this.connectedUsers.get(client.id);
    if (userId) {
      this.connectedUsers.delete(client.id);

      const conns = this.userConnections.get(userId);
      if (conns) {
        conns.delete(client.id);
      }

      try {
        await this.redis.del(`socket:${userId}:${client.id}`);

        if (!conns || conns.size === 0) {
          this.userConnections.delete(userId);
          await this.redis.srem('online:users', userId);
          await this.redis.del(`online:ts:${userId}`);
          await this.notifyFriendsOnlineStatus(userId, false);
        }
      } catch (err) {
        this.logger.warn(`Redis cleanup failed for ${client.id}: ${(err as Error).message}`);
      }
    }
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('location:update')
  async handleLocationUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { lat: number; lng: number; speed?: number; heading?: number },
  ) {
    const userId = this.connectedUsers.get(client.id);
    if (!userId) return;

    if (typeof data?.lat !== 'number' || typeof data?.lng !== 'number' ||
        !isFinite(data.lat) || !isFinite(data.lng) ||
        data.lat < -90 || data.lat > 90 || data.lng < -180 || data.lng > 180) {
      return;
    }

    const sanitized = {
      lat: data.lat,
      lng: data.lng,
      speed: typeof data.speed === 'number' && isFinite(data.speed) ? Math.max(0, data.speed) : undefined,
      heading: typeof data.heading === 'number' && isFinite(data.heading)
        ? ((data.heading % 360) + 360) % 360
        : undefined,
    };

    try {
      await this.redis.set(
        `location:${userId}`,
        JSON.stringify({ ...sanitized, updatedAt: Date.now() }),
        300,
      );
    } catch (err) {
      this.logger.warn(`Redis set location failed for ${userId}: ${(err as Error).message}`);
    }

    const gridCells = this.getNearbyCells(sanitized.lat, sanitized.lng);
    const currentRooms = [...client.rooms];

    for (const room of currentRooms) {
      if (room.startsWith('area:') && !gridCells.includes(room)) {
        client.leave(room);
      }
    }

    for (const cell of gridCells) {
      client.join(cell);
    }

    try {
      const isConvoy = await this.redis.get(`convoy:active:${userId}`);
      if (isConvoy === 'true') {
        // isBanned: false matters — without it a user banned from a group
        // kept broadcasting their live convoy location into that group's
        // room forever, since a ban only flips the member row's flag and
        // evicts their own socket, it doesn't remove them from this query.
        const memberGroups = await this.prisma.groupMember.findMany({
          where: { userId, isBanned: false },
          select: { groupId: true },
        });
        for (const group of memberGroups) {
          this.server.to(`group:${group.groupId}`).emit('convoy:location', {
            userId,
            ...sanitized,
            updatedAt: Date.now(),
          });
        }
      }
    } catch (err) {
      this.logger.warn(`Convoy broadcast failed for ${userId}: ${(err as Error).message}`);
    }

    try {
      const sender = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { subscription: true, subscriptionEnd: true },
      });
      // subscriptionEnd must be checked too — it's only ever reset to FREE on
      // explicit cancel/admin action, not automatically on expiry, so relying
      // on `subscription` alone kept broadcasting a lapsed user's live
      // location to friends indefinitely (same gap as friends.controller.ts's
      // getLocations, which every other premium check in this codebase avoids
      // by also checking subscriptionEnd).
      const expired = !!sender?.subscriptionEnd && sender.subscriptionEnd < new Date();
      if (!sender || expired || !['PREMIUM_STANDARD', 'PREMIUM_MAX'].includes(sender.subscription)) return;

      const friendships = await this.prisma.friend.findMany({
        where: {
          OR: [{ userId }, { friendId: userId }],
          status: 'ACCEPTED',
        },
        select: { userId: true, friendId: true },
      });
      const friendIds = friendships.map(f => f.userId === userId ? f.friendId : f.userId);
      for (const friendId of friendIds) {
        this.server.to(`user:${friendId}`).emit('friend:location', {
          userId,
          lat: sanitized.lat,
          lng: sanitized.lng,
          speed: sanitized.speed,
          heading: sanitized.heading,
          updatedAt: Date.now(),
        });
      }
    } catch (err) {
      this.logger.warn(`Friend location broadcast failed for ${userId}: ${(err as Error).message}`);
    }
  }

  @SubscribeMessage('convoy:toggle')
  async handleConvoyToggle(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { active: boolean },
  ) {
    const userId = this.connectedUsers.get(client.id);
    if (!userId) return;
    try {
      await this.redis.set(`convoy:active:${userId}`, data.active ? 'true' : 'false', 86400);
      return { active: data.active };
    } catch (err) {
      // Unlike most other handlers, this had no try/catch — a Redis blip
      // would reject the handler's promise, Nest's WS filter swallows it
      // silently, and a caller passing an ack callback would hang until its
      // own client-side timeout instead of getting a response.
      this.logger.warn(`Convoy toggle failed for ${userId}: ${(err as Error).message}`);
      return { active: data.active, error: 'Failed to persist convoy state' };
    }
  }

  @SubscribeMessage('sos:trigger')
  async handleSosTrigger(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { lat: number; lng: number; message?: string },
  ) {
    const userId = this.connectedUsers.get(client.id);
    if (!userId) return;

    if (typeof data?.lat !== 'number' || typeof data?.lng !== 'number' ||
        !isFinite(data.lat) || !isFinite(data.lng) ||
        data.lat < -90 || data.lat > 90 || data.lng < -180 || data.lng > 180) {
      return;
    }

    // Unlike the normal report path (reports.service.ts#createReport — which
    // is gated by checkReportLimit + a Redis per-user lock), this handler
    // created a report via a raw prisma.report.create with zero of those
    // protections and no cooldown of its own, so an authenticated socket
    // could spam severity-5 HAZARD reports, flood the live map, and grow the
    // reports table without bound. A 60s per-user cooldown (same Redis
    // setnx pattern used everywhere else in this codebase) closes that hole.
    try {
      const lockKey = `sos:cooldown:${userId}`;
      let locked = true;
      try {
        locked = await this.redis.setnx(lockKey, '1', 60);
      } catch (e) {
        this.logger.warn(`Redis unavailable for SOS cooldown, proceeding without it: ${(e as Error).message}`);
      }
      if (!locked) {
        return { success: false, error: 'SOS already triggered recently, wait a minute' };
      }

      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { emergencyContacts: true },
      });
      if (!user || user.isBanned) return { success: false, error: 'Not allowed' };

      // Arbitrary unbounded user-controlled strings used to flow into the
      // report description and every broadcast payload — cap it so a single
      // (or repeated) trigger can't stuff the DB and every socket room with
      // a megabyte of text.
      const message = (data.message || '').toString().trim().slice(0, 200);
      const sosAlert = {
        userId,
        userName: user.displayName,
        lat: data.lat,
        lng: data.lng,
        message: message || 'EMERGENCY: SOS Triggered!',
        timestamp: Date.now(),
      };

      const gridCells = this.getNearbyCells(data.lat, data.lng, 5);
      for (const cell of gridCells) {
        this.server.to(cell).emit('sos:alert', sosAlert);
      }

      // isBanned: false — same reasoning as the convoy broadcast in
      // location:update: a member row banned from the group must not keep
      // fanning this user's SOS alert into that group's room.
      const memberGroups = await this.prisma.groupMember.findMany({
        where: { userId, isBanned: false },
        select: { groupId: true },
      });
      for (const group of memberGroups) {
        this.server.to(`group:${group.groupId}`).emit('sos:alert', sosAlert);
      }

      await this.prisma.report.create({
        data: {
          userId,
          type: 'HAZARD',
          lat: data.lat,
          lng: data.lng,
          severity: 5,
          description: `SOS ALERT from ${user.displayName}: ${sosAlert.message}`,
          status: 'ACTIVE',
          city: user.city || null,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });

      this.logger.warn(`SOS Triggered by user ${userId} at ${data.lat}, ${data.lng}`);
      // The previous `alertedContacts: N` implied the user's emergency
      // contacts were actually notified — they never were (EmergencyContact
      // rows only hold a name/phone with no in-app delivery channel, and no
      // SMS/push path exists). Return the honest count instead so the
      // client doesn't present "contacts alerted" that never happened.
      return { success: true, emergencyContactsOnFile: user.emergencyContacts.length };
    } catch (err) {
      this.logger.error(`SOS handler failed for ${userId}: ${(err as Error).message}`);
      return { success: false, error: 'Failed to process SOS' };
    }
  }

  @SubscribeMessage('subscribe:area')
  async handleAreaSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { lat: number; lng: number; radius?: number },
  ) {
    // Unlike location:update, this never left stale `area:*` rooms on
    // repeated calls (e.g. the user panning/searching the map) — the
    // socket's room membership only grew, up to hundreds of rooms per
    // connection, and kept delivering broadcasts for areas no longer in view.
    const cells = this.getNearbyCells(data.lat, data.lng, data.radius);
    const currentRooms = [...client.rooms];
    for (const room of currentRooms) {
      if (room.startsWith('area:') && !cells.includes(room)) {
        client.leave(room);
      }
    }
    for (const cell of cells) {
      client.join(cell);
    }
    return { subscribed: cells.length };
  }

  @SubscribeMessage('city:join')
  async handleCityJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { city: string },
  ) {
    const userId = this.connectedUsers.get(client.id);
    if (!userId || !data.city) return;

    const room = `city:${data.city.toLowerCase()}`;
    client.join(room);
    this.logger.log(`User ${userId} joined city chat ${room}`);
    return { joined: true, room };
  }

  @SubscribeMessage('city:leave')
  async handleCityLeave(@ConnectedSocket() client: Socket, @MessageBody() data: { city: string }) {
    if (!data?.city) return;
    client.leave(`city:${data.city.toLowerCase()}`);
  }

  @SubscribeMessage('city:message')
  async handleCityMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { city: string; content: string },
  ) {
    const userId = this.connectedUsers.get(client.id);
    if (!userId || !data.city || !data.content?.trim()) return;
    if (data.content.trim().length > 2000) return;

    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, displayName: true, avatar: true },
      });
      if (!user) return;

      const message = await this.prisma.cityChatMessage.create({
        data: { city: data.city.toLowerCase(), userId, content: data.content.trim() },
        include: {
          user: { select: { id: true, displayName: true, avatar: true } },
        },
      });

      const room = `city:${data.city.toLowerCase()}`;
      this.server.to(room).emit('city:message', message);
    } catch (err) {
      this.logger.warn(`City message failed for ${userId}: ${(err as Error).message}`);
    }
  }

  @SubscribeMessage('join:group')
  async handleJoinGroup(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { groupId: string },
  ) {
    const userId = this.connectedUsers.get(client.id);
    if (!userId || !data?.groupId) return;

    try {
      const member = await this.prisma.groupMember.findFirst({
        where: { groupId: data.groupId, userId },
      });

      if (member) {
        if (member.isBanned) return { joined: false, error: 'Banned' };
        client.join(`group:${data.groupId}`);
        return { joined: true };
      }
      return { joined: false, error: 'Not a member' };
    } catch (err) {
      // No try/catch previously — a DB blip would silently swallow the
      // rejection and leave a caller with an ack callback hanging.
      this.logger.warn(`join:group failed for ${userId}/${data.groupId}: ${(err as Error).message}`);
      return { joined: false, error: 'Failed to join group' };
    }
  }

  @SubscribeMessage('leave:group')
  async handleLeaveGroup(@ConnectedSocket() client: Socket, @MessageBody() data: { groupId: string }) {
    if (!data?.groupId) return;
    client.leave(`group:${data.groupId}`);
  }

  @SubscribeMessage('message:send')
  async handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { receiverId: string; content: string },
  ) {
    const userId = this.connectedUsers.get(client.id);
    if (!userId || !data.content?.trim() || !data.receiverId) return;
    if (data.content.trim().length > 2000) return { error: 'Message too long' };

    try {
      // Mirrors the group-message handler: don't let a banned user keep
      // messaging from their revoked account.
      const sender = await this.prisma.user.findUnique({ where: { id: userId }, select: { isBanned: true } });
      if (!sender || sender.isBanned) return { error: 'Not allowed' };

      const receiver = await this.prisma.user.findUnique({ where: { id: data.receiverId }, select: { id: true } });
      if (!receiver) return { error: 'Receiver not found' };

      const message = await this.prisma.message.create({
        data: {
          senderId: userId,
          receiverId: data.receiverId,
          content: data.content.trim(),
        },
        include: {
          sender: { select: { id: true, displayName: true, avatar: true } },
        },
      });

      await this.gatewayService.sendToUser(data.receiverId, 'message:received', message);
      return message;
    } catch (err) {
      this.logger.warn(`Message send failed for ${userId}: ${(err as Error).message}`);
      return { error: 'Failed to send message' };
    }
  }

  @SubscribeMessage('group:message')
  async handleGroupMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { groupId: string; content: string; replyTo?: string; images?: string[]; sticker?: string; audioUrl?: string; videoUrl?: string },
  ) {
    const userId = this.connectedUsers.get(client.id);
    if (!userId) return { error: 'Not authenticated' };
    if (!data?.groupId) return { error: 'Group ID required' };
    if (!data.content?.trim() && !data.images?.length && !data.sticker && !data.audioUrl && !data.videoUrl) {
      return { error: 'Empty message' };
    }
    if (data.content && data.content.trim().length > 2000) return { error: 'Message too long' };

    try {
      const member = await this.getActiveGroupMember(data.groupId, userId);
      if (!member) return { error: 'Not a member' };

      const message = await this.prisma.groupMessage.create({
        data: {
          groupId: data.groupId,
          senderId: userId,
          content: data.content?.trim() || '',
          images: data.images || [],
          sticker: data.sticker || null,
          audioUrl: data.audioUrl || null,
          videoUrl: data.videoUrl || null,
        },
        include: {
          sender: { select: { id: true, displayName: true, avatar: true } },
        },
      });

      this.server.to(`group:${data.groupId}`).emit('group:message', message);
      return message;
    } catch (err) {
      this.logger.warn(`Group message failed for ${userId}: ${(err as Error).message}`);
      return { error: 'Failed to send message' };
    }
  }

  @SubscribeMessage('group:typing')
  async handleGroupTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { groupId: string; isTyping: boolean },
  ) {
    const userId = this.connectedUsers.get(client.id);
    // Missing groupId used to fall through to findFirst({ groupId: undefined, userId })
    // — Prisma drops an undefined key from the filter instead of matching
    // nothing, so this matched ANY group the user belongs to and then
    // broadcast to the bogus room `group:undefined`, which any other client
    // making the same mistake would also be sitting in — a cross-group
    // typing-indicator leak between users who share no group.
    if (!userId || !data?.groupId) return;

    const member = await this.getActiveGroupMember(data.groupId, userId);
    if (!member) return;

    client.to(`group:${data.groupId}`).emit('group:typing', {
      userId,
      isTyping: data.isTyping,
    });
  }

  @SubscribeMessage('group:message_read')
  async handleMessageRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { groupId: string; messageId: string },
  ) {
    const userId = this.connectedUsers.get(client.id);
    if (!userId) return;

    try {
      const member = await this.getActiveGroupMember(data.groupId, userId);
      if (!member) return;

      const msg = await this.prisma.groupMessage.findUnique({ where: { id: data.messageId } });
      if (!msg || msg.groupId !== data.groupId || msg.senderId === userId) return;
      if (msg.readBy.includes(userId)) return;

      const updated = await this.prisma.groupMessage.update({
        where: { id: data.messageId },
        data: { readBy: { push: userId } },
        include: { sender: { select: { id: true } } },
      });

      this.server.to(`group:${data.groupId}`).emit('group:message_read', {
        messageId: data.messageId,
        readBy: updated.readBy,
        readByUser: userId,
      });
    } catch (err) {
      this.logger.warn(`Message read failed: ${(err as Error).message}`);
    }
  }

  @SubscribeMessage('group:reaction')
  async handleReaction(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { groupId: string; messageId: string; emoji: string },
  ) {
    const userId = this.connectedUsers.get(client.id);
    if (!userId) return;

    try {
      const member = await this.getActiveGroupMember(data.groupId, userId);
      if (!member) return;

      // Plain findUnique-then-update was a read-modify-write race: two users
      // reacting within milliseconds both read the same row, and the second
      // update silently overwrote the first's reaction. Compare-and-swap on
      // the previous `reactions` value + retry turns it into an atomic op
      // without needing a schema change to a real JSON/relational column.
      const MAX_ATTEMPTS = 5;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const msg = await this.prisma.groupMessage.findUnique({ where: { id: data.messageId } });
        if (!msg || msg.groupId !== data.groupId) return;

        let reactions: Record<string, string[]> = {};
        try { reactions = JSON.parse(msg.reactions || '{}'); } catch {}

        const existing = reactions[data.emoji] || [];
        if (existing.includes(userId)) {
          reactions[data.emoji] = existing.filter(id => id !== userId);
          if (reactions[data.emoji].length === 0) delete reactions[data.emoji];
        } else {
          reactions[data.emoji] = [...existing, userId];
        }

        const result = await this.prisma.groupMessage.updateMany({
          where: { id: data.messageId, reactions: msg.reactions },
          data: { reactions: JSON.stringify(reactions) },
        });

        if (result.count > 0) {
          this.server.to(`group:${data.groupId}`).emit('group:reaction', {
            messageId: data.messageId,
            reactions,
          });
          return;
        }
        // Someone else updated reactions between our read and write — retry
        // with fresh data instead of silently dropping this reaction.
      }
      this.logger.warn(`Reaction update for message ${data.messageId} lost the race ${MAX_ATTEMPTS} times in a row`);
    } catch (err) {
      this.logger.warn(`Reaction failed: ${(err as Error).message}`);
    }
  }

  @SubscribeMessage('group:edit')
  async handleGroupEdit(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { groupId: string; name?: string; description?: string },
  ) {
    const userId = this.connectedUsers.get(client.id);
    if (!userId || !data?.groupId) return;

    try {
      const member = await this.prisma.groupMember.findFirst({
        where: { groupId: data.groupId, userId, isAdmin: true, isBanned: false },
      });
      if (!member) return;

      // Was accepting an unvalidated `avatar` string here with no
      // size/mimetype check at all, and no uniqueness lock on `name` —
      // exactly what social.service.ts#updateGroup()/createGroup() were
      // hardened against (see their comments), just reachable through a
      // second, unguarded path. avatar must go through the multer-validated
      // POST /groups/:groupId/avatar endpoint only; name changes here now
      // get the same advisory-lock uniqueness check as the REST path.
      const updateData: { name?: string; description?: string } = {};
      if (data.description !== undefined) updateData.description = data.description;

      const updated = await this.prisma.$transaction(async (tx) => {
        if (data.name !== undefined) {
          const nameLower = String(data.name).toLowerCase();
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`group_name:${nameLower}`})::bigint)`;
          const existing = await tx.group.findFirst({ where: { name: { equals: data.name, mode: 'insensitive' }, id: { not: data.groupId } } });
          if (existing) return null;
          updateData.name = data.name;
        }
        if (Object.keys(updateData).length === 0) return null;
        return tx.group.update({
          where: { id: data.groupId },
          data: updateData,
          include: { _count: { select: { members: true } } },
        });
      });
      if (!updated) return;

      const { _count, ...rest } = updated as any;
      this.server.to(`group:${data.groupId}`).emit('group:updated', {
        ...rest,
        memberCount: _count.members,
        updatedBy: userId,
      });
    } catch (err) {
      this.logger.warn(`Group edit failed for ${userId}: ${(err as Error).message}`);
    }
  }

  @SubscribeMessage('trip:started')
  async handleTripStarted(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { tripId: string },
  ) {
    const userId = this.connectedUsers.get(client.id);
    if (!userId || !data.tripId) return;
    try {
      const trip = await this.prisma.trip.findFirst({ where: { id: data.tripId, userId } });
      if (!trip) return { ok: false };
      client.join(`trip:${data.tripId}`);
      return { ok: true };
    } catch (err) {
      this.logger.warn(`trip:started failed for ${userId}/${data.tripId}: ${(err as Error).message}`);
      return { ok: false };
    }
  }

  // Shared by the group message/typing/reaction/call-end handlers below,
  // which all need the identical "is this user an active (non-banned)
  // member of this group" check before letting them act on it. Previously
  // each handler hand-rolled its own `findFirst` + `!member || member.isBanned`
  // check; factoring it here means the next new handler can't reintroduce
  // the banned-member bypass this file's other fixes closed by simply
  // forgetting to repeat the inline check.
  private async getActiveGroupMember(groupId: string, userId: string) {
    const member = await this.prisma.groupMember.findFirst({ where: { groupId, userId } });
    return member && !member.isBanned ? member : null;
  }

  /** True if `userId` and `otherUserId` are accepted friends or share at least one (non-banned) group. */
  private async areUsersConnected(userId: string, otherUserId: string): Promise<boolean> {
    if (userId === otherUserId) return true;
    const friend = await this.prisma.friend.findFirst({
      where: {
        status: 'ACCEPTED',
        OR: [
          { userId, friendId: otherUserId },
          { userId: otherUserId, friendId: userId },
        ],
      },
      select: { id: true },
    });
    if (friend) return true;

    const sharedGroup = await this.prisma.groupMember.findFirst({
      where: {
        userId,
        isBanned: false,
        group: { members: { some: { userId: otherUserId, isBanned: false } } },
      },
      select: { id: true },
    });
    return !!sharedGroup;
  }

  private async notifyFriendsOnlineStatus(userId: string, isOnline: boolean) {
    try {
      const friendships = await this.prisma.friend.findMany({
        where: {
          OR: [{ userId }, { friendId: userId }],
          status: 'ACCEPTED',
        },
        select: { userId: true, friendId: true },
      });

      const friendIds = friendships.map(f => f.userId === userId ? f.friendId : f.userId);

      for (const friendId of friendIds) {
        this.server.to(`user:${friendId}`).emit('user:online', { userId, isOnline });
      }
    } catch (err) {
      this.logger.warn(`Failed to notify friends of online status for ${userId}: ${(err as Error).message}`);
    }
  }

  @SubscribeMessage('voice:call')
  async handleVoiceCall(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { targetUserId: string; callerName: string; callerId?: string },
  ) {
    const userId = this.connectedUsers.get(client.id);
    if (!userId || !data.targetUserId) return;
    // Without this, any authenticated user could ring/signal an arbitrary
    // userId with no relationship to them — harassment vector.
    if (!(await this.areUsersConnected(userId, data.targetUserId))) return;

    this.gatewayService.sendToUser(data.targetUserId, 'voice:call', {
      callerId: userId,
      callerName: data.callerName || 'User',
    });
  }

  @SubscribeMessage('voice:signal')
  async handleVoiceSignal(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { targetUserId: string; signal: any },
  ) {
    const userId = this.connectedUsers.get(client.id);
    if (!userId || !data.targetUserId || !data.signal) return;
    if (!(await this.areUsersConnected(userId, data.targetUserId))) return;

    this.gatewayService.sendToUser(data.targetUserId, 'voice:signal', {
      fromUserId: userId,
      signal: data.signal,
    });
  }

  @SubscribeMessage('voice:end')
  async handleVoiceEnd(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { targetUserId: string; groupId?: string },
  ) {
    const userId = this.connectedUsers.get(client.id);
    if (!userId) return;

    // Unlike voice:call/voice:signal above, this handler had no relationship
    // check at all — any authenticated client could terminate an arbitrary
    // user's call UI, or disrupt a group call for a group it never joined.
    if (data.groupId) {
      // isBanned: false — every other group action in this file strips a
      // banned member's ability to act in/on the group; this was the one
      // place that didn't, letting a banned member keep tearing down the
      // group's active call.
      const member = await this.getActiveGroupMember(data.groupId, userId);
      if (!member) return;
      this.server.to(`group:${data.groupId}`).emit('voice:end', { userId });
    } else if (data.targetUserId) {
      if (!(await this.areUsersConnected(userId, data.targetUserId))) return;
      this.gatewayService.sendToUser(data.targetUserId, 'voice:end', { userId });
    }
  }

  private async cleanupStaleOnlineUsers() {
    try {
      const onlineIds = await this.redis.smembers('online:users');
      for (const uid of onlineIds) {
        const ts = await this.redis.get(`online:ts:${uid}`);
        if (!ts) {
          await this.redis.srem('online:users', uid);
        }
      }
    } catch (err) {
      this.logger.warn(`Stale cleanup failed: ${(err as Error).message}`);
    }

    await this.refreshOnlineHeartbeats();
  }

  // online:ts:${userId} is set once on first connection with a 30min TTL
  // and was never refreshed afterward — any connection lasting longer than
  // that had its key expire while still connected, and the cleanup pass
  // above would then srem it from online:users, making
  // friends.service.ts's getValidOnlineUserIds report a genuinely-connected
  // user as offline. Running on the same 10min interval keeps the TTL
  // ahead of expiry for as long as this instance still has the connection.
  private async refreshOnlineHeartbeats() {
    try {
      for (const userId of this.userConnections.keys()) {
        await this.redis.sadd('online:users', userId);
        await this.redis.set(`online:ts:${userId}`, Date.now().toString(), this.USER_ONLINE_TTL);
      }
    } catch (err) {
      this.logger.warn(`Online heartbeat refresh failed: ${(err as Error).message}`);
    }
  }

  private getNearbyCells(lat: number, lng: number, radiusKm = 10): string[] {
    if (!isFinite(lat) || !isFinite(lng)) return [];

    const clampedLat = Math.max(-85, Math.min(85, lat));
    const clampedLng = Math.max(-180, Math.min(180, lng));
    const clampedRadius = Math.min(radiusKm, 50);

    const cells: string[] = [];
    const step = 0.045;
    const range = Math.ceil(clampedRadius / 5);
    for (let dlat = -range; dlat <= range; dlat++) {
      for (let dlng = -range; dlng <= range; dlng++) {
        const gridLat = (Math.floor(clampedLat / step) + dlat) * step;
        const gridLng = (Math.floor(clampedLng / step) + dlng) * step;
        cells.push(`area:${gridLat.toFixed(3)},${gridLng.toFixed(3)}`);
      }
    }
    return cells;
  }
}
