import { Controller, Post, Get, Body, UseGuards, BadRequestException } from '@nestjs/common';
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
    this.validateFuelDto(dto);
    return this.fuelService.calculateAndSave(userId, dto);
  }

  @Post('estimate')
  @ApiOperation({ summary: 'Quick estimate without saving' })
  estimate(@Body() dto: any) {
    this.validateFuelDto(dto);
    return this.fuelService.calculate(dto);
  }

  private validateFuelDto(dto: any) {
    if (!dto || typeof dto !== 'object') throw new BadRequestException('Invalid request body');
    const coords = ['originLat', 'originLng', 'destLat', 'destLng'];
    for (const key of coords) {
      const val = dto[key];
      if (typeof val !== 'number' || !isFinite(val)) {
        throw new BadRequestException(`${key} must be a valid number`);
      }
    }
    if (dto.originLat < -90 || dto.originLat > 90 || dto.destLat < -90 || dto.destLat > 90) {
      throw new BadRequestException('Latitude must be between -90 and 90');
    }
    if (dto.originLng < -180 || dto.originLng > 180 || dto.destLng < -180 || dto.destLng > 180) {
      throw new BadRequestException('Longitude must be between -180 and 180');
    }
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
