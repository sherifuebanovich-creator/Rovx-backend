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
    // A client-supplied groupId is only honored if the creator is actually
    // a member — otherwise anyone could attach a "private" room to a group
    // they don't belong to and have it inherit that group's member list as
    // its access list, which would be backwards (granting access, not
    // restricting it, to people who aren't even in the group).
    if (dto.groupId) {
      await this.assertGroupMember(dto.groupId, ownerId);
    }
    return this.prisma.voiceRoom.create({
      data: {
        name: dto.name.trim(),
        ownerId,
        groupId: dto.groupId,
        maxParticipants: dto.maxParticipants ?? 20,
      },
    });
  }

  // Group-scoped rooms are only ever meant to be reachable via the group's
  // chat (which only its members can see in the first place) — surfacing
  // them here too would let any user in the app discover and join a call
  // its own group members think is private.
  async listActiveRooms() {
    const rooms = await this.prisma.voiceRoom.findMany({
      where: { isActive: true, groupId: null },
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

  async getRoom(roomId: string, userId: string) {
    const room = await this.prisma.voiceRoom.findUnique({
      where: { id: roomId },
      include: { owner: { select: { id: true, displayName: true, avatar: true } } },
    });
    if (!room || !room.isActive) throw new NotFoundException('Voice room not found');
    if (room.groupId) await this.assertGroupMember(room.groupId, userId);
    return room;
  }

  async closeRoom(roomId: string, userId: string) {
    const room = await this.prisma.voiceRoom.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException('Voice room not found');
    if (room.ownerId !== userId) throw new ForbiddenException('Only the room owner can close it');
    await this.prisma.voiceRoom.update({ where: { id: roomId }, data: { isActive: false } });
    // Flipping isActive only stopped NEW joins — everyone already connected
    // kept talking indefinitely, and the owner had no real way to end a
    // live call. Return the room so the gateway can evict current sockets.
    return room;
  }

  async assertGroupMember(groupId: string, userId: string) {
    const member = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (!member || member.isBanned) throw new ForbiddenException('Not a member of this group');
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

  // The last participant leaving only ever cleared the in-memory Map above
  // — the DB row stayed isActive:true forever, so listActiveRooms() (which
  // filters on isActive) kept surfacing it with a permanent "0/N" forever.
  // updateMany + the isActive:true guard makes this a no-op if the owner
  // already closed the room explicitly (closeRoom) around the same time.
  async closeRoomIfEmpty(roomId: string): Promise<void> {
    if (this.rooms.has(roomId)) return;
    await this.prisma.voiceRoom.updateMany({ where: { id: roomId, isActive: true }, data: { isActive: false } });
  }
}

export interface RTCIceServerConfig {
  urls: string;
  username?: string;
  credential?: string;
}
