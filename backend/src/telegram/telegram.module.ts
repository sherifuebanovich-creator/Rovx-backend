import { Module, forwardRef } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { TelegramController } from './telegram.controller';
import { AdminModule } from '../admin/admin.module';
import { ReportsModule } from '../reports/reports.module';
import { PremiumModule } from '../premium/premium.module';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [AdminModule, forwardRef(() => ReportsModule), forwardRef(() => PremiumModule), RedisModule],
  controllers: [TelegramController],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
