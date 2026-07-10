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

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private gatewayService: GatewayService,
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  afterInit(server: Server) {
    this.gatewayService.setServer(server);
    this.logger.log('WebSocket Gateway initialized');
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

      this.connectedUsers.set(client.id, payload.sub);

      client.join(`user:${payload.sub}`);

      await this.redis.sadd('online:users', payload.sub);
      await this.redis.set(`socket:${payload.sub}`, client.id, 86400);

      this.logger.log(`Client connected: ${client.id} (user: ${payload.sub})`);
    } catch (error) {
      this.logger.warn(`Unauthorized connection attempt from ${client.id}`);
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: Socket) {
    const userId = this.connectedUsers.get(client.id);
    if (userId) {
      this.connectedUsers.delete(client.id);
      try {
        await Promise.all([
          this.redis.srem('online:users', userId),
          this.redis.del(`socket:${userId}`),
          this.redis.del(`location:${userId}`),
        ]);
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

    try {
      await this.redis.set(
        `location:${userId}`,
        JSON.stringify({ ...data, updatedAt: Date.now() }),
        300,
      );
    } catch (err) {
      this.logger.warn(`Redis set location failed for ${userId}: ${(err as Error).message}`);
    }

    const gridCells = this.getNearbyCells(data.lat, data.lng);
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
        const memberGroups = await this.prisma.groupMember.findMany({
          where: { userId },
          select: { groupId: true },
        });
        for (const group of memberGroups) {
          this.server.to(`group:${group.groupId}`).emit('convoy:location', {
            userId,
            ...data,
            updatedAt: Date.now(),
          });
        }
      }
    } catch (err) {
      this.logger.warn(`Convoy broadcast failed for ${userId}: ${(err as Error).message}`);
    }
  }

  @SubscribeMessage('convoy:toggle')
  async handleConvoyToggle(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { active: boolean },
  ) {
    const userId = this.connectedUsers.get(client.id);
    if (!userId) return;
    await this.redis.set(`convoy:active:${userId}`, data.active ? 'true' : 'false', 86400);
    return { active: data.active };
  }

  @SubscribeMessage('sos:trigger')
  async handleSosTrigger(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { lat: number; lng: number; message?: string },
  ) {
    const userId = this.connectedUsers.get(client.id);
    if (!userId) return;

    if (typeof data?.lat !== 'number' || typeof data?.lng !== 'number' ||
        !isFinite(data.lat) || !isFinite(data.lng)) {
      return;
    }

    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { emergencyContacts: true },
      });
      if (!user) return;

      const sosAlert = {
        userId,
        userName: user.displayName,
        lat: data.lat,
        lng: data.lng,
        message: data.message || 'EMERGENCY: SOS Triggered!',
        timestamp: Date.now(),
      };

      const gridCells = this.getNearbyCells(data.lat, data.lng, 5);
      for (const cell of gridCells) {
        this.server.to(cell).emit('sos:alert', sosAlert);
      }

      const memberGroups = await this.prisma.groupMember.findMany({
        where: { userId },
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
        },
      });

      this.logger.warn(`SOS Triggered by user ${userId} at ${data.lat}, ${data.lng}`);
      return { success: true, alertedContacts: user.emergencyContacts.length };
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
    const cells = this.getNearbyCells(data.lat, data.lng, data.radius);
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
    if (!userId) return;

    const member = await this.prisma.groupMember.findFirst({
      where: { groupId: data.groupId, userId },
    });

    if (member) {
      client.join(`group:${data.groupId}`);
      return { joined: true };
    }
    return { joined: false, error: 'Not a member' };
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

    try {
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
    @MessageBody() data: { groupId: string; content: string; replyTo?: string },
  ) {
    const userId = this.connectedUsers.get(client.id);
    if (!userId || !data.content?.trim()) return;

    try {
      const member = await this.prisma.groupMember.findFirst({
        where: { groupId: data.groupId, userId },
      });
      if (!member) return;

      const message = await this.prisma.groupMessage.create({
        data: {
          groupId: data.groupId,
          senderId: userId,
          content: data.content.trim(),
        },
        include: {
          sender: { select: { id: true, displayName: true, avatar: true } },
        },
      });

      this.server.to(`group:${data.groupId}`).emit('group:message', message);
    } catch (err) {
      this.logger.warn(`Group message failed for ${userId}: ${(err as Error).message}`);
    }
  }

  @SubscribeMessage('group:typing')
  async handleGroupTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { groupId: string; isTyping: boolean },
  ) {
    const userId = this.connectedUsers.get(client.id);
    if (!userId) return;

    client.to(`group:${data.groupId}`).emit('group:typing', {
      userId,
      isTyping: data.isTyping,
    });
  }

  @SubscribeMessage('group:edit')
  async handleGroupEdit(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { groupId: string; name?: string; description?: string; avatar?: string },
  ) {
    const userId = this.connectedUsers.get(client.id);
    if (!userId) return;

    try {
      const member = await this.prisma.groupMember.findFirst({
        where: { groupId: data.groupId, userId, isAdmin: true },
      });
      if (!member) return;

      const updateData: any = {};
      if (data.name !== undefined) updateData.name = data.name;
      if (data.description !== undefined) updateData.description = data.description;
      if (data.avatar !== undefined) updateData.avatar = data.avatar;

      if (Object.keys(updateData).length > 0) {
        await this.prisma.group.update({
          where: { id: data.groupId },
          data: updateData,
        });
      }

      this.server.to(`group:${data.groupId}`).emit('group:updated', {
        ...data,
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
    if (!userId) return;
    client.join(`trip:${data.tripId}`);
    return { ok: true };
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
