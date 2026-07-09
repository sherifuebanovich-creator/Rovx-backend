import { Controller, Get, Post, Body, UseGuards, Query, Req } from '@nestjs/common';
import { Request } from 'express';
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
  @ApiOperation({ summary: 'Create Xsolla checkout session' })
  createCheckout(
    @CurrentUser('id') userId: string,
    @Body() body: { tierName: string; months?: number },
    @Req() req: Request,
  ) {
    const lang = (req.headers['accept-language'] as string) || 'ru';
    return this.premiumService.createCheckoutSession(userId, body.tierName, body.months || 1, lang);
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
  async webhook(@Req() req: Request) {
    const authHeader = req.headers['authorization'] as string || '';
    const rawBody = (req as any).rawBody || '';
    return this.premiumService.handleWebhook(rawBody, authHeader);
  }
}
