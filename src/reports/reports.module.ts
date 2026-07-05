import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { WebsocketModule } from '../websocket/websocket.module';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  imports: [WebsocketModule, TelegramModule],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
