import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PremiumController } from './premium.controller';
import { PremiumService } from './premium.service';
import { XsollaService } from './xsolla.service';
import { LemonSqueezyService } from './lemon-squeezy.service';
import { StripeService } from './stripe.service';

@Module({
  imports: [ConfigModule],
  controllers: [PremiumController],
  providers: [PremiumService, XsollaService, LemonSqueezyService, StripeService],
  exports: [PremiumService],
})
export class PremiumModule {}
