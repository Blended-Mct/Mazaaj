// Lightweight, explainable sentiment cues for English and Arabic customer text.
// It is a keyword lexicon, not a language model: it only ever produces *cues*
// that feed the mood estimate, and every cue it finds is returned so agents can
// see exactly which words were picked up.

const EN_NEGATIVE = {
  'how many times': 2.5, 'third time': 2.5, 'fourth time': 3, 'fed up': 3, 'no one': 1.5, 'no response': 2,
  'not working': 2, 'still not': 2, "didn't call": 2, 'did not call': 2, 'never called': 2.5, 'no show': 2,
  'no-show': 2, 'lost a day': 2, 'waste of time': 3, 'waited for': 1, 'not acceptable': 3,
  unacceptable: 3, worst: 3, terrible: 3, disgusting: 3, furious: 3, angry: 3, ridiculous: 2.5, useless: 2.5,
  frustrated: 2.5, frustrating: 2.5, disappointed: 2, annoyed: 2, upset: 2.5, unhappy: 2.5, complaint: 2, complain: 2,
  overcharged: 2.5, double: 1, again: 1, still: 1, nobody: 1.5, never: 1, slow: 1, poor: 1.5, bad: 1.5,
  delay: 1.2, delayed: 1.2, waiting: 1, problem: 1, issue: 0.7, wrong: 1.5, cancel: 2, broken: 1.5,
};

const EN_POSITIVE = {
  'thank you': 2.5, 'working now': 2, 'works now': 2, 'well done': 2.5, 'much better': 2,
  thanks: 2, thank: 2, great: 2, excellent: 3, perfect: 2.5, appreciate: 2.5, appreciated: 2.5, helpful: 2,
  happy: 2, resolved: 1.5, fast: 1, quick: 1, love: 2, amazing: 3, good: 1, satisfied: 2, wonderful: 3, kind: 1.5,
};

const AR_NEGATIVE = {
  'غير مقبول': 3, 'للمرة الثالثة': 2.5, 'كم مرة': 2.5, 'ما يشتغل': 2, 'لا يعمل': 2, 'ما أحد': 1.5, 'لا أحد': 1.5,
  'بدون فائدة': 2.5, 'ما رد': 1.5, 'ما اتصل': 2, 'لم يتصل': 2, 'ما جا': 2, 'لم يحضر': 2, 'بدون رد': 2,
  زعلان: 2.5, مستاء: 2.5, غاضب: 3, سيء: 2.5, سيئة: 2.5, أسوأ: 3, مشكلة: 1, ضعيف: 1.5, بطيء: 1.5, بطء: 1.5,
  متأخر: 1.5, تأخير: 1.5, انقطاع: 1.5, مقطوع: 1.5, شكوى: 2, مرتفعة: 1, مضاعفة: 1.5, تعبت: 2, للأسف: 1.5,
};

const AR_POSITIVE = {
  'يعطيك العافية': 2.5, 'جزاك الله خير': 2.5, 'تم الحل': 2, 'الحمد لله': 1, 'الله يعطيك': 2,
  شكرا: 2, مشكور: 2, مشكورين: 2, ممتاز: 3, ممتازة: 3, رائع: 3, تسلم: 2, سريع: 1, ممنون: 2, راضي: 2,
};

// Phrases that should trigger an escalation review whatever the overall tone.
const ESCALATION = [
  { term: 'cancel', label: 'cancellation' },
  { term: 'terminate', label: 'cancellation' },
  { term: 'switch to', label: 'switching provider' },
  { term: 'ooredoo', label: 'switching provider' },
  { term: 'vodafone', label: 'switching provider' },
  { term: 'port out', label: 'switching provider' },
  { term: 'tra', label: 'regulator complaint' },
  { term: 'regulator', label: 'regulator complaint' },
  { term: 'lawyer', label: 'legal action' },
  { term: 'legal', label: 'legal action' },
  { term: 'court', label: 'legal action' },
  { term: 'social media', label: 'public complaint' },
  { term: 'twitter', label: 'public complaint' },
  { term: 'إلغاء', label: 'cancellation' },
  { term: 'ألغي', label: 'cancellation' },
  { term: 'بلغي', label: 'cancellation' },
  { term: 'هيئة تنظيم الاتصالات', label: 'regulator complaint' },
  { term: 'الهيئة', label: 'regulator complaint' },
  { term: 'محامي', label: 'legal action' },
  { term: 'أوريدو', label: 'switching provider' },
  { term: 'فودافون', label: 'switching provider' },
  { term: 'وسائل التواصل', label: 'public complaint' },
];

