import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PremiumController } from './premium.controller';
import { PremiumService } from './premium.service';
import { XsollaService } from './xsolla.service';

@Module({
  imports: [ConfigModule],
  controllers: [PremiumController],
  providers: [PremiumService, XsollaService],
  exports: [PremiumService],
})
export class PremiumModule {}
