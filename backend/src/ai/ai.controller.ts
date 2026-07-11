import { Controller, Post, Get, Body, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AiService } from './ai.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('AI')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ai')
export class AiController {
  constructor(private aiService: AiService) {}

  @Post('analyze-route')
  @ApiOperation({ summary: 'AI route analysis and suggestions' })
  async analyzeRoute(@CurrentUser('id') userId: string, @Body() ctx: any) {
    if (!ctx || typeof ctx !== 'object') throw new BadRequestException('Invalid request body');
    const sanitized = {
      ...ctx,
      originName: typeof ctx.originName === 'string' ? ctx.originName.slice(0, 200).replace(/[\x00-\x1f]/g, '') : '',
      destName: typeof ctx.destName === 'string' ? ctx.destName.slice(0, 200).replace(/[\x00-\x1f]/g, '') : '',
    };
    return this.aiService.analyzeRouteAndSuggest(userId, sanitized);
  }

  @Post('voice-command')
  @ApiOperation({ summary: 'Process voice command' })
  async voiceCommand(@CurrentUser('id') userId: string, @Body() cmd: any) {
    if (!cmd || typeof cmd !== 'object') throw new BadRequestException('Invalid request body');
    if (!cmd.command || typeof cmd.command !== 'string') throw new BadRequestException('command is required');
    const sanitized = {
      ...cmd,
      command: cmd.command.slice(0, 500).replace(/[\x00-\x08\x0e-\x1f]/g, ''),
    };
    return this.aiService.processVoiceCommand(userId, sanitized);
  }

  @Get('suggestions')
  @ApiOperation({ summary: 'Get smart contextual suggestions' })
  async getSuggestions(
    @CurrentUser('id') userId: string,
    @Query('lat') lat: number,
    @Query('lng') lng: number,
  ) {
    return this.aiService.getSmartSuggestions(userId, +lat, +lng);
  }

  @Post('turn-instruction')
  @ApiOperation({ summary: 'Generate AI voice turn instruction' })
  async turnInstruction(
    @CurrentUser('preferredLang') lang: string,
    @Body() data: any,
  ) {
    return this.aiService.generateTurnInstruction(data.instruction, lang || 'ru', data.context || {});
  }
}
