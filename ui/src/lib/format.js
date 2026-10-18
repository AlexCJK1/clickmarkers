// Number, time and name formats for the page. Pure, so the tests can hold them to the copy rules:
// British English, sentence case, money in the currency it was billed in, durations in words.

export const usd = (n, d = 2) => `$${(+n || 0).toFixed(d)}`;
/** Whole dollars when the figure is whole ("$15"), else two places ("$4.21"). */
export const usdShort = n => (Number.isInteger(+n) ? `$${+n}` : usd(n));
/** Ad money, in the currency the ad account bills in (stats.json "currency", an ISO code; US dollars if unset). */
const SIGN = { USD: '$', GBP: '£', EUR: '€', AUD: 'A$', CAD: 'C$', NZD: 'NZ$' };
export const sign = cur => SIGN[cur] ?? (/^[A-Z]{3}$/.test(cur || '') ? `${cur}\u00a0` : '$');
export const money = (n, cur, d = 2) => `${sign(cur)}${(+n || 0).toFixed(d)}`;
export const moneyShort = (n, cur) => (Number.isInteger(+n) ? `${sign(cur)}${+n}` : money(n, cur));
const NAME = {
  USD: 'US dollars',
  GBP: 'pounds sterling',
  EUR: 'euros',
  AUD: 'Australian dollars',
  CAD: 'Canadian dollars',
};
export const currencyName = cur => NAME[cur] || (/^[A-Z]{3}$/.test(cur || '') ? cur : 'US dollars');
export const int = n => Math.round(+n || 0).toLocaleString('en-GB');
export const kilo = n => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n || 0)));
export const pct = (a, b) => (b > 0 ? Math.round((100 * (+a || 0)) / b) : 0);

const NB = '\u00a0'; // a number and its unit never part at a line end
/** 21 s, 1 min 29 s, 23 min 22 s, 2 h 5 min. */
export function dur(ms) {
  const s = Math.round((+ms || 0) / 1000);
  if (s < 60) return `${s}${NB}s`;
  if (s < 3600) return s % 60 ? `${Math.floor(s / 60)}${NB}min ${s % 60}${NB}s` : `${s / 60}${NB}min`;
  return `${Math.floor(s / 3600)}${NB}h ${Math.floor((s % 3600) / 60)}${NB}min`;
}
const two = n => String(n).padStart(2, '0');
export const hm = ts => {
  const d = new Date(ts);
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
};
export const hms = ts => {
  const d = new Date(ts);
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
};
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WKD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const weekdayDate = ts => {
  const d = new Date(ts);
  return `${WKD[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`;
};
/** "Today, Mon 12 Oct", "Yesterday, Sun 11 Oct", "Fri 9 Oct". */
export function dayHeading(ts, now = Date.now()) {
  const a = new Date(ts);
  a.setHours(0, 0, 0, 0);
  const b = new Date(now);
  b.setHours(0, 0, 0, 0);
  const diff = Math.round((b - a) / 86400000);
  return diff === 0 ? `Today, ${weekdayDate(ts)}` : diff === 1 ? `Yesterday, ${weekdayDate(ts)}` : weekdayDate(ts);
}
/** "12:08" today, "Sun 22:41" this week, "9 Oct 22:41" before that. */
export function when(ts, now = Date.now()) {
  const a = new Date(ts);
  const b = new Date(now);
  if (a.toDateString() === b.toDateString()) return hm(ts);
  if (Math.abs(now - ts) < 6 * 86400000) return `${WKD[a.getDay()]} ${hm(ts)}`;
  return `${a.getDate()} ${MON[a.getMonth()]} ${hm(ts)}`;
}
/** "Fri 16 Oct 09:00", for booked times. */
export const whenLong = ts => `${weekdayDate(ts)} ${hm(ts)}`;
/** "just now", "24 min ago", "3 h ago", "2 d ago". */
export function ago(ts, now = Date.now()) {
  if (!ts) return 'never';
  const m = Math.round((now - ts) / 60000);
  return m < 1
    ? 'just now'
    : m < 60
      ? `${m} min ago`
      : m < 1440
        ? `${Math.round(m / 60)} h ago`
        : `${Math.round(m / 1440)} d ago`;
}
/** "in 26 min", "in 3 h 5 min", "in 4 d". */
export function until(ts, now = Date.now()) {
  if (!ts) return '';
  const m = Math.max(0, Math.round((ts - now) / 60000));
  return m >= 1440
    ? `in ${Math.round(m / 1440)} d`
    : m >= 60
      ? `in ${Math.floor(m / 60)} h ${m % 60} min`
      : `in ${m} min`;
}

/** claude-opus-5-5 or "opus" to "Opus 5.5". */
export function modelName(m) {
  const s = String(m || '');
  const short = { opus: 'Opus 5.5', sonnet: 'Sonnet 5.5', haiku: 'Haiku 5.5' }[s];
  if (short) return short;
  const x = s.replace(/^claude-/, '').match(/^([a-z]+)-(\d+)-(\d+)/);
  return x ? `${x[1].charAt(0).toUpperCase()}${x[1].slice(1)} ${x[2]}.${x[3]}` : s;
}
/** Sentence case for labels that arrive in capitals ("NEW LEADS PER DAY" to "New leads per day"). */
export function sentence(s) {
  const t = String(s || '').trim();
  if (!t) return '';
  return t === t.toUpperCase() ? t.charAt(0) + t.slice(1).toLowerCase() : t.charAt(0).toUpperCase() + t.slice(1);
}
/** Text from the office (an error, a result) for display: no em dashes, first letter up. Never used on a draft. */
export function plain(s) {
  const t = String(s ?? '')
    .replace(/\s*\u2014\s*/g, ', ')
    .replace(/\u2013/g, '-')
    .trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}
/** The short name of an ad ("Campaign · AD NAME" to "Ad name"), for a quote in a sentence. */
export const adName = n =>
  sentence(
    String(n || '')
      .split('·')
      .pop()
      .trim(),
  );
/** A name that arrives in capitals reads as a name ("SEO WRITER" to "SEO writer"); known acronyms stay. */
const ACRO = new Set(['SEO', 'API', 'HR', 'OSM', 'UK', 'A/B']);
export const displayName = n =>
  String(n || '')
    .split(' ')
    .map((w, i) => (ACRO.has(w) ? w : i === 0 ? w.charAt(0) + w.slice(1).toLowerCase() : w.toLowerCase()))
    .join(' ');
/** A ticket or routine title as shown: a desk prefix in capitals ("NUMBERS: today's numbers") reads as
 *  a name ("Numbers: today's numbers"); the rest is the desk's own words, left alone. */
export const tidyTitle = t =>
  String(t || '').replace(/^([A-Z][A-Z0-9 &/-]{1,40}):(\s*)/, (m, p, sp) => `${displayName(p)}:${sp || ' '}`);
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