const EN_NEGATORS = new Set(['not', 'no', 'never', "don't", 'dont', "didn't", 'didnt', "isn't", 'isnt', "wasn't", 'wasnt', 'hardly']);
const AR_NEGATORS = ['ما', 'لا', 'مب', 'مو', 'غير', 'ليس', 'لم'];

const ARABIC_RE = /[؀-ۿ]/;

export function normalizeArabic(text) {
  return text
    .replace(/[ً-ْـ]/g, '') // diacritics + tatweel
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه');
}

function prepare(lexicon, arabic) {
  return Object.entries(lexicon)
    .map(([term, weight]) => ({ term, key: arabic ? normalizeArabic(term) : term, weight }))
    .sort((a, b) => b.key.length - a.key.length);
}

const LEX = {
  enNeg: prepare(EN_NEGATIVE, false),
  enPos: prepare(EN_POSITIVE, false),
  arNeg: prepare(AR_NEGATIVE, true),
  arPos: prepare(AR_POSITIVE, true),
};

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Finds lexicon terms, masking each match so "thank you" is not also counted as "thank".
function scan(text, entries, arabic) {
  const hits = [];
  let work = text;
  for (const { term, key, weight } of entries) {
    const re = arabic
      ? new RegExp(escapeRe(key), 'g')
      : new RegExp(`(^|[^a-z'])(${escapeRe(key)})(?=$|[^a-z'])`, 'g');
    let m;
    while ((m = re.exec(work))) {
      const start = arabic ? m.index : m.index + m[1].length;
      const before = work.slice(Math.max(0, start - 14), start);
      hits.push({ term, weight, start, before });
      work = work.slice(0, start) + ' '.repeat(key.length) + work.slice(start + key.length);
      re.lastIndex = start + key.length;
    }
  }
  return hits;
}

function negated(before, arabic) {
  if (arabic) {
    const words = before.trim().split(/\s+/).slice(-2);
    return words.some((w) => AR_NEGATORS.map(normalizeArabic).includes(w));
  }
  const words = before.trim().split(/\s+/).slice(-2);
  return words.some((w) => EN_NEGATORS.has(w));
}

/**
 * @returns {{score:number,label:'negative'|'neutral'|'positive',negative:string[],positive:string[],escalation:{term:string,label:string}[],language:'ar'|'en'}}
 */
export function analyzeText(raw) {
  const text = String(raw || '');
  const arabic = ARABIC_RE.test(text);
  const en = ` ${text.toLowerCase()} `;
  const ar = ` ${normalizeArabic(text)} `;

  let pos = 0;
  let neg = 0;
  const negative = [];
  const positive = [];

  const tally = (hits, isPositive, isArabic) => {
    for (const h of hits) {
      if (isPositive && negated(h.before, isArabic)) {
        neg += h.weight * 0.8;
        negative.push(`not ${h.term}`);
      } else if (isPositive) {
        pos += h.weight;
        positive.push(h.term);
      } else {
        neg += h.weight;
        negative.push(h.term);
      }
    }
  };

  tally(scan(en, LEX.enNeg, false), false, false);
  tally(scan(en, LEX.enPos, false), true, false);
  if (arabic) {
    tally(scan(ar, LEX.arNeg, true), false, true);
    tally(scan(ar, LEX.arPos, true), true, true);
  }

  const escalation = [];
  for (const e of ESCALATION) {
    const isAr = ARABIC_RE.test(e.term);
    const found = isAr
      ? ar.includes(normalizeArabic(e.term))
      : new RegExp(`(^|[^a-z])${escapeRe(e.term)}(?=$|[^a-z])`).test(en);
    if (found && !escalation.some((x) => x.label === e.label)) escalation.push({ term: e.term, label: e.label });
  }

  const total = pos + neg;
  const score = total === 0 ? 0 : Math.max(-1, Math.min(1, (pos - neg) / Math.max(4, total)));
  const label = score <= -0.25 ? 'negative' : score >= 0.25 ? 'positive' : 'neutral';
  return { score: Math.round(score * 100) / 100, label, negative, positive, escalation, language: arabic ? 'ar' : 'en' };
}
