import { Controller, Post, Body, Res, Logger, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { TtsService } from './tts.service';

// No @UseGuards(JwtAuthGuard)/@ApiBearerAuth() here on purpose: the frontend's
// useVoiceAssistant.speak() calls this endpoint with a plain unauthenticated
// fetch() (no Authorization header), so requiring auth meant every request
// was rejected with 401 and silently fell back to the browser's built-in
// SpeechSynthesisUtterance — the neural TTS voice never actually played.
// This endpoint only takes text/lang/gender, no user-specific/private data,
// matching other public map/nav endpoints (e.g. /map/search) that work for
// guests too. Nothing else in the codebase depends on this guard (no
// rate-limiting or quota tracking keyed off it) — see TtsModule/TtsService.
@ApiTags('TTS')
@Controller('tts')
export class TtsController {
  private readonly logger = new Logger(TtsController.name);

  constructor(private ttsService: TtsService) {}

  @Post('synthesize')
  @ApiOperation({ summary: 'Synthesize speech via Microsoft Edge Neural TTS' })
  async synthesize(
    @Body() body: { text: string; lang?: string; gender?: string },
    @Res() res: Response,
  ) {
    // Thrown instead of hand-built via res.status().json(): @Res() only
    // opts this handler out of Nest auto-sending the return value, it does
    // not bypass the global HttpExceptionFilter — throwing here keeps the
    // error body in the same { success, statusCode, message, ... } shape
    // every other endpoint in the API produces, instead of the bespoke
    // { message } shape this route was returning on its own.
    if (!body.text) {
      throw new BadRequestException('Text is required');
    }

    if (body.text.length > 500) {
      throw new BadRequestException('Text too long (max 500 characters)');
    }

    const gender = body.gender === 'MALE' ? 'MALE' : 'FEMALE';

    try {
      const audioBuffer = await this.ttsService.synthesize(body.text, body.lang || 'ru', gender);

      res.set({
        'Content-Type': 'audio/mpeg',
        'Content-Length': audioBuffer.length.toString(),
        'Cache-Control': 'private, max-age=3600',
      });
      return res.send(audioBuffer);
    } catch (error) {
      this.logger.error(`TTS synthesis failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new ServiceUnavailableException('TTS service unavailable');
    }
  }
}
