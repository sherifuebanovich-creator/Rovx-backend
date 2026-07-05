import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PremiumController } from './premium.controller';
import { PremiumService } from './premium.service';

@Module({
  imports: [ConfigModule],
  controllers: [PremiumController],
  providers: [PremiumService],
  exports: [PremiumService],
})
export class PremiumModule {}
