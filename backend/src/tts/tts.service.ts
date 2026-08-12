import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import { join } from 'path';
import { readFile, unlink } from 'fs/promises';
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

// Verified against a live `edge-tts --list-voices` run in this repo's dev
// environment (edge-tts 7.2.8) — every short-name below was confirmed to
// exist and be tagged "Male" at that time. Four VOICE_MAP locales — ha
// (Hausa), yo (Yoruba), ig (Igbo), hy (Armenian) — have NO corresponding
// voice in edge-tts at all currently (not male, not female; this looks like
// a pre-existing bug in VOICE_MAP itself, unrelated to gender support), so
// they're intentionally left out here and fall back to the VOICE_MAP entry
// regardless of requested gender rather than risk an invalid --voice value.
const MALE_VOICE_MAP: Record<string, string> = {
  ru: 'ru-RU-DmitryNeural',
  en: 'en-US-GuyNeural',
  uz: 'uz-UZ-SardorNeural',
  kk: 'kk-KZ-DauletNeural',
  tr: 'tr-TR-AhmetNeural',
  de: 'de-DE-ConradNeural',
  fr: 'fr-FR-HenriNeural',
  es: 'es-ES-AlvaroNeural',
  it: 'it-IT-DiegoNeural',
  pt: 'pt-BR-AntonioNeural',
  pl: 'pl-PL-MarekNeural',
  nl: 'nl-NL-MaartenNeural',
  sv: 'sv-SE-MattiasNeural',
  da: 'da-DK-JeppeNeural',
  nb: 'nb-NO-FinnNeural',
  fi: 'fi-FI-HarriNeural',
  cs: 'cs-CZ-AntoninNeural',
  hu: 'hu-HU-TamasNeural',
  ro: 'ro-RO-EmilNeural',
  bg: 'bg-BG-BorislavNeural',
  el: 'el-GR-NestorasNeural',
  sr: 'sr-RS-NicholasNeural',
  hr: 'hr-HR-SreckoNeural',
  uk: 'uk-UA-OstapNeural',
  ar: 'ar-SA-HamedNeural',
  he: 'he-IL-AvriNeural',
  hi: 'hi-IN-MadhurNeural',
  bn: 'bn-IN-BashkarNeural',
  ta: 'ta-IN-ValluvarNeural',
  th: 'th-TH-NiwatNeural',
  vi: 'vi-VN-NamMinhNeural',
  id: 'id-ID-ArdiNeural',
  ms: 'ms-MY-OsmanNeural',
  tl: 'fil-PH-AngeloNeural',
  zh: 'zh-CN-YunxiNeural',
  ja: 'ja-JP-KeitaNeural',
  ko: 'ko-KR-InJoonNeural',
  az: 'az-AZ-BabekNeural',
  ka: 'ka-GE-GiorgiNeural',
  // hy: no edge-tts voice exists for hy-AM at all (see comment above) — falls back to VOICE_MAP.
  sw: 'sw-KE-RafikiNeural',
  // ha: no edge-tts voice exists for ha-NG at all (see comment above) — falls back to VOICE_MAP.
  // yo: no edge-tts voice exists for yo-NG at all (see comment above) — falls back to VOICE_MAP.
  // ig: no edge-tts voice exists for ig-NG at all (see comment above) — falls back to VOICE_MAP.
  zu: 'zu-ZA-ThembaNeural',
  am: 'am-ET-AmehaNeural',
};

@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);

  async synthesize(text: string, lang: string = 'ru', gender: string = 'FEMALE'): Promise<Buffer> {
    const voice = (gender === 'MALE' ? MALE_VOICE_MAP[lang] : undefined)
      || VOICE_MAP[lang] || VOICE_MAP.en || 'en-US-AriaNeural';
    const tmpFile = join(tmpdir(), `rovx_tts_${Date.now()}_${Math.random().toString(36).slice(2)}.mp3`);

    try {
      const textSafe = text.replace(/["\n\r\t]/g, ' ').substring(0, 5000);
      const child = spawn('edge-tts', ['--voice', voice, '--text', textSafe, '--write-media', tmpFile], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const killTimeout = setTimeout(() => {
        child.kill('SIGTERM');
      }, 30000);

      let stderr = '';
      child.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

      await new Promise<void>((resolve, reject) => {
        child.on('close', (code) => {
          clearTimeout(killTimeout);
          if (code === 0) resolve();
          else reject(new Error(`edge-tts exited with code ${code}: ${stderr || 'unknown error'}`));
        });
        child.on('error', (err) => {
          clearTimeout(killTimeout);
          reject(err);
        });
      });

      if (stderr) {
        this.logger.warn(`edge-tts stderr: ${stderr}`);
      }

      const buffer = await readFile(tmpFile);
      return buffer;
    } catch (error) {
      this.logger.error(`Edge TTS failed for lang=${lang} voice=${voice}: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    } finally {
      // Blocking synchronous reads/deletes here stall the entire Node event
      // loop for every other in-flight request (route calc, location
      // updates, etc) while this one TTS call's temp file is read/removed —
      // this handler can run concurrently for multiple users requesting
      // voice turn-by-turn instructions at once.
      try { await unlink(tmpFile); } catch {}
    }
  }

  getSupportedLanguages(): string[] {
    return Object.keys(VOICE_MAP);
  }

  getVoiceForLang(lang: string): string {
    return VOICE_MAP[lang] || VOICE_MAP.en || 'en-US-AriaNeural';
  }
}
