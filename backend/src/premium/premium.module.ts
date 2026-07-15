import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PremiumController } from './premium.controller';
import { PremiumService } from './premium.service';
import { XsollaService } from './xsolla.service';
import { LavaTopService } from './lava-top.service';
import { LemonSqueezyService } from './lemon-squeezy.service';
import { StripeService } from './stripe.service';
import { PaymeService } from './payme.service';

@Module({
  imports: [ConfigModule],
  controllers: [PremiumController],
  providers: [PremiumService, XsollaService, LavaTopService, LemonSqueezyService, StripeService, PaymeService],
  exports: [PremiumService],
})
export class PremiumModule {}
