'use client';
import { useRef, useCallback, useState, useEffect, type MutableRefObject } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { getLanguageConfig } from '@/config/languages';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

const RU_ABBREVIATIONS: [RegExp, string][] = [
  [/\bул\.?\s*/gi, 'улица '],
  [/\bпросп\.?\s*/gi, 'проспект '],
  [/\bпр-т\s*/gi, 'проспект '],
  [/\bпр-д\s*/gi, 'проезд '],
  [/\bб-р\s*/gi, 'бульвар '],
  [/\bш\.?\s*/gi, 'шоссе '],
  [/\bнаб\.?\s*/gi, 'набережная '],
  [/\bпер\.?\s*/gi, 'переулок '],
  [/\bпл\.?\s*/gi, 'площадь '],
  [/\bтуп\.?\s*/gi, 'тупик '],
  [/\bстр\.?\s*/gi, 'строение '],
  [/\bоф\.?\s*/gi, 'офис '],
  [/\bкв\.?\s*/gi, 'квартира '],
  [/\bмкр\.?\s*/gi, 'микрорайон '],
  [/\bмкр-н\s*/gi, 'микрорайон '],
  [/\bр-н\s*/gi, 'район '],
  [/\bпос\.?\s*/gi, 'посёлок '],
  [/\bс\.?\s*/gi, 'село '],
  [/\bдер\.?\s*/gi, 'деревня '],
  [/\bг\.\s*/g, 'город '],
  [/\bд\.?\s*/gi, 'дом '],
];

function normalizeRussianText(text: string): string {
  let result = text;
  for (const [pattern, replacement] of RU_ABBREVIATIONS) {
    result = result.replace(pattern, replacement);
  }
  return result.replace(/\s+/g, ' ').trim();
}

type DistUnits = { km_1: string; km_2: string; m: string };
const DIST_UNITS: Record<string, DistUnits> = {
  ru: { km_1: 'километр', km_2: 'километра', m: 'метров' },
  en: { km_1: 'kilometre', km_2: 'kilometres', m: 'metres' },
  uz: { km_1: 'kilometr', km_2: 'kilometr', m: 'metr' },
  kk: { km_1: 'километр', km_2: 'километр', m: 'метр' },
  tr: { km_1: 'kilometre', km_2: 'kilometre', m: 'metre' },
  de: { km_1: 'Kilometer', km_2: 'Kilometer', m: 'Meter' },
  fr: { km_1: 'kilomètre', km_2: 'kilomètres', m: 'mètres' },
  es: { km_1: 'kilómetro', km_2: 'kilómetros', m: 'metros' },
  it: { km_1: 'chilometro', km_2: 'chilometri', m: 'metri' },
  pt: { km_1: 'quilômetro', km_2: 'quilômetros', m: 'metros' },
  pl: { km_1: 'kilometr', km_2: 'kilometry', m: 'metrów' },
  nl: { km_1: 'kilometer', km_2: 'kilometer', m: 'meter' },
  sv: { km_1: 'kilometer', km_2: 'kilometer', m: 'meter' },
  da: { km_1: 'kilometer', km_2: 'kilometer', m: 'meter' },
  nb: { km_1: 'kilometer', km_2: 'kilometer', m: 'meter' },
  fi: { km_1: 'kilometri', km_2: 'kilometriä', m: 'metriä' },
  cs: { km_1: 'kilometr', km_2: 'kilometry', m: 'metrů' },
  hu: { km_1: 'kilométer', km_2: 'kilométer', m: 'méter' },
  ro: { km_1: 'kilometru', km_2: 'kilometri', m: 'metri' },
  bg: { km_1: 'километър', km_2: 'километра', m: 'метра' },
  el: { km_1: 'χιλιόμετρο', km_2: 'χιλιόμετρα', m: 'μέτρα' },
  sr: { km_1: 'километар', km_2: 'километра', m: 'метара' },
  hr: { km_1: 'kilometar', km_2: 'kilometra', m: 'metara' },
  uk: { km_1: 'кілометр', km_2: 'кілометри', m: 'метрів' },
  ar: { km_1: 'كيلومتر', km_2: 'كيلومتر', m: 'متر' },
  he: { km_1: 'קילומטר', km_2: 'קילומטרים', m: 'מטרים' },
  hi: { km_1: 'किलोमीटर', km_2: 'किलोमीटर', m: 'मीटर' },
  bn: { km_1: 'কিলোমিটার', km_2: 'কিলোমিটার', m: 'মিটার' },
  ta: { km_1: 'கிலோமீட்டர்', km_2: 'கிலோமீட்டர்', m: 'மீட்டர்' },
  th: { km_1: 'กิโลเมตร', km_2: 'กิโลเมตร', m: 'เมตร' },
  vi: { km_1: 'kilômét', km_2: 'kilômét', m: 'mét' },
  id: { km_1: 'kilometer', km_2: 'kilometer', m: 'meter' },
  ms: { km_1: 'kilometer', km_2: 'kilometer', m: 'meter' },
  tl: { km_1: 'kilometro', km_2: 'kilometro', m: 'metro' },
  zh: { km_1: '公里', km_2: '公里', m: '米' },
  ja: { km_1: 'キロメートル', km_2: 'キロメートル', m: 'メートル' },
  ko: { km_1: '킬로미터', km_2: '킬로미터', m: '미터' },
  az: { km_1: 'kilometr', km_2: 'kilometr', m: 'metr' },
  ka: { km_1: 'კილომეტრი', km_2: 'კილომეტრი', m: 'მეტრი' },
  hy: { km_1: 'կիլոմետր', km_2: 'կիլոմետր', m: 'մետր' },
  sw: { km_1: 'kilomita', km_2: 'kilomita', m: 'mita' },
  ha: { km_1: 'kilomita', km_2: 'kilomita', m: 'mita' },
  yo: { km_1: 'kilomita', km_2: 'kilomita', m: 'mita' },
  ig: { km_1: 'kilomita', km_2: 'kilomita', m: 'mita' },
  zu: { km_1: 'ikhilomitha', km_2: 'ikhilomitha', m: 'amametha' },
  am: { km_1: 'ኪሎሜትር', km_2: 'ኪሎሜትር', m: 'ሜትር' },
};

function formatDistanceLocalized(meters: number, lang: string): string {
  const u = DIST_UNITS[lang] || DIST_UNITS.en;
  const km = meters / 1000;
  if (meters >= 1000) {
    if (km <= 1) return `${km.toFixed(km === 1 ? 0 : 1)} ${u.km_1}`;
    if (km < 2) return `${km.toFixed(1)} ${u.km_2}`;
    return `${Math.round(km)} ${u.km_2}`;
  }
  if (meters >= 100) return `${Math.round(meters / 10) * 10} ${u.m}`;
  if (meters >= 50) return `50 ${u.m}`;
  return `${Math.round(meters)} ${u.m}`;
}

const DIR: Record<string, { left: string; right: string }> = {
  ru: { left: 'левее', right: 'правее' },
  en: { left: 'left', right: 'right' },
  uz: { left: 'chapda', right: 'o\'ngda' },
  kk: { left: 'солда', right: 'оңда' },
  tr: { left: 'solda', right: 'sağda' },
  de: { left: 'links', right: 'rechts' },
  fr: { left: 'à gauche', right: 'à droite' },
  es: { left: 'izquierda', right: 'derecha' },
  it: { left: 'sinistra', right: 'destra' },
  pt: { left: 'esquerda', right: 'direita' },
  pl: { left: 'lewo', right: 'prawo' },
  nl: { left: 'links', right: 'rechts' },
  sv: { left: 'vänster', right: 'höger' },
  da: { left: 'venstre', right: 'højre' },
  nb: { left: 'venstre', right: 'høyre' },
  fi: { left: 'vasen', right: 'oikea' },
  cs: { left: 'vlevo', right: 'vpravo' },
  hu: { left: 'balra', right: 'jobbra' },
  ro: { left: 'stânga', right: 'dreapta' },
  bg: { left: 'ляво', right: 'дясно' },
  el: { left: 'αριστερά', right: 'δεξιά' },
  sr: { left: 'лево', right: 'десно' },
  hr: { left: 'lijevo', right: 'desno' },
  uk: { left: 'ліворуч', right: 'праворуч' },
  ar: { left: 'يسار', right: 'يمين' },
  he: { left: 'שמאלה', right: 'ימינה' },
  hi: { left: 'बाएँ', right: 'दाएँ' },
  bn: { left: 'बামে', right: 'ডানে' },
  ta: { left: 'இடது', right: 'வலது' },
  th: { left: 'ซ้าย', right: 'ขวา' },
  vi: { left: 'trái', right: 'phải' },
  id: { left: 'kiri', right: 'kanan' },
  ms: { left: 'kiri', right: 'kanan' },
  tl: { left: 'kaliwa', right: 'kanan' },
  zh: { left: '左侧', right: '右侧' },
  ja: { left: '左側', right: '右側' },
  ko: { left: '왼쪽', right: '오른쪽' },
  az: { left: 'sol', right: 'sağ' },
  ka: { left: 'მარცხნივ', right: 'მარჯვნივ' },
  hy: { left: 'ձախ', right: 'աջ' },
  sw: { left: 'kushoto', right: 'kulia' },
  ha: { left: 'hagu', right: 'dama' },
  yo: { left: 'osi', right: 'ọtun' },
  ig: { left: 'aka', right: 'nri' },
  zu: { left: 'kwesokunxele', right: 'kwesokudla' },
  am: { left: 'ግራ', right: 'ቀኝ' },
};

