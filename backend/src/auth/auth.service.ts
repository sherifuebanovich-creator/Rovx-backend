import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { MailService } from '../mail/mail.service';
import { VerificationService } from './verification.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  iat?: number;
  exp?: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private redis: RedisService,
    private mailService: MailService,
    private verificationService: VerificationService,
  ) {}

  async register(dto: RegisterDto) {
    const existingEmail = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existingEmail) {
      throw new ConflictException('Email already registered');
    }

    const existingUsername = await this.prisma.user.findUnique({
      where: { username: dto.username },
    });
    if (existingUsername) {
      throw new ConflictException('Username already taken');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        username: dto.username,
        displayName: dto.displayName || dto.username,
        passwordHash,
        preferredLang: dto.lang || 'ru',
        preferences: {
          create: {},
        },
      },
      include: {
        preferences: true,
      },
    });

    const code = await this.verificationService.generateCode(user.email);
    await this.mailService.sendVerificationCode(user.email, code);

    this.logger.log(`New user registered: ${user.email}`);
    return {
      user: this.sanitizeUser(user),
      needsVerification: true,
      message: 'Registration successful. Please verify your email.',
    };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: dto.identifier }, { username: dto.identifier }],
      },
    });

    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.isBanned) {
      throw new UnauthorizedException('Account has been banned');
    }

    if (!user.isVerified) {
      return { needsVerification: true, email: user.email };
    }

    const tokens = await this.generateTokens(user.id, user.email, user.role);
    await this.saveRefreshToken(user.id, tokens.refreshToken, dto.deviceInfo);

    return {
      user: this.sanitizeUser(user),
      ...tokens,
    };
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    try {
      const refreshSecret = this.configService.get<string>('JWT_REFRESH_SECRET');
      if (!refreshSecret) {
        this.logger.error('JWT_REFRESH_SECRET is not set');
        throw new UnauthorizedException('Server configuration error');
      }
      const payload = this.jwtService.verify<JwtPayload>(refreshToken, {
        secret: refreshSecret,
      });

      const lockKey = `refresh:lock:${payload.sub}`;
      let locked = true;
      try {
        locked = await this.redis.setnx(lockKey, '1', 5);
      } catch (e) {
        this.logger.warn(`Redis unavailable for refresh lock, proceeding without it: ${(e as Error).message}`);
      }
      if (!locked) {
        // A concurrent refresh (from another in-flight request racing on the
        // same expired access token) is already rotating this user's token.
        // This is a 409, not a 401 — the session itself is fine, the caller
        // just needs to retry shortly once the other request's new token
        // lands. Frontend code distinguishes this from a genuinely invalid
        // refresh token so it doesn't treat this as a logout signal.
        throw new ConflictException('Token refresh in progress, try again');
      }

      try {
        let storedToken = await this.redis.hget(`refresh:${payload.sub}`, 'token');
        if (!storedToken || storedToken !== refreshToken) {
          const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
          storedToken = user?.refreshToken || null;
        }

        if (!storedToken || storedToken !== refreshToken) {
          throw new UnauthorizedException('Invalid refresh token');
        }

        const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
        if (!user || !user.isActive || user.isBanned) {
          throw new UnauthorizedException('User not active');
        }

        const tokens = await this.generateTokens(user.id, user.email, user.role);
        await this.saveRefreshToken(user.id, tokens.refreshToken);
        return tokens;
      } finally {
        await this.redis.del(lockKey);
      }
    } catch (e) {
      if (e instanceof UnauthorizedException || e instanceof ConflictException) throw e;
      this.logger.error(`Token refresh failed: ${e instanceof Error ? e.message : String(e)}`);
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  async logout(userId: string, accessToken?: string): Promise<void> {
    if (accessToken) {
      try {
        const payload = this.jwtService.decode(accessToken) as JwtPayload;
        if (payload?.iat) {
          // Blacklist for the *actual* configured access-token lifetime, not a
          // hardcoded 15m — otherwise a longer JWT_EXPIRES_IN would let a
          // "logged out" token become valid again once the blacklist entry
          // (wrongly) expires before the token itself does.
          const ttl = this.parseDurationSeconds(
            this.configService.get<string>('JWT_EXPIRES_IN'),
            900,
          );
          await this.redis.set(`blacklist:${userId}:${payload.iat}`, 'true', ttl);
        }
      } catch {
        // Token decode failed — proceed with basic logout
      }
    }
    await this.redis.del(`refresh:${userId}`);
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: null },
    });
  }

  async validateUser(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user && user.passwordHash && (await bcrypt.compare(password, user.passwordHash))) {
      const { passwordHash, ...result } = user;
      return result;
    }
    return null;
  }

  async validateJwtPayload(payload: JwtPayload) {
    const blacklisted = await this.redis.exists(`blacklist:${payload.sub}:${payload.iat}`);
    if (blacklisted) return null;

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        username: true,
        displayName: true,
        avatar: true,
        role: true,
        subscription: true,
        isActive: true,
        isBanned: true,
        preferredLang: true,
      },
    });

    if (!user || !user.isActive || user.isBanned) return null;
    return user;
  }

  private async generateTokens(userId: string, email: string, role: string): Promise<TokenPair> {
    const payload: JwtPayload = { sub: userId, email, role };
    const jwtSecret = this.configService.get<string>('JWT_SECRET');
    const refreshSecret = this.configService.get<string>('JWT_REFRESH_SECRET');
    if (!jwtSecret || !refreshSecret) {
      this.logger.error('JWT_SECRET or JWT_REFRESH_SECRET is not set');
      throw new Error('Server configuration error: JWT secrets not configured');
    }

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: jwtSecret,
        expiresIn: this.configService.get('JWT_EXPIRES_IN', '15m'),
      }),
      this.jwtService.signAsync(payload, {
        secret: refreshSecret,
        expiresIn: this.configService.get('JWT_REFRESH_EXPIRES_IN', '30d'),
      }),
    ]);

    return { accessToken, refreshToken };
  }

  private async saveRefreshToken(userId: string, token: string, deviceInfo?: string): Promise<void> {
    const ttl = 30 * 24 * 60 * 60; // 30 days
    await this.redis.hset(`refresh:${userId}`, 'token', token);
    await this.redis.expire(`refresh:${userId}`, ttl);
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: token },
    });
    if (deviceInfo) {
      await this.prisma.session.create({
        data: {
          userId,
          refreshToken: token,
          deviceInfo,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      }).catch(() => {});
    }
  }

  /**
   * Verifies a Google ID token against Google's tokeninfo endpoint so the caller
   * cannot forge the email/sub of an account it doesn't control. Never trust
   * client-supplied email/googleId directly for auth decisions.
   */
  private async verifyGoogleIdToken(idToken: string): Promise<{ email: string; sub: string; name?: string; picture?: string }> {
    if (!idToken) {
      throw new UnauthorizedException('Missing Google ID token');
    }
    let res: Response;
    try {
      res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
    } catch {
      throw new UnauthorizedException('Failed to verify Google ID token');
    }
    if (!res.ok) {
      throw new UnauthorizedException('Invalid Google ID token');
    }
    const payload = await res.json();
    // Fail closed: without this, an ID token issued to ANY Google OAuth
    // client (not just ours) with a verified email would be accepted here,
    // letting an attacker log in as / take over any ROVX account by
    // replaying a Google ID token obtained from an unrelated site's own
    // "Sign in with Google" button.
    const expectedAud = this.configService.get<string>('GOOGLE_CLIENT_ID');
    if (!expectedAud) {
      this.logger.error('GOOGLE_CLIENT_ID is not set — rejecting Google sign-in');
      throw new UnauthorizedException('Google sign-in is not configured');
    }
    if (payload.aud !== expectedAud) {
      throw new UnauthorizedException('Google ID token audience mismatch');
    }
    if (payload.email_verified !== 'true' && payload.email_verified !== true) {
      throw new UnauthorizedException('Google email not verified');
    }
    if (!payload.email || !payload.sub) {
      throw new UnauthorizedException('Invalid Google ID token payload');
    }
    return { email: payload.email, sub: payload.sub, name: payload.name, picture: payload.picture };
  }

  async googleAuth(data: {
    idToken: string;
    displayName?: string;
    avatar?: string;
    lang?: string;
    deviceInfo?: string;
  }) {
    const verified = await this.verifyGoogleIdToken(data.idToken);
    const email = verified.email;
    const googleId = verified.sub;
    const displayName = verified.name || data.displayName;
    const avatar = verified.picture || data.avatar;

    const existingGoogleLink = await this.prisma.user.findFirst({ where: { googleId } });
    if (existingGoogleLink && existingGoogleLink.email !== email) {
      throw new ConflictException('This Google account is already linked to a different user');
    }

    let user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      // Auto-register Google user
      const username = email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 30);
      let finalUsername = username;
      let counter = 1;
      while (await this.prisma.user.findUnique({ where: { username: finalUsername } })) {
        finalUsername = `${username}${counter++}`;
      }

      try {
        user = await this.prisma.user.create({
          data: {
            email,
            username: finalUsername,
            displayName: displayName || finalUsername,
            avatar,
            passwordHash: '',
            preferredLang: data.lang || 'ru',
            googleId,
            isVerified: true,
            preferences: {
              create: {},
            },
          },
        });
      } catch (err: any) {
        if (err?.code === 'P2002') {
          const fallback = `${finalUsername}_${Date.now().toString(36)}`;
          user = await this.prisma.user.create({
            data: {
              email,
              username: fallback,
              displayName: displayName || fallback,
              avatar,
              passwordHash: '',
              preferredLang: data.lang || 'ru',
              googleId,
              isVerified: true,
              preferences: { create: {} },
            },
          });
        } else {
          throw err;
        }
      }
    } else if (!user.googleId) {
      // Link Google to existing account
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { googleId, avatar: avatar || user.avatar },
      });
      await this.prisma.userPreference.upsert({
        where: { userId: user.id },
        create: { userId: user.id },
        update: {},
      }).catch(() => {});
    }

    const tokens = await this.generateTokens(user.id, user.email, user.role);
    await this.saveRefreshToken(user.id, tokens.refreshToken, data.deviceInfo);

    return { user: this.sanitizeUser(user), ...tokens };
  }

  async sendVerification(email: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.isVerified) {
      return { message: 'Verification code sent' };
    }

    const code = await this.verificationService.generateCode(email);
    await this.mailService.sendVerificationCode(email, code);

    return { message: 'Verification code sent' };
  }

  async verifyEmail(email: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new BadRequestException('User not found');
    }
    if (user.isVerified) {
      throw new BadRequestException('Email already verified');
    }

    const valid = await this.verificationService.verifyCode(email, code);
    if (!valid) {
      throw new BadRequestException('Invalid or expired verification code');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { isVerified: true },
    });

    const tokens = await this.generateTokens(user.id, user.email, user.role);
    await this.saveRefreshToken(user.id, tokens.refreshToken);

    this.logger.log(`Email verified for ${email}`);
    return { message: 'Email verified successfully', user: this.sanitizeUser(user), ...tokens };
  }

  async sendForgotPassword(email: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      return { message: 'If the email exists, a reset code has been sent.' };
    }
    if (!user.passwordHash) {
      return { message: 'If the email exists, a reset code has been sent.' };
    }

    const code = await this.verificationService.generateCode(`reset:${email}`);
    await this.mailService.sendVerificationCode(email, code);

    this.logger.log(`Password reset code sent to ${email}`);
    return { message: 'If the email exists, a reset code has been sent.' };
  }

  async resetPassword(email: string, code: string, newPassword: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new BadRequestException('User not found');
    }
    if (!user.passwordHash) {
      throw new BadRequestException('Cannot reset password for Google-only accounts');
    }

    const valid = await this.verificationService.verifyCode(`reset:${email}`, code);
    if (!valid) {
      throw new BadRequestException('Invalid or expired reset code');
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    await this.logout(user.id);

    this.logger.log(`Password reset for ${email}`);
    return { message: 'Password reset successfully' };
  }

  private sanitizeUser(user: any) {
    const { passwordHash, refreshToken, ...safe } = user;
    return safe;
  }

  /** Parses strings like "15m", "1h", "30d", "900" (jsonwebtoken-style) into seconds. */
  private parseDurationSeconds(value: string | undefined, fallbackSeconds: number): number {
    if (!value) return fallbackSeconds;
    const trimmed = value.trim();
    const match = /^(\d+)\s*(ms|s|m|h|d)?$/i.exec(trimmed);
    if (!match) {
      const asNumber = Number(trimmed);
      return Number.isFinite(asNumber) && asNumber > 0 ? asNumber : fallbackSeconds;
    }
    const num = parseInt(match[1], 10);
    const unit = (match[2] || 's').toLowerCase();
    const multiplier = unit === 'ms' ? 0.001 : unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : 86400;
    const seconds = Math.round(num * multiplier);
    return seconds > 0 ? seconds : fallbackSeconds;
  }
}
