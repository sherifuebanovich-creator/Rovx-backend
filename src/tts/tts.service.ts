import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import { join } from 'path';
import { unlinkSync, readFileSync } from 'fs';
import { tmpdir } from 'os';

const VOICE_MAP: Record<string, string> = {
  ru: 'ru-RU-SvetlanaNeural',
  en: 'en-US-AriaNeural',
  uz: 'uz-UZ-MadinaNeural',
  kk: 'kk-KZ-AigulNeural',
  tr: 'tr-TR-EmelNeural',
  de: 'de-DE-KatjaNeural',
  fr: 'fr-FR-DeniseNeural',
  es: 'es-ES-ElviraNeural',
  it: 'it-IT-ElsaNeural',
  pt: 'pt-BR-FranciscaNeural',
  pl: 'pl-PL-ZofiaNeural',
  nl: 'nl-NL-FennaNeural',
  sv: 'sv-SE-SofieNeural',
  da: 'da-DK-ChristelNeural',
  nb: 'nb-NO-PernilleNeural',
  fi: 'fi-FI-NooraNeural',
  cs: 'cs-CZ-VlastaNeural',
  hu: 'hu-HU-NoemiNeural',
  ro: 'ro-RO-AlinaNeural',
  bg: 'bg-BG-KalinaNeural',
  el: 'el-GR-AthinaNeural',
  sr: 'sr-RS-SophieNeural',
  hr: 'hr-HR-GabrijelaNeural',
  uk: 'uk-UA-PolinaNeural',
  ar: 'ar-SA-ZariyahNeural',
  he: 'he-IL-HilaNeural',
  hi: 'hi-IN-SwaraNeural',
  bn: 'bn-IN-TanishaaNeural',
  ta: 'ta-IN-PallaviNeural',
  th: 'th-TH-PremwadeeNeural',
  vi: 'vi-VN-HoaiMyNeural',
  id: 'id-ID-GadisNeural',
  ms: 'ms-MY-YasminNeural',
  tl: 'fil-PH-BlessicaNeural',
  zh: 'zh-CN-XiaoxiaoNeural',
  ja: 'ja-JP-NanamiNeural',
  ko: 'ko-KR-SunHiNeural',
  az: 'az-AZ-BanuNeural',
  ka: 'ka-GE-EkaNeural',
  hy: 'hy-AM-AnahitNeural',
  sw: 'sw-KE-ZuriNeural',
  ha: 'ha-NG-AminaLatsoNeural',
  yo: 'yo-NG-MoyoNeural',
  ig: 'ig-NG-ChinweNeural',
  zu: 'zu-ZA-ThandoNeural',
  am: 'am-ET-MekdesNeural',
};

@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);

  async synthesize(text: string, lang: string = 'ru'): Promise<Buffer> {
    const voice = VOICE_MAP[lang] || VOICE_MAP.en || 'en-US-AriaNeural';
    const tmpFile = join(tmpdir(), `rovx_tts_${Date.now()}_${Math.random().toString(36).slice(2)}.mp3`);

    try {
      const textSafe = text.replace(/["\n\r\t]/g, ' ').substring(0, 5000);
      const child = spawn('edge-tts', ['--voice', voice, '--text', textSafe, '--write-media', tmpFile], {
        timeout: 30000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderr = '';
      child.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

      await new Promise<void>((resolve, reject) => {
        child.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`edge-tts exited with code ${code}: ${stderr || 'unknown error'}`));
        });
        child.on('error', reject);
      });

      if (stderr) {
        this.logger.warn(`edge-tts stderr: ${stderr}`);
      }

      const buffer = readFileSync(tmpFile);
      return buffer;
    } catch (error) {
      this.logger.error(`Edge TTS failed for lang=${lang} voice=${voice}: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    } finally {
      try { unlinkSync(tmpFile); } catch {}
    }
  }

  getSupportedLanguages(): string[] {
    return Object.keys(VOICE_MAP);
  }

  getVoiceForLang(lang: string): string {
    return VOICE_MAP[lang] || VOICE_MAP.en || 'en-US-AriaNeural';
  }
}