type NavVal = string | [string, string];
const NAV: Record<string, Record<string, NavVal>> = {
  depart: {
    ru: ['Двигайтесь по {s}', 'Двигайтесь в направлении движения'],
    en: ['Drive along {s}', 'Drive in the direction of travel'],
    uz: ['{s} bo\'ylab harakatlaning', 'Harakat yo\'nalishi bo\'ylab yuring'],
    kk: ['{s} бойымен жүріңіз', 'Қозғалыс бағытымен жүріңіз'],
    tr: ['{s} üzerinde ilerleyin', 'Seyir yönünde ilerleyin'],
    de: ['Fahren Sie auf {s}', 'Fahren Sie in Fahrtrichtung'],
    fr: ['Continuez sur {s}', 'Continuez dans le sens de la circulation'],
    es: ['Conduzca por {s}', 'Conduzca en el sentido del tráfico'],
    it: ['Percorri {s}', 'Prosegui nella direzione di marcia'],
    pt: ['Siga por {s}', 'Siga no sentido do trânsito'],
    pl: ['Jedź {s}', 'Jedź w kierunku jazdy'],
    nl: ['Rijd over {s}', 'Rijd in de rijrichting'],
    sv: ['Kör på {s}', 'Kör i färdriktningen'],
    da: ['Kør ad {s}', 'Kør i kørselsretningen'],
    nb: ['Kjør på {s}', 'Kjør i kjøreretningen'],
    fi: ['Aja {s} pitkin', 'Aja kulkusuuntaan'],
    cs: ['Jeďte po {s}', 'Jeďte ve směru jízdy'],
    hu: ['Hajtson a {s}-n', 'Hajtson a menetirányban'],
    ro: ['Conduceți pe {s}', 'Conduceți în direcția de deplasare'],
    bg: ['Карайте по {s}', 'Карайте в посока на движение'],
    el: ['Οδηγήστε στην {s}', 'Οδηγήστε στην κατεύθυνση κυκλοφορίας'],
    sr: ['Возите се {s}', 'Возите се у смеру саобраћаја'],
    hr: ['Vozi se {s}', 'Vozi se u smjeru prometa'],
    uk: ['Їдьте по {s}', 'Їдьте в напрямку руху'],
    ar: ['اسلك {s}', 'اسلك في اتجاه السير'],
    he: ['סע ב{s}', 'סע בכיוון התנועה'],
    hi: ['{s} पर चलें', 'यात्रा की दिशा में चलें'],
    bn: ['{s} বরাবর যান', 'ভ্রমণের দিকে যান'],
    ta: ['{s} வழியில் செல்லவும்', 'பயண திசையில் செல்லவும்'],
    th: ['ขับไปตาม{s}', 'ขับตามทิศทางการจราจร'],
    vi: ['Đi dọc theo {s}', 'Đi theo hướng di chuyển'],
    id: ['Berkendara di {s}', 'Berkendara searah perjalanan'],
    ms: ['Pandu di {s}', 'Pandu mengikut arah perjalanan'],
    tl: ['Magmaneho sa {s}', 'Magmaneho sa direksyon ng paglalakbay'],
    zh: ['沿{s}行驶', '沿行驶方向行驶'],
    ja: ['{s}を進む', '進行方向に進む'],
    ko: ['{s} 따라 주행', '주행 방향으로 주행'],
    az: ['{s} ilə hərəkət edin', 'Hərəkət istiqamətində gedin'],
    ka: ['{s}-ით იარეთ', 'მიმართულებით იარეთ'],
    hy: ['Վարեք {s}-ով', 'Վարեք երթևեկության ուղղությամբ'],
    sw: ['Endesha kwenye {s}', 'Endesha kuelekea mwelekeo wa safari'],
    ha: ['Tuki akan {s}', 'Tuki daidai daidai'],
    yo: ['Wakọ lori {s}', 'Wakọ ni itọsọna irin ajo'],
    ig: ['Gba n\'okporo {s}', 'Gba n\'akụkụ njem'],
    zu: ['Shayela {s}', 'Shayela ubheke lapho uya khona'],
    am: ['{s} ላይ ይንዱ', 'በጉዞ አቅጣጫ ይንዱ'],
  },
  continue: {
    ru: ['Продолжайте движение прямо ещё {d}', 'Продолжайте движение прямо'],
    en: ['Continue straight for {d}', 'Continue straight ahead'],
    uz: ['{d} to\'g\'riga davom eting', 'To\'g\'riga davom eting'],
    kk: ['Тағы {d} түзу жүріңіз', 'Түзу жүріңіз'],
    tr: ['{d} daha düz gidin', 'Düz devam edin'],
    de: ['Fahren Sie {d} geradeaus weiter', 'Fahren Sie geradeaus weiter'],
    fr: ['Continuez tout droit sur {d}', 'Continuez tout droit'],
    es: ['Continúe recto {d}', 'Continúe recto'],
    it: ['Continua dritto per {d}', 'Continua dritto'],
    pt: ['Continue em frente por {d}', 'Continue em frente'],
    pl: ['Jedź prosto przez {d}', 'Jedź prosto'],
    nl: ['Ga {d} rechtdoor', 'Ga rechtdoor'],
    sv: ['Fortsätt rakt fram {d}', 'Fortsätt rakt fram'],
    da: ['Fortsæt ligeud {d}', 'Fortsæt ligeud'],
    nb: ['Fortsett rett fram {d}', 'Fortsett rett fram'],
    fi: ['Jatka suoraan {d}', 'Jatka suoraan'],
    cs: ['Pokračujte rovně {d}', 'Pokračujte rovně'],
    hu: ['Folytassa egyenesen {d}', 'Folytassa egyenesen'],
    ro: ['Continuați drept înainte {d}', 'Continuați drept înainte'],
    bg: ['Продължете право {d}', 'Продължете право'],
    el: ['Συνεχίστε ευθεία για {d}', 'Συνεχίστε ευθεία'],
    sr: ['Наставите право {d}', 'Наставите право'],
    hr: ['Nastavite ravno {d}', 'Nastavite ravno'],
    uk: ['Продовжуйте рух прямо {d}', 'Продовжуйте рух прямо'],
    ar: ['استمر مباشرة لمسافة {d}', 'استمر مباشرة'],
    he: ['המשך ישר {d}', 'המשך ישר'],
    hi: ['सीधे {d} चलते रहें', 'सीधे चलते रहें'],
    bn: ['সোজা {d} চালিয়ে যান', 'সোজা চালিয়ে যান'],
    ta: ['நேராக {d} தொடரவும்', 'நேராக தொடரவும்'],
    th: ['ตรงไปอีก {d}', 'ตรงไป'],
    vi: ['Tiếp tục đi thẳng {d}', 'Tiếp tục đi thẳng'],
    id: ['Lurus terus {d}', 'Lurus terus'],
    ms: ['Terus lurus {d}', 'Terus lurus'],
    tl: ['Tuloy-tuloy diretso {d}', 'Diretso lang'],
    zh: ['继续直行{d}', '继续直行'],
    ja: ['{d}直進', '直進'],
    ko: ['{d} 직진', '직진'],
    az: ['{d} düz gedin', 'Düz gedin'],
    ka: ['{d} გააგრძელეთ პირდაპირ', 'გააგრძელეთ პირდაპირ'],
    hy: ['Շարունակեք ուղիղ {d}', 'Շարունակեք ուղիղ'],
    sw: ['Endelea moja kwa moja {d}', 'Endelea moja kwa moja'],
    ha: ['Ci gaba kai tsaye {d}', 'Ci gaba kai tsaye'],
    yo: ['Tesiwaju ni gígùn {d}', 'Tesiwaju ni gígùn'],
    ig: ['Gaa n\'ihu ogologo {d}', 'Gaa n\'ihu'],
    zu: ['Qhubeka uqonde {d}', 'Qhubeka uqonde'],
    am: ['{d} ቀጥ ብለው ይቀጥሉ', 'ቀጥ ብለው ይቀጥሉ'],
  },
  turn_left: {
    ru: ['Через {d} поверните налево на {s}', 'Через {d} поверните налево'],
    en: ['In {d}, turn left onto {s}', 'In {d}, turn left'],
    uz: ['{d} dan keyin chapga {s} ga buriling', '{d} dan keyin chapga buriling'],
    kk: ['{d} кейін {s} солға бұрылыңыз', '{d} кейін солға бұрылыңыз'],
    tr: ['{d} sonra {s} sola dönün', '{d} sonra sola dönün'],
    de: ['In {d} links abbiegen auf {s}', 'In {d} links abbiegen'],
    fr: ['Dans {d}, tournez à gauche sur {s}', 'Dans {d}, tournez à gauche'],
    es: ['En {d}, gire a la izquierda en {s}', 'En {d}, gire a la izquierda'],
    it: ['Tra {d}, svolta a sinistra su {s}', 'Tra {d}, svolta a sinistra'],
    pt: ['Em {d}, vire à esquerda na {s}', 'Em {d}, vire à esquerda'],
    pl: ['Za {d} skręć w lewo w {s}', 'Za {d} skręć w lewo'],
    nl: ['Over {d} sla links af op {s}', 'Over {d} sla links af'],
    sv: ['Om {d} sväng vänster in på {s}', 'Om {d} sväng vänster'],
    da: ['Om {d} drej til venstre ad {s}', 'Om {d} drej til venstre'],
    nb: ['Om {d} sving til venstre inn på {s}', 'Om {d} sving til venstre'],
    fi: ['{d} kuluttua käänny vasemmalle {s}', '{d} kuluttua käänny vasemmalle'],
    cs: ['Za {d} odbočte vlevo na {s}', 'Za {d} odbočte vlevo'],
    hu: ['{d} múlva forduljon balra a {s}-ra', '{d} múlva forduljon balra'],
    ro: ['Peste {d} virați la stânga pe {s}', 'Peste {d} virați la stânga'],
    bg: ['След {d} завийте наляво по {s}', 'След {d} завийте наляво'],
    el: ['Σε {d} στρίψτε αριστερά στην {s}', 'Σε {d} στρίψτε αριστερά'],
    sr: ['Након {d} скрените лево на {s}', 'Након {d} скрените лево'],
    hr: ['Nakon {d} skrenite lijevo na {s}', 'Nakon {d} skrenite lijevo'],
    uk: ['Через {d} поверніть ліворуч на {s}', 'Через {d} поверніть ліворуч'],
    ar: ['بعد {d} انعطف يساراً إلى {s}', 'بعد {d} انعطف يساراً'],
    he: ['בעוד {d} פנה שמאלה ל{s}', 'בעוד {d} פנה שמאלה'],
    hi: ['{d} में बाएँ मुड़ें {s} पर', '{d} में बाएँ मुड़ें'],
    bn: ['{d} পরে বামে মোড় নিন {s} এ', '{d} পরে বামে মোড় নিন'],
    ta: ['{d} இல் இடதுபுறம் திரும்பவும் {s}', '{d} இல் இடதுபுறம் திரும்பவும்'],
    th: ['ใน {d} เลี้ยวซ้ายเข้าสู่ {s}', 'ใน {d} เลี้ยวซ้าย'],
    vi: ['Trong {d}, rẽ trái vào {s}', 'Trong {d}, rẽ trái'],
    id: ['Dalam {d}, belok kiri ke {s}', 'Dalam {d}, belok kiri'],
    ms: ['Dalam {d}, belok kiri ke {s}', 'Dalam {d}, belok kiri'],
    tl: ['Sa {d}, lumiko pakaliwa papunta sa {s}', 'Sa {d}, lumiko pakaliwa'],
    zh: ['{d}后左转进入{s}', '{d}后左转'],
    ja: ['{d}後、左折して{s}へ', '{d}後、左折'],
    ko: ['{d} 후 좌회전하여 {s}로', '{d} 후 좌회전'],
    az: ['{d} sonra sola dönün {s}', '{d} sonra sola dönün'],
    ka: ['{d} შემდეგ მარცხნივ {s}-ზე', '{d} შემდეგ მარცხნივ'],
    hy: ['{d} անց թեքվեք ձախ {s}', '{d} անց թեքվեք ձախ'],
    sw: ['Katika {d}, pindukia kushoto kwenye {s}', 'Katika {d}, pindukia kushoto'],
    ha: ['Bayan {d} juwa hagu zuwa {s}', 'Bayan {d} juwa hagu'],
    yo: ['Ni {d} kọ si apa osi lori {s}', 'Ni {d} kọ si apa osi'],
    ig: ['Na {d} tụgharịa aka ekpe na {s}', 'Na {d} tụgharịa aka ekpe'],
    zu: ['Ku {d} phenduka kwesokunxele ungene ku {s}', 'Ku {d} phenduka kwesokunxele'],
    am: ['በ{d} ውስጥ ወደ ግራ ይታጠፉ ወደ {s}', 'በ{d} ውስጥ ወደ ግራ ይታጠፉ'],
  },
  turn_right: {
    ru: ['Через {d} поверните направо на {s}', 'Через {d} поверните направо'],
    en: ['In {d}, turn right onto {s}', 'In {d}, turn right'],
    uz: ['{d} dan keyin o\'ngga {s} ga buriling', '{d} dan keyin o\'ngga buriling'],
    kk: ['{d} кейін {s} оңға бұрылыңыз', '{d} кейін оңға бұрылыңыз'],
    tr: ['{d} sonra {s} sağa dönün', '{d} sonra sağa dönün'],
    de: ['In {d} rechts abbiegen auf {s}', 'In {d} rechts abbiegen'],
    fr: ['Dans {d}, tournez à droite sur {s}', 'Dans {d}, tournez à droite'],
    es: ['En {d}, gire a la derecha en {s}', 'En {d}, gire a la derecha'],
    it: ['Tra {d}, svolta a destra su {s}', 'Tra {d}, svolta a destra'],
    pt: ['Em {d}, vire à direita na {s}', 'Em {d}, vire à direita'],
    pl: ['Za {d} skręć w prawo w {s}', 'Za {d} skręć w prawo'],
    nl: ['Over {d} sla rechts af op {s}', 'Over {d} sla rechts af'],
    sv: ['Om {d} sväng höger in på {s}', 'Om {d} sväng höger'],
    da: ['Om {d} drej til højre ad {s}', 'Om {d} drej til højre'],
    nb: ['Om {d} sving til høyre inn på {s}', 'Om {d} sving til høyre'],
    fi: ['{d} kuluttua käänny oikealle {s}', '{d} kuluttua käänny oikealle'],
    cs: ['Za {d} odbočte vpravo na {s}', 'Za {d} odbočte vpravo'],
    hu: ['{d} múlva forduljon jobbra a {s}-ra', '{d} múlva forduljon jobbra'],
    ro: ['Peste {d} virați la dreapta pe {s}', 'Peste {d} virați la dreapta'],
    bg: ['След {d} завийте надясно по {s}', 'След {d} завийте надясно'],
    el: ['Σε {d} στρίψτε δεξιά στην {s}', 'Σε {d} στρίψτε δεξιά'],
    sr: ['Након {d} скрените десно на {s}', 'Након {d} скрените десно'],
    hr: ['Nakon {d} skrenite desno na {s}', 'Nakon {d} skrenite desno'],
    uk: ['Через {d} поверніть праворуч на {s}', 'Через {d} поверніть праворуч'],
    ar: ['بعد {d} انعطف يميناً إلى {s}', 'بعد {d} انعطف يميناً'],
    he: ['בעוד {d} פנה ימינה ל{s}', 'בעוד {d} פנה ימינה'],
    hi: ['{d} में दाएँ मुड़ें {s} पर', '{d} में दाएँ मुड़ें'],
    bn: ['{d} পরে ডানে মোড় নিন {s} এ', '{d} পরে ডানে মোড় নিন'],
    ta: ['{d} இல் வலதுபுறம் திரும்பவும் {s}', '{d} இல் வலதுபுறம் திரும்பவும்'],
    th: ['ใน {d} เลี้ยวขวาเข้าสู่ {s}', 'ใน {d} เลี้ยวขวา'],
    vi: ['Trong {d}, rẽ phải vào {s}', 'Trong {d}, rẽ phải'],
    id: ['Dalam {d}, belok kanan ke {s}', 'Dalam {d}, belok kanan'],
    ms: ['Dalam {d}, belok kanan ke {s}', 'Dalam {d}, belok kanan'],
    tl: ['Sa {d}, lumiko pakanan papunta sa {s}', 'Sa {d}, lumiko pakanan'],
    zh: ['{d}后右转进入{s}', '{d}后右转'],
    ja: ['{d}後、右折して{s}へ', '{d}後、右折'],
    ko: ['{d} 후 우회전하여 {s}로', '{d} 후 우회전'],
    az: ['{d} sonra sağa dönün {s}', '{d} sonra sağa dönün'],
    ka: ['{d} შემდეგ მარჯვნივ {s}-ზე', '{d} შემდეგ მარჯვნივ'],
    hy: ['{d} անց թեքվեք աջ {s}', '{d} անց թեքվեք աջ'],
    sw: ['Katika {d}, pindukia kulia kwenye {s}', 'Katika {d}, pindukia kulia'],
    ha: ['Bayan {d} juwa dama zuwa {s}', 'Bayan {d} juwa dama'],
    yo: ['Ni {d} kọ si apa ọtun lori {s}', 'Ni {d} kọ si apa ọtun'],
    ig: ['Na {d} tụgharịa aka nri na {s}', 'Na {d} tụgharịa aka nri'],
    zu: ['Ku {d} phenduka kwesokudla ungene ku {s}', 'Ku {d} phenduka kwesokudla'],
    am: ['በ{d} ውስጥ ወደ ቀኝ ይታጠፉ ወደ {s}', 'በ{d} ውስጥ ወደ ቀኝ ይታጠፉ'],
  },
  roundabout: {
    ru: ['Через {d} въедьте на круговое движение на {s}', 'Через {d} въедьте на круговое движение'],
    en: ['In {d}, enter the roundabout and take {s}', 'In {d}, enter the roundabout'],
    uz: ['{d} dan keyin aylanma yo\'lga kiring, {s} bo\'ylab yuring', '{d} dan keyin aylanma yo\'lga kiring'],
    kk: ['{d} кейін айналма жолға кіріңіз, {s} бойымен жүріңіз', '{d} кейін айналма жолға кіріңіз'],
    tr: ['{d} sonra dönel kavşağa girin, {s} yönünde ilerleyin', '{d} sonra dönel kavşağa girin'],
    de: ['In {d} in den Kreisverkehr einfahren, {s} nehmen', 'In {d} in den Kreisverkehr einfahren'],
    fr: ['Dans {d}, prenez le rond-point et {s}', 'Dans {d}, prenez le rond-point'],
    es: ['En {d}, entre en la rotonda y tome {s}', 'En {d}, entre en la rotonda'],
    it: ['Tra {d}, entra nella rotonda e prendi {s}', 'Tra {d}, entra nella rotonda'],
    pt: ['Em {d}, entre na rotatória e pegue {s}', 'Em {d}, entre na rotatória'],
    pl: ['Za {d} wjedź na rondo i {s}', 'Za {d} wjedź na rondo'],
    nl: ['Over {d} neem de rotonde en volg {s}', 'Over {d} neem de rotonde'],
    sv: ['Om {d} kör in i rondellen och ta {s}', 'Om {d} kör in i rondellen'],
    da: ['Om {d} kør ind i rundkørslen og tag {s}', 'Om {d} kør ind i rundkørslen'],
    nb: ['Om {d} kjør inn i rundkjøringen og ta {s}', 'Om {d} kjør inn i rundkjøringen'],
    fi: ['{d} kuluttua aja kiertoliittymään ja ota {s}', '{d} kuluttua aja kiertoliittymään'],
    cs: ['Za {d} vjeďte na kruhový objezd a {s}', 'Za {d} vjeďte na kruhový objezd'],
    hu: ['{d} múlva hajtson be a körforgalomba, {s} felé', '{d} múlva hajtson be a körforgalomba'],
    ro: ['Peste {d} intrați în sensul giratoriu pe {s}', 'Peste {d} intrați în sensul giratoriu'],
    bg: ['След {d} влезте в кръговото движение по {s}', 'След {d} влезте в кръговото движение'],
    el: ['Σε {d} μπείτε στον κυκλικό κόμβο και ακολουθήστε {s}', 'Σε {d} μπείτε στον κυκλικό κόμβο'],
    sr: ['Након {d} уђите у кружни ток ка {s}', 'Након {d} уђите у кружни ток'],
    hr: ['Nakon {d} uđite u kružni tok prema {s}', 'Nakon {d} uđite u kružni tok'],
    uk: ['Через {d} в\'їжджайте на коло, рухайтесь по {s}', 'Через {d} в\'їжджайте на коло'],
    ar: ['بعد {d} ادخل الدوار واتبع {s}', 'بعد {d} ادخل الدوار'],
    he: ['בעוד {d} היכנס לכיכור וסע ל{s}', 'בעוד {d} היכנס לכיכור'],
    hi: ['{d} में गोलचक्कर में प्रवेश करें और {s} लें', '{d} में गोलचक्कर में प्रवेश करें'],
    bn: ['{d} পরে গোলচত্বরে প্রবেশ করুন এবং {s} নিন', '{d} পরে গোলচত্বরে প্রবেশ করুন'],
    ta: ['{d} இல் வட்டவடிவ சந்திப்பில் நுழைந்து {s} எடுக்கவும்', '{d} இல் வட்டவடிவ சந்திப்பில் நுழையவும்'],
    th: ['ใน {d} เข้าสู่วงเวียนและใช้ {s}', 'ใน {d} เข้าสู่วงเวียน'],
    vi: ['Trong {d}, vào bùng binh và đi theo {s}', 'Trong {d}, vào bùng binh'],
    id: ['Dalam {d}, masuk bundaran dan ambil {s}', 'Dalam {d}, masuk bundaran'],
    ms: ['Dalam {d}, masuk bulatan dan ambil {s}', 'Dalam {d}, masuk bulatan'],
    tl: ['Sa {d}, pumasok sa rotunda at dumaan sa {s}', 'Sa {d}, pumasok sa rotunda'],
    zh: ['{d}后进入环岛，走{s}', '{d}后进入环岛'],
    ja: ['{d}後、ロータリーに入り{s}へ', '{d}後、ロータリーに入る'],
    ko: ['{d} 후 로터리 진입, {s}로', '{d} 후 로터리 진입'],
    az: ['{d} sonra dairəvi kavşağa girin, {s} ilə', '{d} sonra dairəvi kavşağa girin'],
    ka: ['{d} შემდეგ შედით წრიულ გზაჯვარედინზე, {s}-ით', '{d} შემდეგ შედით წრიულ გზაჯვარედინზე'],
    hy: ['{d} անց մտեք շրջանաձև խաչմերուկ, {s}-ով', '{d} անց մտեք շրջանաձև խաչմերուկ'],
    sw: ['Katika {d}, ingia kwenye mzunguko na ufuate {s}', 'Katika {d}, ingia kwenye mzunguko'],
    ha: ['Bayan {d} shiga zagaye ka bi {s}', 'Bayan {d} shiga zagaye'],
    yo: ['Ni {d} wọ ọna iyipo ki o gba {s}', 'Ni {d} wọ ọna iyipo'],
    ig: ['Na {d} banye okirikiri were {s}', 'Na {d} banye okirikiri'],
    zu: ['Ku {d} ngena embuthanweni futhi uthathe {s}', 'Ku {d} ngena embuthanweni'],
    am: ['በ{d} ውስጥ ክብ መንገድ ይግቡ እና {s} ይውሰዱ', 'በ{d} ውስጥ ክብ መንገድ ይግቡ'],
  },
  fork: {
    ru: 'Через {d} держитесь {dir}',
    en: 'In {d}, keep {dir}',
    uz: '{d} dan keyin {dir} qoling',
    kk: '{d} кейін {dir} ұстаныңыз',
    tr: '{d} sonra {dir} kalın',
    de: 'In {d} {dir} halten',
    fr: 'Dans {d} {dir}',
    es: 'En {d} manténgase {dir}',
    it: 'Tra {d} mantieni {dir}',
    pt: 'Em {d} mantenha-se {dir}',
    pl: 'Za {d} trzymaj się {dir}',
    nl: 'Over {d} houd {dir} aan',
    sv: 'Om {d} håll {dir}',
    da: 'Om {d} hold {dir}',
    nb: 'Om {d} hold {dir}',
    fi: '{d} kuluttua pidä {dir}',
    cs: 'Za {d} držte se {dir}',
    hu: '{d} múlva tartson {dir}',
    ro: 'Peste {d} mențineți {dir}',
    bg: 'След {d} дръжте {dir}',
    el: 'Σε {d} κρατηθείτε {dir}',
    sr: 'Након {d} држите се {dir}',
    hr: 'Nakon {d} držite se {dir}',
    uk: 'Через {d} тримайтесь {dir}',
    ar: 'بعد {d} ابق {dir}',
    he: 'בעוד {d} הישאר {dir}',
    hi: '{d} में {dir} रहें',
    bn: '{d} পরে {dir} থাকুন',
    ta: '{d} இல் {dir} இருங்கள்',
    th: 'ใน {d} ให้{dir}',
    vi: 'Trong {d} giữ {dir}',
    id: 'Dalam {d} tetap {dir}',
    ms: 'Dalam {d} kekal {dir}',
    tl: 'Sa {d} manatili {dir}',
    zh: '{d}后保持{dir}',
    ja: '{d}後{dir}を維持',
    ko: '{d} 후 {dir} 유지',
    az: '{d} sonra {dir} qalın',
    ka: '{d} შემდეგ {dir} იყავით',
    hy: '{d} անց {dir} մնացեք',
    sw: 'Katika {d} kaa {dir}',
    ha: 'Bayan {d} zauna {dir}',
    yo: 'Ni {d} duro {dir}',
    ig: 'Na {d} nọ {dir}',
    zu: 'Ku {d} hlala {dir}',
    am: 'በ{d} ውስጥ {dir} ይቆዩ',
  },
  merge: {
    ru: 'Через {d} перестройтесь',
    en: 'In {d}, merge',
    uz: '{d} dan keyin qo\'shiling',
    kk: '{d} кейін қосылыңыз',
    tr: '{d} sonra şerit değiştirin',
    de: 'In {d} einordnen',
    fr: 'Dans {d}, insérez-vous',
    es: 'En {d}, incorpórese',
    it: 'Tra {d} immettiti',
    pt: 'Em {d} junte-se',
    pl: 'Za {d} włącz się',
    nl: 'Over {d} voeg in',
    sv: 'Om {d} växla fil',
    da: 'Om {d} flet ind',
    nb: 'Om {d} flett inn',
    fi: '{d} kuluttua liity',
    cs: 'Za {d} zařaďte se',
    hu: '{d} múlva csatlakozzon',
    ro: 'Peste {d} alăturați-vă',
    bg: 'След {d} включете се',
    el: 'Σε {d} εισέλθετε',
    sr: 'Након {d} укључите се',
    hr: 'Nakon {d} uključite se',
    uk: 'Через {d} перешикуйтесь',
    ar: 'بعد {d} اندمج',
    he: 'בעוד {d} התמזג',
    hi: '{d} में शामिल हों',
    bn: '{d} পরে মিশে যান',
    ta: '{d} இல் இணையவும்',
    th: 'ใน {d} ผสาน',
    vi: 'Trong {d} nhập làn',
    id: 'Dalam {d} bergabung',
    ms: 'Dalam {d} bergabung',
    tl: 'Sa {d} sumanib',
    zh: '{d}后汇入',
    ja: '{d}後合流',
    ko: '{d} 후 합류',
    az: '{d} sonra birləşin',
    ka: '{d} შემდეგ შეუერთდით',
    hy: '{d} անց միացեք',
    sw: 'Katika {d} jiunge',
    ha: 'Bayan {d} shiga',
    yo: 'Ni {d} darapọ',
    ig: 'Na {d} jikọ',
    zu: 'Ku {d} hlanganisa',
    am: 'በ{d} ውስጥ ይቀላቀሉ',
  },
  ramp: {
    ru: ['Через {d} съезжайте на {s}', 'Через {d} съезжайте'],
    en: ['In {d}, take the exit onto {s}', 'In {d}, take the exit'],
    uz: ['{d} dan keyin {s} ga chiqing', '{d} dan keyin chiqing'],
    kk: ['{d} кейін {s} шығыңыз', '{d} кейін шығыңыз'],
    tr: ['{d} sonra {s} çıkışını kullanın', '{d} sonra çıkışa yönelin'],
    de: ['In {d} Ausfahrt {s} nehmen', 'In {d} die Ausfahrt nehmen'],
    fr: ['Dans {d}, prenez la sortie {s}', 'Dans {d}, prenez la sortie'],
    es: ['En {d}, tome la salida {s}', 'En {d}, tome la salida'],
    it: ['Tra {d}, prendi l\'uscita {s}', 'Tra {d}, prendi l\'uscita'],
    pt: ['Em {d}, pegue a saída {s}', 'Em {d}, pegue a saída'],
    pl: ['Za {d} zjedź na {s}', 'Za {d} zjedź'],
    nl: ['Over {d} neem de afrit {s}', 'Over {d} neem de afrit'],
    sv: ['Om {d} ta avfarten {s}', 'Om {d} ta avfarten'],
    da: ['Om {d} tag afkørslen {s}', 'Om {d} tag afkørslen'],
    nb: ['Om {d} ta avkjørselen {s}', 'Om {d} ta avkjørselen'],
    fi: ['{d} kuluttua ota poistuminen {s}', '{d} kuluttua poistu'],
    cs: ['Za {d} sjeďte na {s}', 'Za {d} sjeďte'],
    hu: ['{d} múlva hajtson ki a {s} kijáraton', '{d} múlva hajtson ki'],
    ro: ['Peste {d} ieșiți pe {s}', 'Peste {d} ieșiți'],
    bg: ['След {d} отбийте по {s}', 'След {d} отбийте'],
    el: ['Σε {d} πάρτε την έξοδο {s}', 'Σε {d} πάρτε την έξοδο'],
    sr: ['Након {d} скрените на {s}', 'Након {d} скрените'],
    hr: ['Nakon {d} skrenite na {s}', 'Nakon {d} skrenite'],
    uk: ['Через {d} з\'їжджайте на {s}', 'Через {d} з\'їжджайте'],
    ar: ['بعد {d} اسلك مخرج {s}', 'بعد {d} اسلك المخرج'],
    he: ['בעוד {d} צא ביציאה {s}', 'בעוד {d} צא ביציאה'],
    hi: ['{d} में {s} निकास लें', '{d} में निकास लें'],
    bn: ['{d} পরে {s} প্রস্থান নিন', '{d} পরে প্রস্থান নিন'],
    ta: ['{d} இல் {s} வெளியேறவும்', '{d} இல் வெளியேறவும்'],
    th: ['ใน {d} ใช้ทางออก {s}', 'ใน {d} ใช้ทางออก'],
    vi: ['Trong {d}, ra khỏi đường theo {s}', 'Trong {d}, ra khỏi đường'],
    id: ['Dalam {d}, ambil keluar {s}', 'Dalam {d}, ambil keluar'],
    ms: ['Dalam {d}, ambil keluar {s}', 'Dalam {d}, ambil keluar'],
    tl: ['Sa {d}, lumabas sa {s}', 'Sa {d}, lumabas'],
    zh: ['{d}后从{s}出口驶出', '{d}后驶出'],
    ja: ['{d}後、{s}出口へ', '{d}後、出口へ'],
    ko: ['{d} 후 {s} 출구로', '{d} 후 출구로'],
    az: ['{d} sonra {s} çıxışına çıxın', '{d} sonra çıxın'],
    ka: ['{d} შემდეგ {s} გასასვლელზე', '{d} შემდეგ გასასვლელზე'],
    hy: ['{d} անց {s} ելքով', '{d} անց ելքով'],
    sw: ['Katika {d} toka kwenye {s}', 'Katika {d} toka'],
    ha: ['Bayan {d} fita hanya {s}', 'Bayan {d} fita'],
    yo: ['Ni {d} jáde ni {s}', 'Ni {d} jáde'],
    ig: ['Na {d} pụọ na {s}', 'Na {d} pụọ'],
    zu: ['Ku {d} phuma ungene ku {s}', 'Ku {d} phuma'],
    am: ['በ{d} ውስጥ {s} መውጫ ይውሰዱ', 'በ{d} ውስጥ መውጫ ይውሰዱ'],
  },
  arrive: {
    ru: 'Вы прибыли в пункт назначения',
    en: 'You have arrived at your destination',
    uz: 'Siz manzilga yetib keldingiz',
    kk: 'Сіз межелі жерге жеттіңіз',
    tr: 'Hedefinize ulaştınız',
    de: 'Sie haben Ihr Ziel erreicht',
    fr: 'Vous êtes arrivé à destination',
    es: 'Ha llegado a su destino',
    it: 'Sei arrivato a destinazione',
    pt: 'Você chegou ao seu destino',
    pl: 'Dotarłeś do celu',
    sv: 'Du har anlänt till din destination',
    da: 'Du er ankommet til din destination',
    nb: 'Du har ankommet til din destinasjon',
    fi: 'Olet saapunut määränpäähän',
    cs: 'Dorazili jste do cíle',
    hu: 'Megérkezett a célponthoz',
    ro: 'Ați ajuns la destinație',
    bg: 'Пристигнахте на местоназначението',
    el: 'Φτάσατε στον προορισμό σας',
    sr: 'Стигли сте на одредиште',
    hr: 'Stigli ste na odredište',
    uk: 'Ви прибули до місця призначення',
    ar: 'لقد وصلت إلى وجهتك',
    he: 'הגעת ליעדך',
    hi: 'आप अपने गंतव्य पर पहुँच गए हैं',
    bn: 'আপনি আপনার গন্তব্যে পৌঁছেছেন',
    ta: 'நீங்கள் உங்கள் இலக்கை அடைந்துவிட்டீர்கள்',
    th: 'คุณมาถึงที่หมายแล้ว',
    vi: 'Bạn đã đến nơi',
    id: 'Anda telah tiba di tujuan',
    ms: 'Anda telah tiba di destinasi',
    tl: 'Dumating ka na sa iyong destinasyon',
    zh: '您已到达目的地',
    ja: '目的地に到着しました',
    ko: '목적지에 도착했습니다',
    az: 'Təyinat yerinə çatdınız',
    ka: 'თქვენ მიხვედით დანიშნულების ადგილზე',
    hy: 'Դուք հասել եք ձեր նպատակակետին',
    sw: 'Umefika mahali unakoelekea',
    ha: 'Ka isa wurin da ake nufi',
    yo: 'O ti de ibi ti o nlọ',
    ig: 'Ị rutela ebe ị na-aga',
    zu: 'Ufike lapho ubusiya khona',
    am: 'ወደ መድረሻዎ ደርሰዋል',
  },
};

