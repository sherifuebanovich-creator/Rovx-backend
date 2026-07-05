import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

interface RouteContext {
  originName: string;
  destName: string;
  distance: number;
  duration: number;
  weather?: string;
  timeOfDay: string;
  vehicleType: string;
  hazards: string[];
  reports: string[];
  userPreferences: {
    avoidTolls: boolean;
    preferScenic: boolean;
    lang: string;
  };
}

interface VoiceCommand {
  command: string;
  lang: string;
  context?: Record<string, any>;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly openaiBase: string;

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private config: ConfigService,
  ) {
    this.openaiBase = this.config.get('AI_API_BASE_URL', 'https://api.groq.com/openai/v1');
  }

  async analyzeRouteAndSuggest(userId: string, ctx: RouteContext): Promise<{
    recommendation: string;
    reasoning: string;
    warnings: string[];
    suggestions: string[];
    voiceIntro: string;
  }> {
    const cacheKey = `ai:route:${userId}:${ctx.originName}:${ctx.destName}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const userHistory = await this.getUserHistory(userId);
    const prompt = this.buildRoutePrompt(ctx, userHistory);

    try {
      const result = await this.callLLM(prompt, ctx.userPreferences.lang);
      await this.redis.set(cacheKey, JSON.stringify(result), 600);
      return result;
    } catch (error) {
      this.logger.error('AI route analysis failed', error instanceof Error ? error.message : String(error));
      return this.getFallbackSuggestion(ctx);
    }
  }

  async processVoiceCommand(userId: string, cmd: VoiceCommand): Promise<{
    intent: string;
    action: string;
    params: Record<string, any>;
    response: string;
  }> {
    const command = cmd.command.toLowerCase().trim();

    // Rule-based intent detection for speed + accuracy
    const intents = this.detectIntent(command, cmd.lang);
    if (intents) return intents;

    // Fallback to LLM for complex commands
    return this.processWithLLM(userId, cmd);
  }

  private detectIntent(command: string, lang: string): any | null {
    const patterns: Array<{
      patterns: RegExp[];
      intent: string;
      extractor: (m: RegExpMatchArray) => Record<string, any>;
      response: Record<string, string>;
    }> = [
      {
        patterns: [/домой|home|uyga/i],
        intent: 'navigate_home',
        extractor: () => ({ destination: 'home' }),
        response: { ru: 'Прокладываю маршрут домой', en: 'Navigating home', uz: 'Uyga yo\'l qurilmoqda' },
      },
      {
        patterns: [/заправк|gas.?station|benzin|АЗС/i],
        intent: 'find_nearby',
        extractor: () => ({ category: 'GAS_STATION' }),
        response: { ru: 'Ищу ближайшие заправки', en: 'Finding nearest gas stations', uz: 'Yaqin yoqilg\'i stansiyalari qidirilmoqda' },
      },
      {
        patterns: [/туалет|toilet|WC|restroom|hojatxona/i],
        intent: 'find_nearby',
        extractor: () => ({ category: 'TOILET' }),
        response: { ru: 'Ищу ближайший туалет', en: 'Finding nearest toilet', uz: 'Yaqin hojatxona qidirilmoqda' },
      },
      {
        patterns: [/парковк|parking|to\'xtash/i],
        intent: 'find_nearby',
        extractor: () => ({ category: 'PARKING' }),
        response: { ru: 'Ищу ближайшую парковку', en: 'Finding nearest parking', uz: 'Yaqin to\'xtash joyi qidirilmoqda' },
      },
      {
        patterns: [/без.?платн|avoid.?toll|yoq.?to'lov/i],
        intent: 'update_preference',
        extractor: () => ({ preference: 'avoidTolls', value: true }),
        response: { ru: 'Избегаю платных дорог', en: 'Avoiding toll roads', uz: 'To\'lovli yo\'llar chetlab o\'tiladi' },
      },
      {
        patterns: [/красив|scenic|beautiful|chiroyli/i],
        intent: 'change_route',
        extractor: () => ({ routeType: 'SCENIC' }),
        response: { ru: 'Переключаю на живописный маршрут', en: 'Switching to scenic route', uz: 'Manzarali yo\'lga o\'tilmoqda' },
      },
      {
        patterns: [/отдых|rest.?stop|dam.?olish/i],
        intent: 'find_nearby',
        extractor: () => ({ category: 'REST_AREA' }),
        response: { ru: 'Ищу места для отдыха', en: 'Finding rest stops', uz: 'Dam olish joylari qidirilmoqda' },
      },
      {
        patterns: [/кафе|cafe|coffee|qahvaxona/i],
        intent: 'find_nearby',
        extractor: () => ({ category: 'CAFE' }),
        response: { ru: 'Ищу ближайшее кафе', en: 'Finding nearest cafe', uz: 'Yaqin qahvaxona qidirilmoqda' },
      },
      {
        patterns: [/пересчита|перестрой|recalculate|qayta.?hisob/i],
        intent: 'recalculate',
        extractor: () => ({}),
        response: { ru: 'Пересчитываю маршрут', en: 'Recalculating route', uz: 'Yo\'l qayta hisoblanmoqda' },
      },
      {
        patterns: [/гостиниц|отель|hotel|mehmonxona/i],
        intent: 'find_nearby',
        extractor: () => ({ category: 'HOTEL' }),
        response: { ru: 'Ищу ближайшие отели', en: 'Finding nearby hotels', uz: 'Yaqin mehmonxonalar qidirilmoqda' },
      },
    ];

    for (const p of patterns) {
      for (const pattern of p.patterns) {
        const match = command.match(pattern);
        if (match) {
          return {
            intent: p.intent,
            action: p.intent,
            params: p.extractor(match),
            response: p.response[lang] || p.response.en,
          };
        }
      }
    }

    return null;
  }

  private async processWithLLM(userId: string, cmd: VoiceCommand) {
    const systemPrompt = `You are ROVX AI, an intelligent navigation assistant. 
Parse the user's voice command and respond with a JSON object containing:
- intent: string (navigate_home|find_nearby|change_route|recalculate|update_preference|general_info)
- action: string
- params: object with relevant parameters
- response: string (in the user's language: ${cmd.lang})

User language: ${cmd.lang}
Respond ONLY with valid JSON.`;

    try {
      const result = await this.callOpenAI(systemPrompt, cmd.command);
      return JSON.parse(result);
    } catch {
      return {
        intent: 'unknown',
        action: 'unknown',
        params: {},
        response: cmd.lang === 'ru' ? 'Не понял команду. Попробуйте ещё раз.' : 'Command not understood.',
      };
    }
  }

  async generateTurnInstruction(
    instruction: any,
    lang: string,
    context: { speedKmh: number; weather: string },
  ): Promise<string> {
    const templates: Record<string, Record<string, string>> = {
      ru: {
        turn_left: 'Поверните налево',
        turn_right: 'Поверните направо',
        continue: 'Продолжайте прямо',
        arrive: 'Вы прибыли к месту назначения',
        depart: 'Начните движение',
        roundabout: 'Въезжайте в круговое движение',
        merge: 'Перестройтесь',
        ramp: 'Съезжайте с дороги',
      },
      en: {
        turn_left: 'Turn left',
        turn_right: 'Turn right',
        continue: 'Continue straight',
        arrive: 'You have arrived',
        depart: 'Start driving',
        roundabout: 'Enter the roundabout',
        merge: 'Merge',
        ramp: 'Take the ramp',
      },
      uz: {
        turn_left: 'Chapga buring',
        turn_right: 'O\'ngga buring',
        continue: 'To\'g\'ri davom eting',
        arrive: 'Manzilga yetib keldingiz',
        depart: 'Harakatni boshlang',
        roundabout: 'Aylana harakatga kiring',
        merge: 'Yo\'l o\'zgartiring',
        ramp: 'Tushish yo\'lini oling',
      },
    };

    const langTemplates = templates[lang] || templates.en;
    const baseText = langTemplates[instruction.type] || instruction.text;

    const distance = instruction.distance > 1000
      ? `${(instruction.distance / 1000).toFixed(1)} km`
      : `${Math.round(instruction.distance)} m`;

    const inText = lang === 'ru' ? 'через' : lang === 'uz' ? 'orqali' : 'in';
    return `${inText} ${distance}, ${baseText}${instruction.streetName ? ` на ${instruction.streetName}` : ''}`;
  }

  async getSmartSuggestions(userId: string, currentLat: number, currentLng: number): Promise<string[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { preferences: true },
    });

    if (!user) return [];

    const hour = new Date().getHours();
    const suggestions: string[] = [];
    const lang = user.preferredLang || 'ru';

    const messages = {
      ru: {
        fuel: 'Уровень топлива низкий — рекомендую заправиться',
        rest: 'Вы едете более 2 часов — рекомендую сделать остановку',
        morning_coffee: 'Ближайшее кафе находится в 3 км по пути',
        night_drive: 'Ночное вождение — будьте осторожны',
        weather: 'Впереди дождь — снизьте скорость',
      },
      en: {
        fuel: 'Fuel level low — consider refueling',
        rest: 'You\'ve been driving for 2+ hours — consider a rest stop',
        morning_coffee: 'Nearest cafe is 3 km ahead',
        night_drive: 'Night driving — stay alert',
        weather: 'Rain ahead — slow down',
      },
    };

    const m = messages[lang] || messages.en;

    if (hour >= 6 && hour <= 9) suggestions.push(m.morning_coffee);
    if (hour >= 22 || hour <= 5) suggestions.push(m.night_drive);

    return suggestions;
  }

  private async getUserHistory(userId: string) {
    const trips = await this.prisma.trip.findMany({
      where: { userId, status: 'completed' },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { distance: true, duration: true, routeType: true, avgSpeed: true },
    });
    return trips;
  }

  private buildRoutePrompt(ctx: RouteContext, history: any[]) {
    return `You are an AI navigation assistant. Analyze this route and provide smart recommendations.

Route: ${ctx.originName} → ${ctx.destName}
Distance: ${ctx.distance} km, Est. time: ${ctx.duration} min
Time of day: ${ctx.timeOfDay}
Vehicle: ${ctx.vehicleType}
Weather: ${ctx.weather || 'clear'}
Active hazards: ${ctx.hazards.join(', ') || 'none'}
Active reports: ${ctx.reports.join(', ') || 'none'}
User preferences: ${JSON.stringify(ctx.userPreferences)}
Recent trips: ${history.length} completed

Respond in JSON with: recommendation (string), reasoning (string), warnings (array), suggestions (array), voiceIntro (string in ${ctx.userPreferences.lang}).`;
  }

  private async callLLM(prompt: string, lang: string): Promise<any> {
    const result = await this.callOpenAI(
      'You are ROVX AI, an intelligent navigation assistant. Always respond in valid JSON.',
      prompt,
    );
    return JSON.parse(result);
  }

  private async callOpenAI(systemPrompt: string, userMessage: string): Promise<string> {
    const apiKey = this.config.get('OPENAI_API_KEY');
    if (!apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const response = await axios.post(
      `${this.openaiBase}/chat/completions`,
      {
        model: this.config.get('AI_MODEL', 'llama-3.3-70b-versatile'),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.7,
        max_tokens: 500,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      },
    );

    return response.data.choices[0].message.content;
  }

  private getFallbackSuggestion(ctx: RouteContext) {
    return {
      recommendation: ctx.userPreferences.lang === 'ru'
        ? 'Рекомендую самый быстрый маршрут'
        : 'I recommend the fastest route',
      reasoning: ctx.userPreferences.lang === 'ru'
        ? 'Основано на текущих условиях дорожного движения'
        : 'Based on current traffic conditions',
      warnings: ctx.hazards,
      suggestions: [],
      voiceIntro: ctx.userPreferences.lang === 'ru'
        ? `Маршрут построен. Расстояние ${ctx.distance} км, примерное время ${ctx.duration} минут.`
        : `Route ready. Distance ${ctx.distance} km, estimated time ${ctx.duration} minutes.`,
    };
  }
}
