import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { FuelService } from './fuel.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Fuel')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('fuel')
export class FuelController {
  constructor(private fuelService: FuelService) {}

  @Post('calculate')
  @ApiOperation({ summary: 'Calculate fuel consumption and cost' })
  calculate(@CurrentUser('id') userId: string, @Body() dto: any) {
    return this.fuelService.calculateAndSave(userId, dto);
  }

  @Post('estimate')
  @ApiOperation({ summary: 'Quick estimate without saving' })
  estimate(@Body() dto: any) {
    return this.fuelService.calculate(dto);
  }

  @Get('history')
  @ApiOperation({ summary: 'Get fuel calculation history' })
  getHistory(@CurrentUser('id') userId: string) {
    return this.fuelService.getHistory(userId);
  }

  @Get('prices')
  @ApiOperation({ summary: 'Get current fuel prices' })
  getPrices() {
    return this.fuelService.getFuelPrices();
  }
}
