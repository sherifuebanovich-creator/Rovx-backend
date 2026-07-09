import { Module, forwardRef } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { TelegramController } from './telegram.controller';
import { AdminModule } from '../admin/admin.module';
import { ReportsModule } from '../reports/reports.module';

@Module({
  imports: [AdminModule, forwardRef(() => ReportsModule)],
  controllers: [TelegramController],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
