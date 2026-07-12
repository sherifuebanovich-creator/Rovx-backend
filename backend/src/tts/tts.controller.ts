import { Controller, Post, Body, Res, Logger, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { TtsService } from './tts.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@ApiTags('TTS')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tts')
export class TtsController {
  private readonly logger = new Logger(TtsController.name);

  constructor(private ttsService: TtsService) {}

  @Post('synthesize')
  @ApiOperation({ summary: 'Synthesize speech via Microsoft Edge Neural TTS' })
  async synthesize(
    @Body() body: { text: string; lang?: string },
    @Res() res: Response,
  ) {
    if (!body.text) {
      return res.status(400).json({ message: 'Text is required' });
    }

    if (body.text.length > 500) {
      return res.status(400).json({ message: 'Text too long (max 500 characters)' });
    }

    try {
      const audioBuffer = await this.ttsService.synthesize(body.text, body.lang || 'ru');

      res.set({
        'Content-Type': 'audio/mpeg',
        'Content-Length': audioBuffer.length.toString(),
        'Cache-Control': 'private, max-age=3600',
      });
      return res.send(audioBuffer);
    } catch (error) {
      this.logger.error(`TTS synthesis failed: ${error instanceof Error ? error.message : String(error)}`);
      return res.status(502).json({ message: 'TTS service unavailable' });
    }
  }
}
