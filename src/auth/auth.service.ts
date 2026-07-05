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

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.isBanned) {
      throw new UnauthorizedException(`Account banned: ${user.bannedReason}`);
    }

    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isVerified) {
      return { needsVerification: true, email: user.email };
    }

    const tokens = await this.generateTokens(user.id, user.email, user.role);
    await this.saveRefreshToken(user.id, tokens.refreshToken, dto.deviceInfo);

    return {
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.displayName,
        avatar: user.avatar,
        role: user.role,
        subscription: user.subscription,
        preferredLang: user.preferredLang,
        driverScore: user.driverScore,
        reputation: user.reputation,
        totalTrips: user.totalTrips,
        totalDistance: user.totalDistance,
        preferredVehicle: user.preferredVehicle,
      },
      ...tokens,
    };
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    try {
      const payload = this.jwtService.verify<JwtPayload>(refreshToken, {
        secret: this.configService.get('JWT_REFRESH_SECRET', 'change-me-in-production'),
      });

      const storedToken = await this.redis.hget(`refresh:${payload.sub}`, 'token');
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
    } catch (e) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  async logout(userId: string, accessToken?: string): Promise<void> {
    if (accessToken) {
      try {
        const payload = this.jwtService.decode(accessToken) as JwtPayload;
        if (payload?.iat) {
          const ttl = 900; // 15 min blacklist (token expiry)
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
    if (user && (await bcrypt.compare(password, user.passwordHash))) {
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

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.get('JWT_SECRET', 'change-me-in-production'),
        expiresIn: this.configService.get('JWT_EXPIRES_IN', '15m'),
      }),
      this.jwtService.signAsync(payload, {
        secret: this.configService.get('JWT_REFRESH_SECRET', 'change-me-in-production'),
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

  async googleAuth(data: {
    email: string;
    displayName: string;
    avatar?: string;
    googleId: string;
    lang?: string;
    deviceInfo?: string;
  }) {
    let user = await this.prisma.user.findUnique({ where: { email: data.email } });

    if (!user) {
      // Auto-register Google user
      const username = data.email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 30);
      let finalUsername = username;
      let counter = 1;
      while (await this.prisma.user.findUnique({ where: { username: finalUsername } })) {
        finalUsername = `${username}${counter++}`;
      }

      user = await this.prisma.user.create({
        data: {
          email: data.email,
          username: finalUsername,
          displayName: data.displayName || finalUsername,
          avatar: data.avatar,
          passwordHash: '',
          preferredLang: data.lang || 'en',
          googleId: data.googleId,
          isVerified: true,
          preferences: {
            create: {},
          },
        },
      });
    } else if (!user.googleId) {
      // Link Google to existing account
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { googleId: data.googleId, avatar: data.avatar || user.avatar },
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
    if (!user) {
      throw new BadRequestException('User not found');
    }
    if (user.isVerified) {
      throw new BadRequestException('Email already verified');
    }

    const code = await this.verificationService.generateCode(email);
    await this.mailService.sendVerificationCode(email, code);

    return { message: 'Verification code sent' };
  }

  async verifyEmail(email: string, code: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new BadRequestException('User not found');
    }
    if (user.isVerified) {
      return { message: 'Email already verified' };
    }

    const valid = await this.verificationService.verifyCode(email, code);
    if (!valid) {
      throw new BadRequestException('Invalid or expired verification code');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { isVerified: true },
    });

    this.logger.log(`Email verified for ${email}`);
    return { message: 'Email verified successfully' };
  }

  private sanitizeUser(user: any) {
    const { passwordHash, refreshToken, ...safe } = user;
    return safe;
  }
}
