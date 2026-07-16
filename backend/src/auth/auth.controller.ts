import {
  Controller,
  Post,
  Body,
  Headers,
  UseGuards,
  Get,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { SendVerificationDto } from './dto/send-verification.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private prisma: PrismaService,
  ) {}

  @Post('register')
  @Throttle({ short: { limit: 3, ttl: 60000 } })
  @ApiOperation({ summary: 'Register a new user' })
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Login with email/username and password' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(dto);
    if ((result as any).refreshToken) {
      res.cookie('refresh_token', (result as any).refreshToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        path: '/',
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });
    }
    return result;
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token' })
  async refresh(
    @Headers('x-refresh-token') headerToken: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = headerToken || (req as any).cookies?.refresh_token;
    if (!refreshToken) {
      throw new BadRequestException('Refresh token required');
    }

    const tokens = await this.authService.refresh(refreshToken);

    res.cookie('refresh_token', tokens.refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    return tokens;
  }

  @Post('refresh-cookie')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token via httpOnly cookie' })
  async refreshCookie(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = (req as any).cookies?.refresh_token;
    if (!refreshToken) {
      throw new BadRequestException('Refresh token required');
    }

    const tokens = await this.authService.refresh(refreshToken);

    res.cookie('refresh_token', tokens.refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    return tokens;
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout current user' })
  async logout(
    @CurrentUser() user: any,
    @Headers('authorization') authHeader: string,
  ) {
    const token = authHeader?.replace('Bearer ', '');
    await this.authService.logout(user.id, token);
    return { message: 'Logged out successfully' };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user' })
  async me(@CurrentUser() user: any) {
    return { user };
  }

  @Post('google')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login or register with Google OAuth' })
  async googleAuth(
    @Body() body: { email: string; displayName: string; avatar?: string; googleId: string; lang?: string; deviceInfo?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.googleAuth(body);
    if ((result as any).refreshToken) {
      res.cookie('refresh_token', (result as any).refreshToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        path: '/',
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });
    }
    return result;
  }

  @Post('send-verification')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { limit: 1, ttl: 60000 } })
  @ApiOperation({ summary: 'Send email verification code' })
  async sendVerification(@Body() dto: SendVerificationDto) {
    return this.authService.sendVerification(dto.email);
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Verify email with code' })
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto.email, dto.code);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { limit: 3, ttl: 60000 } })
  @ApiOperation({ summary: 'Send password reset code' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.sendForgotPassword(dto.email);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Reset password with code' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.email, dto.code, dto.newPassword);
  }

  @Post('bootstrap-admin')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { limit: 1, ttl: 300000 } })
  @ApiOperation({ summary: 'Create first admin (only works when zero admins exist)' })
  async bootstrapAdmin(@Body() body: { email: string; password: string }) {
    if (!body.email || !body.password) {
      throw new BadRequestException('email and password required');
    }
    if (body.password.length < 8) {
      throw new BadRequestException('password must be at least 8 characters');
    }

    const adminCount = await this.prisma.user.count({
      where: { role: { in: ['ADMIN', 'SUPERADMIN'] } },
    });
    if (adminCount > 0) {
      throw new BadRequestException('Admin already exists. Use /admin/users/:id/role to promote users.');
    }

    const hash = await bcrypt.hash(body.password, 12);
    const user = await this.prisma.user.upsert({
      where: { email: body.email },
      update: { role: 'SUPERADMIN', isVerified: true, passwordHash: hash },
      create: {
        email: body.email,
        username: body.email.split('@')[0],
        displayName: 'Admin',
        passwordHash: hash,
        role: 'SUPERADMIN',
        isVerified: true,
        preferences: { create: {} },
      },
    });

    return { message: 'Admin created', userId: user.id, email: user.email };
  }

  @Get('error')
  @ApiOperation({ summary: 'Handle auth errors' })
  async authError() {
    throw new BadRequestException('Authentication failed');
  }
}
