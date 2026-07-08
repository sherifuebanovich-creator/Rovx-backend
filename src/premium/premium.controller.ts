import { Controller, Get, Post, Body, UseGuards, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiExcludeEndpoint } from '@nestjs/swagger';
import { PremiumService } from './premium.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Premium')
@Controller('premium')
export class PremiumController {
  constructor(private premiumService: PremiumService) {}

  @Get('tiers')
  @ApiOperation({ summary: 'Get all premium tiers' })
  getTiers(@Query('lang') lang?: string) {
    return this.premiumService.getTiers(lang);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('my')
  @ApiOperation({ summary: 'Get my subscription info' })
  getMy(@CurrentUser('id') userId: string) {
    return this.premiumService.getMySubscription(userId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('create-checkout')
  @ApiOperation({ summary: 'Create Lava checkout session' })
  createCheckout(
    @CurrentUser('id') userId: string,
    @Body() body: { tierName: string; months?: number },
  ) {
    return this.premiumService.createCheckoutSession(userId, body.tierName, body.months || 1);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('cancel')
  @ApiOperation({ summary: 'Cancel subscription' })
  cancel(@CurrentUser('id') userId: string) {
    return this.premiumService.cancelSubscription(userId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('can-create-group')
  @ApiOperation({ summary: 'Check if user can create a group' })
  canCreateGroup(@CurrentUser('id') userId: string) {
    return this.premiumService.canCreateGroup(userId);
  }

  @Public()
  @Post('webhook')
  @ApiExcludeEndpoint()
  async webhook(@Body() body: any) {
    await this.premiumService.handleWebhook(body);
    return { received: true };
  }

  @Public()
  @Get('test-lava')
  @ApiExcludeEndpoint()
  async testLava() {
    const axios = require('axios');
    const apiKey = process.env.LAVA_API_KEY || 'not-set';
    try {
      const res = await axios.post('https://gate.lava.top/api/v3/invoice', {
        email: 'test@lava.top',
        offerId: 'af64d6fe-b677-47e1-a9a3-9777fb2e6b58',
        currency: 'USD',
        amount: 4.99,
      }, {
        headers: {
          'X-Api-Key': apiKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        timeout: 15000,
      });
      return { success: true, data: res.data, apiKeyPrefix: apiKey.substring(0, 8) + '...' };
    } catch (err: any) {
      return { success: false, error: err.message, details: err.response?.data, apiKeyPrefix: apiKey.substring(0, 8) + '...' };
    }
  }
}
