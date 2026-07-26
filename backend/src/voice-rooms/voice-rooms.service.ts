import { Injectable, NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVoiceRoomDto } from './dto/create-voice-room.dto';

export interface VoiceRoomParticipant {
  socketId: string;
  userId: string;
  displayName: string;
  avatar?: string | null;
  micEnabled: boolean;
  isSpeaking: boolean;
  joinedAt: number;
}

@Injectable()
export class VoiceRoomsService {
  // Live presence is intentionally in-memory only (mirrors the pattern
  // already used for online-user tracking in roadpilot.gateway.ts) — it's
  // transient by nature and doesn't need to survive a restart. Keyed by
  // roomId -> socketId -> participant, plus a reverse index so a
  // disconnecting socket can find which room(s) to clean up without
  // scanning every room.
  private rooms = new Map<string, Map<string, VoiceRoomParticipant>>();
  private socketToRoom = new Map<string, string>();

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  getIceServers(): RTCIceServerConfig[] {
    const servers: RTCIceServerConfig[] = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ];
    const turnUrl = this.config.get<string>('TURN_URL');
    const turnUsername = this.config.get<string>('TURN_USERNAME');
    const turnCredential = this.config.get<string>('TURN_CREDENTIAL');
    // Not configured yet in this deployment — added here so plugging in a
    // real TURN provider later is just setting three env vars, no code
    // changes. Without TURN, calls between peers on strict/symmetric NATs
    // (common on mobile carrier networks) can fail to establish audio.
    if (turnUrl && turnUsername && turnCredential) {
      servers.push({ urls: turnUrl, username: turnUsername, credential: turnCredential });
    }
    return servers;
  }

  async createRoom(ownerId: string, dto: CreateVoiceRoomDto) {
    return this.prisma.voiceRoom.create({
      data: {
        name: dto.name.trim(),
        ownerId,
        maxParticipants: dto.maxParticipants ?? 20,
      },
    });
  }

  async listActiveRooms() {
    const rooms = await this.prisma.voiceRoom.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        owner: { select: { id: true, displayName: true, avatar: true } },
      },
    });
    return rooms.map((r) => ({
      ...r,
      participantCount: this.rooms.get(r.id)?.size ?? 0,
    }));
  }

  async getRoom(roomId: string) {
    const room = await this.prisma.voiceRoom.findUnique({
      where: { id: roomId },
      include: { owner: { select: { id: true, displayName: true, avatar: true } } },
    });
    if (!room || !room.isActive) throw new NotFoundException('Voice room not found');
    return room;
  }

  async closeRoom(roomId: string, userId: string) {
    const room = await this.prisma.voiceRoom.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException('Voice room not found');
    if (room.ownerId !== userId) throw new ForbiddenException('Only the room owner can close it');
    await this.prisma.voiceRoom.update({ where: { id: roomId }, data: { isActive: false } });
  }

  // ── Live participant state (in-memory) ─────────────────────────────

  addParticipant(roomId: string, participant: VoiceRoomParticipant, maxParticipants: number): VoiceRoomParticipant[] {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = new Map();
      this.rooms.set(roomId, room);
    }
    if (room.size >= maxParticipants) {
      throw new ConflictException('Voice room is full');
    }
    room.set(participant.socketId, participant);
    this.socketToRoom.set(participant.socketId, roomId);
    return this.getParticipants(roomId);
  }

  getParticipants(roomId: string): VoiceRoomParticipant[] {
    return Array.from(this.rooms.get(roomId)?.values() ?? []);
  }

  getParticipant(roomId: string, socketId: string): VoiceRoomParticipant | undefined {
    return this.rooms.get(roomId)?.get(socketId);
  }

  getRoomForSocket(socketId: string): string | undefined {
    return this.socketToRoom.get(socketId);
  }

  setSpeaking(roomId: string, socketId: string, isSpeaking: boolean): VoiceRoomParticipant | undefined {
    const participant = this.rooms.get(roomId)?.get(socketId);
    if (participant) participant.isSpeaking = isSpeaking;
    return participant;
  }

  setMicEnabled(roomId: string, socketId: string, micEnabled: boolean): VoiceRoomParticipant | undefined {
    const participant = this.rooms.get(roomId)?.get(socketId);
    if (participant) {
      participant.micEnabled = micEnabled;
      if (!micEnabled) participant.isSpeaking = false;
    }
    return participant;
  }

  removeParticipant(socketId: string): { roomId: string; participant: VoiceRoomParticipant } | null {
    const roomId = this.socketToRoom.get(socketId);
    if (!roomId) return null;
    this.socketToRoom.delete(socketId);
    const room = this.rooms.get(roomId);
    const participant = room?.get(socketId);
    if (!room || !participant) return null;
    room.delete(socketId);
    if (room.size === 0) this.rooms.delete(roomId);
    return { roomId, participant };
  }
}

export interface RTCIceServerConfig {
  urls: string;
  username?: string;
  credential?: string;
}
