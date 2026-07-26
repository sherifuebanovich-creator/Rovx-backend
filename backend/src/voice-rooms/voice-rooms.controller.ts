import { Controller, Get, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { VoiceRoomsService } from './voice-rooms.service';
import { CreateVoiceRoomDto } from './dto/create-voice-room.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Voice Rooms')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('voice-rooms')
export class VoiceRoomsController {
  constructor(private voiceRoomsService: VoiceRoomsService) {}

  @Get()
  @ApiOperation({ summary: 'List active voice rooms' })
  list() {
    return this.voiceRoomsService.listActiveRooms();
  }

  @Get('ice-servers')
  @ApiOperation({ summary: 'Get WebRTC ICE server configuration (STUN + optional TURN)' })
  getIceServers() {
    return this.voiceRoomsService.getIceServers();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a voice room by id' })
  get(@Param('id') id: string) {
    return this.voiceRoomsService.getRoom(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new voice room' })
  create(@CurrentUser('id') userId: string, @Body() dto: CreateVoiceRoomDto) {
    return this.voiceRoomsService.createRoom(userId, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Close a voice room (owner only)' })
  async close(@CurrentUser('id') userId: string, @Param('id') id: string) {
    await this.voiceRoomsService.closeRoom(id, userId);
    return { success: true };
  }
}