const HAZARD: Record<string, Record<string, string>> = {
  SPEED_CAMERA: {
    ru: 'Внимание! Впереди камера контроля скорости',
    en: 'Speed camera ahead',
    uz: 'Diqqat! Oldinda tezlik kamerasi',
    kk: 'Назар аударыңыз! Алда жылдамдық камерасы',
    tr: 'Dikkat! İleride hız kamerası',
    de: 'Achtung! Geschwindigkeitskamera voraus',
    fr: 'Attention! Radar de vitesse devant',
    es: 'Atención! Radar de velocidad adelante',
    it: 'Attenzione! Autovelox davanti',
    pt: 'Atenção! Radar de velocidade à frente',
    pl: 'Uwaga! Fotoradar przed tobą',
    uk: 'Увага! Попереду камера контролю швидкості',
    ar: 'انتبه! كاميرا سرعة أمامك',
    hi: 'सावधान! आगे स्पीड कैमरा',
    zh: '注意！前方测速摄像头',
    ja: '注意！スピードカメラあり',
    ko: '주의! 과속 카메라 전방',
    id: 'Perhatian! Kamera kecepatan di depan',
    vi: 'Chú ý! Camera bắn tốc độ phía trước',
    th: 'ระวัง! กล้องตรวจจับความเร็วข้างหน้า',
  },
  ACCIDENT: {
    ru: 'Внимание! На дороге авария, будьте осторожны',
    en: 'Accident ahead, please be careful',
    uz: 'Diqqat! Yo\'lda avariya, ehtiyot bo\'ling',
    kk: 'Назар аударыңыз! Жолда апат, сақ болыңыз',
    tr: 'Dikkat! Yolda kaza var, lütfen dikkatli olun',
    de: 'Achtung! Unfall voraus, bitte vorsichtig',
    fr: 'Attention! Accident devant, soyez prudent',
    es: 'Atención! Accidente adelante, tenga cuidado',
    it: 'Attenzione! Incidente davanti, fate attenzione',
    pt: 'Atenção! Acidente à frente, tenha cuidado',
    pl: 'Uwaga! Wypadek przed tobą, bądź ostrożny',
    uk: 'Увага! Попереду аварія, будьте обережні',
    ar: 'انتبه! حادث أمامك، كن حذراً',
    hi: 'सावधान! आगे दुर्घटना, कृपया सावधान रहें',
    zh: '注意！前方事故，请小心',
    ja: '注意！事故発生、ご注意ください',
    ko: '주의! 전방 사고, 조심하세요',
    id: 'Perhatian! Kecelakaan di depan, hati-hati',
    vi: 'Chú ý! Tai nạn phía trước, hãy cẩn thận',
    th: 'ระวัง! อุบัติเหตุข้างหน้า โปรดระวัง',
  },
  ROAD_WORKS: {
    ru: 'Внимание! Впереди дорожные работы',
    en: 'Road works ahead',
    uz: 'Diqqat! Oldinda yo\'l ta\'mirlash ishlari',
    kk: 'Назар аударыңыз! Алда жол жұмыстары',
    tr: 'Dikkat! İleride yol çalışması',
    de: 'Achtung! Baustelle voraus',
    fr: 'Attention! Travaux routiers devant',
    es: 'Atención! Obras en la carretera adelante',
    it: 'Attenzione! Lavori stradali davanti',
    pt: 'Atenção! Obras na estrada à frente',
    pl: 'Uwaga! Roboty drogowe przed tobą',
    uk: 'Увага! Попереду дорожні роботи',
    ar: 'انتبه! أعمال طريق أمامك',
    hi: 'सावधान! आगे सड़क कार्य',
    zh: '注意！前方道路施工',
    ja: '注意！道路工事前方',
    ko: '주의! 전방 도로 공사',
    id: 'Perhatian! Pekerjaan jalan di depan',
    vi: 'Chú ý! Công trình đường phía trước',
    th: 'ระวัง! ทางก่อสร้างข้างหน้า',
  },
  TRAFFIC_JAM: {
    ru: 'Впереди пробка, рекомендуем объезд',
    en: 'Traffic jam ahead, consider alternative route',
    uz: 'Oldinda tirbandlik, aylanma yo\'lni tavsiya qilamiz',
    kk: 'Алда кептеліс, айналма жолды ұсынамыз',
    tr: 'İleride trafik sıkışıklığı, alternatif rota önerilir',
    de: 'Stau voraus, alternative Route empfohlen',
    fr: 'Embouteillage devant, itinéraire alternatif recommandé',
    es: 'Congestión adelante, considere una ruta alternativa',
    it: 'Ingorgo davanti, si consiglia percorso alternativo',
    pt: 'Congestionamento à frente, considere rota alternativa',
    pl: 'Korek przed tobą, rozważ alternatywną trasę',
    uk: 'Попереду затор, рекомендуємо об\'їзд',
    ar: 'ازدحام مروري أمامك، يُنصح بطريق بديل',
    hi: 'आगे ट्रैफिक जाम, वैकल्पिक मार्ग अपनाएँ',
    zh: '前方交通拥堵，建议选择替代路线',
    ja: '渋滞あり、代替ルートをご検討ください',
    ko: '전방 교통 체증, 우회 도로 이용',
    id: 'Kemacetan di depan, pertimbangkan rute alternatif',
    vi: 'Tắc đường phía trước, cân nhắc đường thay thế',
    th: 'รถติดข้างหน้า พิจารณาเส้นทางอื่น',
  },
  ICE: {
    ru: 'Осторожно! На дороге гололёд, снизьте скорость',
    en: 'Caution! Icy road, slow down',
    uz: 'Diqqat! Yo\'lda muz, sekinlashtiring',
    kk: 'Сақ болыңыз! Жолда мұз, жылдамдықты азайтыңыз',
    tr: 'Dikkat! Yolda buz, yavaşlayın',
    de: 'Vorsicht! Eisglatte Straße, langsamer fahren',
    fr: 'Attention! Route verglacée, ralentissez',
    es: 'Precaución! Carretera helada, reduzca la velocidad',
    it: 'Attenzione! Strada ghiacciata, rallenta',
    pt: 'Cuidado! Estrada gelada, reduza a velocidade',
    pl: 'Uwaga! Śliska droga, zwolnij',
    uk: 'Обережно! На дорозі ожеледиця, знизьте швидкість',
    ar: 'انتبه! طريق جليدية أمامك، خفف السرعة',
    hi: 'सावधान! सड़क पर बर्फ, धीमा करें',
    zh: '注意！路面结冰，减速慢行',
    ja: '注意！凍結道路、速度を落としてください',
    ko: '주의! 빙판 도로, 속도 줄이세요',
    id: 'Perhatian! Jalan licin, pelan-pelan',
    vi: 'Chú ý! Đường đóng băng, giảm tốc độ',
    th: 'ระวัง! ถนนลื่น โปรดลดความเร็ว',
  },
  POTHOLE: {
    ru: 'Внимание! На дороге ямы, снизьте скорость',
    en: 'Potholes ahead, slow down',
    uz: 'Diqqat! Yo\'lda chuqurlar, sekinlashtiring',
    kk: 'Назар аударыңыз! Жолда шұңқырлар, жылдамдықты азайтыңыз',
    tr: 'Dikkat! Yolda çukurlar, yavaşlayın',
    de: 'Achtung! Schlaglöcher voraus, langsamer fahren',
    fr: 'Attention! Nids-de-poule devant, ralentissez',
    es: 'Atención! Baches adelante, reduzca la velocidad',
    it: 'Attenzione! Buche davanti, rallenta',
    pt: 'Atenção! Buracos à frente, reduza a velocidade',
    pl: 'Uwaga! Dziury na drodze, zwolnij',
    uk: 'Увага! На дорозі ями, знизьте швидкість',
    ar: 'انتبه! حفر في الطريق أمامك، خفف السرعة',
    hi: 'सावधान! आगे गड्ढे, धीमा करें',
    zh: '注意！前方路面坑洼，减速慢行',
    ja: '注意！穴ぼこあり、減速してください',
    ko: '주의! 전방 포트홀, 속도 줄이세요',
    id: 'Perhatian! Lubang di jalan, pelan-pelan',
    vi: 'Chú ý! Ổ gà phía trước, giảm tốc độ',
    th: 'ระวัง! หลุมข้างหน้า ลดความเร็ว',
  },
  POLICE: {
    ru: 'Впереди пост полиции',
    en: 'Police ahead',
    uz: 'Oldinda politsiya',
    kk: 'Алда полиция',
    tr: 'İleride polis',
    de: 'Polizei voraus',
    fr: 'Police devant',
    es: 'Policía adelante',
    it: 'Polizia davanti',
    pt: 'Polícia à frente',
    pl: 'Policja przed tobą',
    uk: 'Попереду поліція',
    ar: 'شرطة أمامك',
    hi: 'आगे पुलिस',
    zh: '前方有警察',
    ja: '警察前方',
    ko: '전방 경찰',
    id: 'Polisi di depan',
    vi: 'Cảnh sát phía trước',
    th: 'ตำรวจข้างหน้า',
  },
  FLOODING: {
    ru: 'Внимание! Затопление дороги',
    en: 'Flooded road ahead',
    uz: 'Diqqat! Yo\'l suv ostida',
    kk: 'Назар аударыңыз! Жол су астында',
    tr: 'Dikkat! Yol su altında',
    de: 'Achtung! Überflutete Straße voraus',
    fr: 'Attention! Route inondée devant',
    es: 'Atención! Carretera inundada adelante',
    it: 'Attenzione! Strada allagata davanti',
    pt: 'Atenção! Estrada alagada à frente',
    pl: 'Uwaga! Zalana droga przed tobą',
    uk: 'Увага! Затоплення дороги',
    ar: 'انتبه! طريق مغمورة بالمياه أمامك',
    hi: 'सावधान! आगे जलमग्न सड़क',
    zh: '注意！前方道路被淹',
    ja: '注意！冠水道路あり',
    ko: '주의! 전방 침수 도로',
    id: 'Perhatian! Jalan tergenang air',
    vi: 'Chú ý! Đường ngập nước phía trước',
    th: 'ระวัง! น้ำท่วมถนนข้างหน้า',
  },
  FOG: {
    ru: 'Внимание! Густой туман, включите противотуманные фары',
    en: 'Dense fog ahead, turn on fog lights',
    uz: 'Diqqat! Kuchli tuman, tumanga qarshi chiroqlarni yoqing',
    kk: 'Назар аударыңыз! Қою тұман, тұманға қарсы шамдарды қосыңыз',
    tr: 'Dikkat! Yoğun sis, sis farlarını açın',
    de: 'Achtung! Dichtere Nebel, Nebelscheinwerfer einschalten',
    fr: 'Attention! Brouillard dense, allumez les antibrouillards',
    es: 'Atención! Niebla densa, encienda las luces antiniebla',
    it: 'Attenzione! Nebbia fitta, accendere i fendinebbia',
    pt: 'Atenção! Nevoeiro denso, ligue os faróis de nevoeiro',
    pl: 'Uwaga! Gęsta mgła, włącz światła przeciwmgielne',
    uk: 'Увага! Густий туман, увімкніть протитуманні фари',
    ar: 'انتبه! ضباب كثيف أمامك، أشعل الأنوار الضبابية',
    hi: 'सावधान! आगे घना कोहरा, फॉग लाइट चालू करें',
    zh: '注意！前方浓雾，打开雾灯',
    ja: '注意！濃霧、フォグランプを点けてください',
    ko: '주의! 전방 짙은 안개, 안개등 켜세요',
    id: 'Perhatian! Kabut tebal, nyalakan lampu kabut',
    vi: 'Chú ý! Sương mù dày, bật đèn sương mù',
    th: 'ระวัง! หมอกหนาข้างหน้า เปิดไฟตัดหมอก',
  },
  LOW_BRIDGE: {
    ru: 'Внимание! Низкий мост впереди',
    en: 'Low bridge ahead',
    uz: 'Diqqat! Oldinda past ko\'prik',
    kk: 'Назар аударыңыз! Алда төмен көпір',
    tr: 'Dikkat! İleride alçak köprü',
    de: 'Achtung! Niedrige Brücke voraus',
    fr: 'Attention! Pont bas devant',
    es: 'Atención! Puente bajo adelante',
    it: 'Attenzione! Ponte basso davanti',
    pt: 'Atenção! Ponte baixa à frente',
    pl: 'Uwaga! Niski most przed tobą',
    uk: 'Увага! Попереду низький міст',
    ar: 'انتبه! جسر منخفض أمامك',
    hi: 'सावधान! आगे नीचा पुल',
    zh: '注意！前方低橋',
    ja: '注意！低い橋あり',
    ko: '주의! 전방 낮은 다리',
    id: 'Perhatian! Jembatan rendah di depan',
    vi: 'Chú ý! Cầu thấp phía trước',
    th: 'ระวัง! สะพานต่ำข้างหน้า',
  },
};

