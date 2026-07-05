import { Module } from '@nestjs/common';
import { RovxGateway } from './roadpilot.gateway';
import { GatewayService } from './gateway.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  providers: [RovxGateway, GatewayService],
  exports: [GatewayService],
})
export class WebsocketModule {}
