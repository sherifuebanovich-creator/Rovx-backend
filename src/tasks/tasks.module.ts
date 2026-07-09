import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TasksService } from './tasks.service';
import { AdminModule } from '../admin/admin.module';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    AdminModule,
    TelegramModule,
  ],
  providers: [TasksService],
})
export class TasksModule {}
