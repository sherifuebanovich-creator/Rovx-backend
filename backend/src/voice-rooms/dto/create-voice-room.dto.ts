import { IsString, IsInt, IsOptional, Min, Max, MinLength, MaxLength } from 'class-validator';

export class CreateVoiceRoomDto {
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  name: string;

  @IsOptional()
  @IsInt()
  // Full-mesh WebRTC (every participant connects to every other) — 50 was
  // never reachable from the UI (which only ever creates with the default),
  // but the API itself would still accept it and attempt ~1225 simultaneous
  // peer connections, degrading audio for everyone in the room.
  @Min(2)
  @Max(16)
  maxParticipants?: number;

  @IsOptional()
  @IsString()
  groupId?: string;
}
