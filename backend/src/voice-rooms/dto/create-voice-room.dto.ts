import { IsString, IsInt, IsOptional, Min, Max, MinLength, MaxLength } from 'class-validator';

export class CreateVoiceRoomDto {
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  name: string;

  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(50)
  maxParticipants?: number;
}
