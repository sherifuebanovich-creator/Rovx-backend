import { Controller, Get, Post, Body, UseGuards, Query, Req, Logger } from '@nestjs/common';
import { Request } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiExcludeEndpoint } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PremiumService } from './premium.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Premium')
@Controller('premium')
export class PremiumController {
  private readonly logger = new Logger(PremiumController.name);
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
  @Post('stripe-checkout')
  @ApiOperation({ summary: 'Create Stripe checkout session' })
  createStripeCheckout(
    @CurrentUser('id') userId: string,
    @Body() body: { tierName: string },
  ) {
    return this.premiumService.createStripeCheckout(userId, body.tierName);
  }

  @Public()
  @Post('webhook-stripe')
  @ApiExcludeEndpoint()
  async webhookStripe(@Req() req: Request) {
    const sig = req.headers['stripe-signature'] as string;
    const rawBody = (req as any).rawBody || '';
    const body = (req as any).body;

    if (!this.premiumService.isStripeConfigured()) {
      return { ok: true };
    }

    const event = this.premiumService.verifyStripeWebhook(rawBody, sig);
    if (!event) {
      this.logger?.warn('Stripe webhook signature verification failed');
      return { received: false };
    }

    try {
      await this.premiumService.handleStripeWebhook(event);
    } catch (e) {
      this.logger?.error('Stripe webhook processing error', e);
      throw e;
    }
    return { received: true };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('lemon-squeezy-checkout')
  @ApiOperation({ summary: 'Create Lemon Squeezy checkout session' })
  createLemonSqueezyCheckout(
    @CurrentUser('id') userId: string,
    @Body() body: { tierName: string },
  ) {
    return this.premiumService.createLemonSqueezyCheckout(userId, body.tierName);
  }

  @Public()
  @Post('webhook-lemon-squeezy')
  @ApiExcludeEndpoint()
  async webhookLemonSqueezy(@Req() req: Request) {
    const rawBody = (req as any).rawBody || '';
    const signature = req.headers['x-signature'] as string || '';
    const body = (req as any).body || JSON.parse(rawBody || '{}');

    if (!this.premiumService.verifyLemonSqueezyWebhook(rawBody, signature)) {
      this.logger.warn('Lemon Squeezy webhook signature verification failed — rejecting');
      return { received: false };
    }

    return this.premiumService.handleLemonSqueezyWebhook(body);
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
