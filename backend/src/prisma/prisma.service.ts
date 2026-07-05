import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'stdout', level: 'info' },
        { emit: 'stdout', level: 'warn' },
        { emit: 'stdout', level: 'error' },
      ],
    });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Database connected');
    await this.ensureTables();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  private async ensureTables() {
    try {
      const result = await this.$queryRawUnsafe(
        `SELECT EXISTS (SELECT FROM pg_tables WHERE schemaname='public' AND tablename='users') as "exists"`
      ) as any;
      if (result[0]?.exists) { this.logger.log('Tables already exist'); return; }
    } catch {
      // table check failed, proceed to create
    }

    this.logger.log('Creating database tables...');

    const createTableSQLs = [
      `CREATE TABLE IF NOT EXISTS "users" (
          "id" TEXT NOT NULL,
          "email" TEXT NOT NULL,
          "username" TEXT NOT NULL,
          "displayName" TEXT NOT NULL,
          "passwordHash" TEXT NOT NULL DEFAULT '',
          "googleId" TEXT,
          "avatar" TEXT,
          "phone" TEXT,
          "bio" TEXT,
          "role" TEXT NOT NULL DEFAULT 'USER',
          "subscription" TEXT NOT NULL DEFAULT 'FREE',
          "subscriptionEnd" TIMESTAMP(3),
          "isVerified" BOOLEAN NOT NULL DEFAULT false,
          "isActive" BOOLEAN NOT NULL DEFAULT true,
          "isBanned" BOOLEAN NOT NULL DEFAULT false,
          "preferredLang" TEXT NOT NULL DEFAULT 'ru',
          "refreshToken" TEXT,
          "city" TEXT,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL,
          CONSTRAINT "users_pkey" PRIMARY KEY ("id")
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key" ON "users"("email")`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "users_username_key" ON "users"("username")`,
    ];

    for (const sql of createTableSQLs) {
      try {
        await this.$executeRawUnsafe(sql);
        this.logger.log(`Executed: ${sql.slice(0, 50)}...`);
      } catch (err: any) {
        this.logger.warn(`SQL warning: ${err.message?.slice(0, 120)}`);
      }
    }

    this.logger.log('Database tables check complete');
  }

  async cleanDatabase() {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Cannot clean database in production');
    }

    const tablenames = await this.$queryRaw<
      Array<{ tablename: string }>
    >`SELECT tablename FROM pg_tables WHERE schemaname='public'`;

    const tables = tablenames
      .map(({ tablename }) => tablename)
      .filter((name) => name !== '_prisma_migrations');

    for (const table of tables) {
      try {
        await this.$executeRawUnsafe(
          `TRUNCATE TABLE "public"."${table}" CASCADE;`,
        );
      } catch {
        // table may not exist or may have dependencies, skip safely
      }
    }
  }
}
