import { Module } from '@nestjs/common';
import { SocialController } from './social.controller';
import { SocialService } from './social.service';
import { WebsocketModule } from '../websocket/websocket.module';
import { PremiumModule } from '../premium/premium.module';

@Module({
  imports: [WebsocketModule, PremiumModule],
  controllers: [SocialController],
  providers: [SocialService],
})
export class SocialModule {}
