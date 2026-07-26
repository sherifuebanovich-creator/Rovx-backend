import { Module } from '@nestjs/common';
import { VoiceRoomsController } from './voice-rooms.controller';
import { VoiceRoomsService } from './voice-rooms.service';
import { VoiceRoomsGateway } from './voice-rooms.gateway';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [VoiceRoomsController],
  providers: [VoiceRoomsService, VoiceRoomsGateway],
})
export class VoiceRoomsModule {}
