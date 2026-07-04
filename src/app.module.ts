import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { HealthController } from './health.controller';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { MailModule } from './mail/mail.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { RoutesModule } from './routes/routes.module';
import { MapModule } from './map/map.module';
import { ReportsModule } from './reports/reports.module';
import { AiModule } from './ai/ai.module';
import { SocialModule } from './social/social.module';
import { AdminModule } from './admin/admin.module';
import { WebsocketModule } from './websocket/websocket.module';
import { TtsModule } from './tts/tts.module';
import { TelegramModule } from './telegram/telegram.module';
import { PremiumModule } from './premium/premium.module';
import { FuelModule } from './fuel/fuel.module';
import { FriendsModule } from './friends/friends.module';

@Module({
  controllers: [HealthController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          name: 'short',
          ttl: 1000,
          limit: config.get('THROTTLE_SHORT_LIMIT', 10),
        },
        {
          name: 'medium',
          ttl: 10000,
          limit: config.get('THROTTLE_MEDIUM_LIMIT', 50),
        },
        {
          name: 'long',
          ttl: 60000,
          limit: config.get('THROTTLE_LONG_LIMIT', 200),
        },
      ],
    }),
    PrismaModule,
    RedisModule,
    MailModule,
    AuthModule,
    UsersModule,
    RoutesModule,
    MapModule,
    ReportsModule,
    AiModule,
    SocialModule,
    AdminModule,
    WebsocketModule,
    TtsModule,
    TelegramModule,
    PremiumModule,
    FuelModule,
    FriendsModule,
  ],
})
export class AppModule {}
