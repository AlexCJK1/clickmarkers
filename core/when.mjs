// Plain words to times. Two jobs:
//   parseWhen("every weekday at 8am send the digest") → a routine schedule plus the task left over
//   parseAt("tomorrow 9:30: post the spring offer")        → one moment in the office's zone plus the task
// Word times ("morning", "lunchtime") are guesses and are flagged so the page and the phone can read
// them back. A schedule with no time, or "weekly" with no day, asks for the missing part instead of
// guessing it.
import { describeWhen, zonedTime, localDate, addDays } from './clock.mjs';

const DAY_WORDS = [['sun', 0], ['mon', 1], ['tue', 2], ['wed', 3], ['thu', 4], ['fri', 5], ['sat', 6]];
const DAY_RE = '(sun|mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat)(?:day|nesday|rsday|urday|sday)?s?';
const WORD_TIMES = { noon: '12:00', midday: '12:00', lunchtime: '12:30', midnight: '00:00', morning: '08:00', afternoon: '14:00', evening: '17:00', night: '20:00', tonight: '20:00' };
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = n => String(n).padStart(2, '0');
const dayNum = s => { const k = String(s).toLowerCase().slice(0, 3); return (DAY_WORDS.find(([w]) => w === k) || [])[1]; };

/** "8am", "8:30", "17:30", "8.30pm", "at 8" → "HH:MM" (or null). Returns { at, guess, match }. */
export function findTime(text) {
  const s = String(text);
  let m = s.match(/\b(?:at\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\b/i);
  if (m) { let h = +m[1] % 12; if (/pm/i.test(m[3])) h += 12; const mi = +(m[2] || 0); if (h < 24 && mi < 60) return { at: `${pad(h)}:${pad(mi)}`, guess: false, match: m[0] }; }
  m = s.match(/\b(?:at\s+)?([01]?\d|2[0-3])[:.]([0-5]\d)\b/);
  if (m) return { at: `${pad(+m[1])}:${m[2]}`, guess: false, match: m[0] };
  m = s.match(/\bat\s+([01]?\d|2[0-3])\b(?![:.\d])/i);
  if (m) return { at: `${pad(+m[1])}:00`, guess: +m[1] <= 12, match: m[0] };
  m = s.match(new RegExp(`\\b(?:at\\s+|in the\\s+|every\\s+|each\\s+)?(${Object.keys(WORD_TIMES).join('|')})\\b`, 'i'));
  if (m) return { at: WORD_TIMES[m[1].toLowerCase()], guess: !/^(noon|midday|midnight)$/i.test(m[1]), match: m[0] };
  return null;
}
const clean = s => String(s).replace(/\s{2,}/g, ' ').replace(/^[\s,;:.\-–]+|[\s,;:\-–]+$/g, '').replace(/^(and|to|then)\s+/i, '').trim();
const cut = (s, frag) => (frag ? s.replace(frag, ' ') : s);

// The schedule words, one token at a time. A schedule is a run of these at the start of the sentence
// ("every friday at 4pm send the rota") or at its end ("check the page at 9 every day"); words inside
// the task ("the weekend rota", "the 7am start", "weekly report") are never read as the schedule.
const T = {
  rec: [/(?:every|each)\b/iy, /(?:daily|hourly|weekly|everyday|once a week)\b/iy, /\d{1,3}\s*(?:hours?|hrs?|minutes?|mins?)\b/iy],
  days: [/(?:weekdays?|working days|week\s*days|weekends?)\b/iy, /mon(?:day)?\s*(?:-|to|through)\s*fri(?:day)?\b/iy, new RegExp(`${DAY_RE}\\b`, 'iy')],
  clock: [/at\s+\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?\b/iy, /\d{1,2}[:.]\d{2}\s*(?:am|pm)?\b/iy, /\d{1,2}\s*(?:am|pm)\b/iy, /(?:at\s+)?(?:noon|midday|lunchtime|midnight)\b/iy, /(?:at\s+)?:\d{2}(?:\s*past)?\b/iy],
  part: [/(?:at\s+|in the\s+)?(?:morning|afternoon|evening|night)\b/iy],
  win: [/between\s+\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?\s*(?:and|-|to)\s*\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?\b/iy],
  unit: [/(?:hour|day|week|morning|afternoon|evening|night)\b/iy], // only straight after "every"
  glue: [/\s+/y, /[,&+]/y, /(?:and|on|at|from|of)\b/iy],
};
/**
 * How far the schedule words run from `start`: { end (after the last real schedule word), core (a
 * recurrence or a day was seen) }. A clock time after the recurrence closes it: only days may follow
 * ("at 9 on mondays"). A part of the day ("saturday morning") may still be followed by a clock time
 * ("at 10"). "day", "hour", "week" and the parts of the day count as units only straight after
 * "every"; so "every day at 6pm daily summary" stops at "daily".
 */
function run(text, start) {
  let i = start, end = start, core = false, clock = false, part = false, closed = false, last = '';
  for (;;) {
    let hit = null;
    for (const kind of ['win', 'rec', 'days', 'unit', 'clock', 'part', 'glue']) {
      if (closed && !['days', 'glue'].includes(kind)) continue;
      if ((kind === 'clock' && clock) || (kind === 'part' && (part || clock))) continue;
      if (kind === 'unit' && last !== 'every') continue;
      for (const re of T[kind]) { re.lastIndex = i; const m = re.exec(text); if (m && m[0].length) { hit = { kind, len: m[0].length, word: m[0].trim().toLowerCase() }; break; } }
      if (hit) break;
    }
    if (!hit) break;
    i += hit.len;
    if (hit.kind !== 'glue') { end = i; last = hit.kind === 'rec' && /^(every|each)$/.test(hit.word) ? 'every' : hit.kind; }
    if (hit.kind === 'rec' || hit.kind === 'days') core = true;
    if (hit.kind === 'unit' && /morning|afternoon|evening|night/.test(hit.word)) part = true;
    if (hit.kind === 'part') part = true;
    if (hit.kind === 'clock') { clock = true; if (core) closed = true; }
    if (i >= text.length) break;
  }
  return { end, core };
}
/** Split a sentence into its schedule words and the task. */
export function scheduleSpan(sentence) {
  const text = String(sentence || '').trim();
  const pre = run(text, 0);
  if (pre.core) return { span: text.slice(0, pre.end), task: text.slice(pre.end) };
  const starts = /\b(?:every|each|daily|hourly|weekly|weekdays?|weekends?|working days|on\s+(?:sun|mon|tue|wed|thu|fri|sat)[a-z]*|(?:sun|mon|tue|wed|thu|fri|sat)[a-z]*days?)\b|\bat\s+:?\d|\b\d{1,2}[:.]\d{2}|\b\d{1,2}\s*(?:am|pm)\b|\b(?:at\s+)?(?:noon|midday|lunchtime|midnight)\b/ig;
  for (const m of text.matchAll(starts)) {
    const r = run(text, m.index);
    if (r.core && text.slice(r.end).replace(/[\s.!]+$/, '') === '') return { span: text.slice(m.index), task: text.slice(0, m.index) };
  }
  return { span: '', task: text };
}

/**
 * A routine schedule from a sentence. Returns:
 *   { ok: true, when, whenText, task, guess }       a schedule and the task left over
 *   { ok: false, ask: 'time' | 'day' | 'schedule', task }   something is missing
 */
export function parseWhen(sentence) {
  const parts = scheduleSpan(sentence);
  const r = parseSpan(parts.span);
  const task = clean(parts.task);
  if (r.when) return { ok: true, when: r.when, whenText: describeWhen(r.when), task, guess: r.guess };
  return { ok: false, ask: r.ask || 'schedule', task };
}
function parseSpan(span) {
  let s = ` ${String(span || '').trim()} `; let when = null; let guess = false; let ask = '';
  const take = re => { const m = s.match(re); if (m) s = cut(s, m[0]); return m; };
  // every N minutes
  let m = take(/\bevery\s+(\d{1,3})\s*(?:min|mins|minute|minutes)\b/i);
  if (m) when = { kind: 'every', minutes: Math.max(5, +m[1]) };
  // hourly / every N hours, optional window and weekdays
  if (!when) {
    m = take(/\b(?:every\s+(\d{1,2})\s*hours?|every\s+hour|hourly)\b/i);
    if (m) {
      when = { kind: 'hourly', minute: 0 };
      if (m[1] && +m[1] > 1) when.step = Math.min(12, +m[1]);
      const w = take(/\bbetween\s+(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\s*(?:and|-|to)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\b/i);
      if (w) { const h = (x, ap, other) => { let v = +x % 24; const a = ap || other; if (a && /pm/i.test(a) && v < 12) v += 12; if (a && /am/i.test(a) && v === 12) v = 0; return v; }; when.from = `${pad(h(w[1], w[3], ''))}:00`; when.to = `${pad(h(w[4], w[6], w[3] && !w[6] && +w[4] < +w[1] ? 'pm' : ''))}:00`; if (!w[3] && !w[6] && +w[4] < +w[1]) when.to = `${pad(+w[4] + 12)}:00`; }
      if (take(/\b(?:on\s+)?(?:weekdays|working days|mon(?:day)?\s*(?:-|to)\s*fri(?:day)?)\b/i)) when.days = [1, 2, 3, 4, 5];
      const mm = take(/\bat\s+:?(\d{2})\s*(?:past)?\b/i); if (mm && +mm[1] < 60) when.minute = +mm[1];
    }
  }
  if (!when) {
    let days = null; let daily = false;
    if (take(/\b(?:every\s+|on\s+)?(?:weekdays?|working days|week\s*days|mon(?:day)?\s*(?:-|to|through)\s*fri(?:day)?)\b/i)) days = 'weekdays';
    else if (take(/\b(?:every\s+|on\s+)?weekends?\b/i)) days = [0, 6];
    else {
      const re = new RegExp(`\\b(?:every\\s+|on\\s+|each\\s+)?${DAY_RE}(?:\\s*(?:,|and|&|\\+)\\s*${DAY_RE})*\\b`, 'i');
      const dm = s.match(re);
      if (dm) { const found = [...dm[0].matchAll(new RegExp(DAY_RE, 'ig'))].map(x => dayNum(x[1])).filter(x => x !== undefined); if (found.length) { days = [...new Set(found)].sort(); s = cut(s, dm[0]); } }
    }
    if (!days && take(/\b(?:daily|every\s*day|each\s*day|every\s+(?=morning|afternoon|evening|night))\b/i)) daily = true;
    const weeklyNoDay = !days && !daily && /\b(weekly|every week|once a week)\b/i.test(s);
    if (weeklyNoDay) { s = s.replace(/\b(weekly|every week|once a week)\b/i, ' '); ask = 'day'; }
    if (days || daily) {
      let t = findTime(s);
      if (t && !/am\b/i.test(t.match) && !/^(afternoon|evening|night|tonight)/i.test(t.match.replace(/^(at|in the|every|each)\s+/i, ''))) {
        // "every evening at 9" is 21:00; "every night at 11" is 23:00 but "every night at 2" stays 02:00
        const h = +t.at.slice(0, 2); const late = /\b(afternoon|evening)\b/i.test(s) ? h >= 1 && h < 12 : /\b(night|tonight)\b/i.test(s) ? h >= 6 && h < 12 : false;
        if (late) t = { ...t, at: `${pad(h + 12)}${t.at.slice(2)}` };
      }
      if (!t) ask = 'time';
      else {
        s = cut(s, t.match); guess = t.guess;
        when = days === 'weekdays' ? { kind: 'weekdays', at: t.at } : Array.isArray(days) ? { kind: 'weekly', at: t.at, days } : { kind: 'daily', at: t.at };
        if (Array.isArray(days) && days.length === 7) when = { kind: 'daily', at: t.at };
        if (Array.isArray(days) && days.join() === '1,2,3,4,5') when = { kind: 'weekdays', at: t.at };
      }
    }
  }
  return { when, guess, ask };
}

/** Does this sentence talk about a repeating schedule at all? (so a plain job is never read as a routine) */
export const hasRecurrence = s => /\b(every|each|daily|hourly|weekly|weekdays?|weekends?|working days|mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays)\b/i.test(String(s || ''));

/* ---------- one-off moments ---------- */
/**
 * A one-off moment at the start of a message, then the task: "tomorrow 9am: …", "fri 10:30 - …",
 * "14 oct at 8: …", "14/10 17:00, …", "today 16:00: …", "in 2 hours: …". Returns { at, task, said, guess } or null.
 */
export function parseAt(text, { now = Date.now(), tz = 'Europe/London' } = {}) {
  const s = String(text || '').trim();
  const rel = s.match(/^in\s+(\d{1,3})\s*(min|mins|minutes|hour|hours|hr|hrs)\s*[:,\-–]\s*(.+)$/is);
  if (rel) { const n = +rel[1]; const hours = /^h/i.test(rel[2]); return { at: now + n * (hours ? 3600000 : 60000), task: rel[3].trim(), said: `in ${n} ${hours ? 'hours' : 'minutes'}`, guess: false }; }
  // groups: 1 day phrase · 2,3 weekday names · 4,5 "14 oct" · 6,7,8 "14/10/26" · 9 time · 10 task
  const head = s.match(new RegExp(`^(today|tonight|tomorrow|${DAY_RE}|next\\s+${DAY_RE}|(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS.join('|')})[a-z]*|(\\d{1,2})/(\\d{1,2})(?:/(\\d{2,4}))?)\\s+(?:at\\s+)?(.{1,14}?)\\s*[:,\\-–]\\s+(.+)$`, 'is'));
  if (!head) return null;
  const dayWord = head[1].toLowerCase(); const timeText = head[9].trim(); const task = head[10].trim();
  if (!/^(\d{1,2}([:.]\d{2})?\s*(am|pm)?|noon|midday|lunchtime|midnight|morning|afternoon|evening|night)$/i.test(timeText)) return null;
  let t = /^\d{1,2}$/.test(timeText) ? { at: `${pad(Math.min(23, +timeText))}:00`, guess: +timeText <= 12 } : findTime(` at ${timeText} `);
  if (t && dayWord === 'tonight' && !/am\b/i.test(timeText)) { const h = +t.at.slice(0, 2); if (h >= 6 && h < 12) t = { at: `${pad(h + 12)}${t.at.slice(2)}`, guess: t.guess }; } // "tonight 8" is 20:00
  if (!t) return null;
  const today = localDate(now, tz); let date = null;
  if (dayWord === 'today' || dayWord === 'tonight') date = today;
  else if (dayWord === 'tomorrow') date = addDays(today, 1);
  else if (head[6]) { let y = head[8] ? +head[8] : today.y; if (y < 100) y += 2000; date = { y, m: +head[7], d: +head[6] }; if (!head[8] && zonedTime(date.y, date.m, date.d, 23, 59, tz) < now) date.y += 1; }
  else if (head[4]) { date = { y: today.y, m: MONTHS.indexOf(head[5].toLowerCase().slice(0, 3)) + 1, d: +head[4] }; if (zonedTime(date.y, date.m, date.d, 23, 59, tz) < now) date.y += 1; }
  else { const next = /^next\s+/.test(dayWord); const wd = dayNum(dayWord.replace(/^next\s+/, '')); if (wd === undefined) return null; let n = (wd - today.wd + 7) % 7; if (next && n === 0) n = 7; date = addDays(today, n); }
  if (!date.m || date.m > 12 || !date.d || date.d > 31) return null;
  const [hh, mi] = t.at.split(':').map(Number);
  let at = zonedTime(date.y, date.m, date.d, hh, mi, tz);
  if (at < now && dayNum(dayWord.replace(/^next\s+/, '')) !== undefined && !/^(today|tonight|tomorrow)$/.test(dayWord)) { const d7 = addDays(date, 7); at = zonedTime(d7.y, d7.m, d7.d, hh, mi, tz); } // "fri 9am" said on a Friday afternoon means next Friday
  return { at, task, said: `${head[1]} ${t.at}`, guess: t.guess };
}

/** "Tue 14 Oct 09:30" in the office's zone. */
export function fmtAt(ts, tz = 'Europe/London') {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ts)).replace(',', '');
}
