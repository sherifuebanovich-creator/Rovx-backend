import { Controller, Post, Get, Body, Query, UseGuards } from '@nestjs/common';
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
    return this.aiService.analyzeRouteAndSuggest(userId, ctx);
  }

  @Post('voice-command')
  @ApiOperation({ summary: 'Process voice command' })
  async voiceCommand(@CurrentUser('id') userId: string, @Body() cmd: any) {
    return this.aiService.processVoiceCommand(userId, cmd);
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
