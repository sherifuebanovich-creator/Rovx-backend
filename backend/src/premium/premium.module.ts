import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PremiumController } from './premium.controller';
import { PremiumService } from './premium.service';
import { XsollaService } from './xsolla.service';
import { LavaTopService } from './lava-top.service';
import { LemonSqueezyService } from './lemon-squeezy.service';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  imports: [ConfigModule, TelegramModule],
  controllers: [PremiumController],
  providers: [PremiumService, XsollaService, LavaTopService, LemonSqueezyService],
  exports: [PremiumService],
})
export class PremiumModule {}