function expandTemplate(tmpl: string, vars: Record<string, string>): string {
  return tmpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

function formatNavInstruction(
  instruction: { text: string; type: string; distance: number; streetName?: string },
  lang: string,
): string {
  const phraseType = instruction.type === 'turn'
    ? (instruction.text.toLowerCase().includes('left') ? 'turn_left' : 'turn_right')
    : instruction.type;
  const phraseSet = NAV[phraseType];
  if (!phraseSet) return instruction.text;
  const val = phraseSet[lang] || phraseSet.en;
  if (!val) return instruction.text;
  const dist = formatDistanceLocalized(instruction.distance, lang);
  const street = instruction.streetName || '';
  let tmpl: string;
  if (Array.isArray(val)) {
    if (phraseType === 'depart') tmpl = street ? val[0] : val[1];
    else if (phraseType === 'continue') tmpl = instruction.distance > 0 ? val[0] : val[1];
    else tmpl = street ? val[0] : val[1];
  } else {
    tmpl = val;
  }
  if (phraseType === 'fork') {
    const dir = instruction.text.toLowerCase().includes('left')
      ? (DIR[lang]?.left || DIR.en.left) : (DIR[lang]?.right || DIR.en.right);
    return expandTemplate(tmpl, { d: dist, dir });
  }
  return expandTemplate(tmpl, { d: dist, s: street });
}

function getVoiceByLang(voices: SpeechSynthesisVoice[], langCode: string): SpeechSynthesisVoice | null {
  const preferred = voices.find((v) => v.lang.startsWith(langCode) && !v.name.includes('Mobile'));
  if (preferred) return preferred;
  return voices.find((v) => v.lang.startsWith(langCode)) || null;
}

function pickBestVoice(voices: SpeechSynthesisVoice[], targetLang: string): SpeechSynthesisVoice | null {
  const langShort = targetLang.split('-')[0];
  const candidates = voices.filter((v) => v.lang.startsWith(langShort));
  const neural = candidates.find(
    (v) => (v.name.includes('Google') || v.name.includes('Neural') || v.name.includes('Premium')) && !v.name.includes('Mobile'),
  );
  if (neural) return neural;
  const ms = candidates.find((v) => v.name.includes('Microsoft') && !v.name.includes('Mobile'));
  if (ms) return ms;
  const anyDesktop = candidates.find((v) => !v.name.includes('Mobile'));
  if (anyDesktop) return anyDesktop;
  return candidates[0] || null;
}

/** Pauses and fully releases a blob-URL-backed audio element started by playAudioBlob. */
function stopBlobAudio(audio: HTMLAudioElement) {
  audio.pause();
  const url = (audio as HTMLAudioElement & { _blobUrl?: string })._blobUrl;
  if (url) URL.revokeObjectURL(url);
}

function playAudioBlob(audioBlob: Blob, currentAudioRef: MutableRefObject<HTMLAudioElement | null>): Promise<void> {
  const url = URL.createObjectURL(audioBlob);
  const audio = new Audio(url) as HTMLAudioElement & { _blobUrl?: string };
  audio._blobUrl = url;
  currentAudioRef.current = audio;
  return new Promise((resolve) => {
    const cleanup = () => {
      URL.revokeObjectURL(url);
      if (currentAudioRef.current === audio) currentAudioRef.current = null;
      resolve();
    };
    audio.onended = cleanup;
    audio.onerror = cleanup;
    audio.play();
  });
}

export function useVoiceAssistant() {
  const { user } = useAuthStore();
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcript, setTranscript] = useState('');
  const recognitionRef = useRef<any>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const lastInstructionRef = useRef('');
  const voicesLoadedRef = useRef(false);
  const lang = user?.preferredLang || 'ru';
  const langCfg = getLanguageConfig(lang);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const load = () => { voicesLoadedRef.current = true; };
    if (window.speechSynthesis.getVoices().length > 0) {
      voicesLoadedRef.current = true;
    } else {
      window.speechSynthesis.addEventListener('voiceschanged', load);
    }
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
      recognitionRef.current = null;
    }
    setIsListening(false);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, [langCfg.voiceLang]);

  const speak = useCallback(async (text: string, priority = false) => {
    if (typeof window === 'undefined') return;
    if (!useAuthStore.getState().preferences?.voiceEnabled) return;
    // Low-priority announcements (e.g. reading a search result) shouldn't cut
    // off a higher-priority one (arrival, reroute, wrong-way) already playing.
    // The primary playback path is a fetched TTS <audio> blob, not the Web
    // Speech API, so "already speaking" has to check both.
    const audioBusy = !!currentAudioRef.current && !currentAudioRef.current.paused;
    if (!priority && (window.speechSynthesis.speaking || audioBusy)) return;

    const normalizedText = lang === 'ru' ? normalizeRussianText(text) : text;

    window.speechSynthesis.cancel();
    if (currentAudioRef.current) {
      stopBlobAudio(currentAudioRef.current);
      currentAudioRef.current = null;
    }
    setIsSpeaking(true);

    try {
      const response = await fetch(`${BASE_URL}/tts/synthesize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: normalizedText, lang }),
      });
      if (!response.ok) throw new Error('TTS API error');
      const audioBlob = await response.blob();
      await playAudioBlob(audioBlob, currentAudioRef);
      setIsSpeaking(false);
    } catch {
      const utterance = new SpeechSynthesisUtterance(normalizedText);
      const voices = window.speechSynthesis.getVoices().filter(v => v.lang.startsWith(langCfg.voiceLang.split('-')[0]));
      const best = voices.find(v => v.name.includes('Neural') || v.name.includes('Google') || v.name.includes('Premium') || v.name.includes('Microsoft'))
        || voices[0]
        || pickBestVoice(window.speechSynthesis.getVoices(), langCfg.voiceLang);
      utterance.voice = best || null;
      utterance.lang = langCfg.voiceLang;
      utterance.rate = 0.85;
      utterance.volume = 1.0;
      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);
      window.speechSynthesis.speak(utterance);
    }
  }, [langCfg.voiceLang, lang]);

  const stopSpeaking = useCallback(() => {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
  }, []);

  const startListening = useCallback(() => {
    if (typeof window === 'undefined') return;

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    recognitionRef.current = new SpeechRecognition();
    recognitionRef.current.lang = langCfg.speechLang;
    recognitionRef.current.continuous = false;
    recognitionRef.current.interimResults = true;
    recognitionRef.current.maxAlternatives = 1;
    recognitionRef.current.onstart = () => { setIsListening(true); setTranscript(''); };
    recognitionRef.current.onresult = (event: any) => {
      const last = event.results.length - 1;
      const text = event.results[last][0].transcript;
      setTranscript(text);
      if (event.results[last].isFinal) setIsListening(false);
    };
    recognitionRef.current.onerror = () => setIsListening(false);
    recognitionRef.current.onend = () => setIsListening(false);
    recognitionRef.current.start();
  }, [langCfg.speechLang]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
  }, []);

  const announceNavigation = useCallback(
    (instructionText: string, type?: string, distance?: number, streetName?: string) => {
      const raw = { text: instructionText, type: type || 'continue', distance: distance || 0, streetName };
      const formatted = formatNavInstruction(raw, lang);
      if (formatted === lastInstructionRef.current) return;
      lastInstructionRef.current = formatted;
      speak(formatted, true);
    },
    [speak, lang],
  );

  const announceHazard = useCallback(
    (hazardType: string) => {
      const msg = HAZARD[hazardType]?.[lang] || HAZARD[hazardType]?.en || hazardType;
      speak(msg, true);
    },
    [speak, lang],
  );

  return {
    isListening,
    isSpeaking,
    transcript,
    speak,
    stopSpeaking,
    startListening,
    stopListening,
    announceNavigation,
    announceHazard,
  };
}
