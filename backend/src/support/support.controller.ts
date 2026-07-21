import { Controller, Post, Body, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupportService } from './support.service';

@ApiTags('Support')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('support')
export class SupportController {
  constructor(private support: SupportService) {}

  @Post()
  @ApiOperation({ summary: 'Send a support message to the team' })
  async submit(@CurrentUser('id') userId: string, @Body() body: { message?: string }) {
    const message = body.message?.trim();
    if (!message) throw new BadRequestException('Message is required');
    if (message.length > 2000) throw new BadRequestException('Message must be 2000 characters or fewer');
    return this.support.submit(userId, message);
  }
}
