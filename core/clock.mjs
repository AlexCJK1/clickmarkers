// Time in the office's own zone (Europe/London by default): day keys for the ledger, HH:MM for
// routines, and the "is this routine due" rule.
const fmtCache = new Map();
function parts(ts, tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hour12: false,
    });
    fmtCache.set(tz, f);
  }
  const o = {};
  for (const p of f.formatToParts(new Date(ts))) o[p.type] = p.value;
  return o;
}
const DAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function dayKey(ts = Date.now(), tz = 'Europe/London') {
  const p = parts(ts, tz);
  return `${p.year}-${p.month}-${p.day}`;
}
export function hhmm(ts = Date.now(), tz = 'Europe/London') {
  const p = parts(ts, tz);
  return `${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
}
export function weekday(ts = Date.now(), tz = 'Europe/London') {
  return DAYS[parts(ts, tz).weekday] ?? 0;
}
export function stamp(ts = Date.now(), tz = 'Europe/London') {
  const p = parts(ts, tz);
  return `${p.weekday} ${p.day}/${p.month}/${p.year} ${hhmm(ts, tz)}`;
}

/**
 * when: { kind: 'daily', at: 'HH:MM' } | { kind: 'weekly', at, days: [0..6] } | { kind: 'weekdays', at }
 *     | { kind: 'hourly', minute? } | { kind: 'every', minutes }
 * Due when the slot has passed today and it has not fired in this slot yet (lastKey is the slot key of the last firing).
 * Returns the slot key when due, else null.
 */
export function dueSlot(when, { now = Date.now(), tz = 'Europe/London', lastKey = '' } = {}) {
  if (!when || !when.kind) return null;
  const day = dayKey(now, tz),
    time = hhmm(now, tz),
    wd = weekday(now, tz);
  if (when.kind === 'daily' || when.kind === 'weekly' || when.kind === 'weekdays') {
    if (when.kind === 'weekly' && !(when.days || []).includes(wd)) return null;
    if (when.kind === 'weekdays' && (wd === 0 || wd === 6)) return null;
    if (time < String(when.at || '00:00')) return null;
    const key = `${day} ${when.at}`;
    return key === lastKey ? null : key;
  }
  if (when.kind === 'hourly') {
    const [h, m] = time.split(':');
    const minute = String(when.minute ?? 0).padStart(2, '0');
    if (!hourOn(when, +h, wd)) return null;
    if (m < minute) return null;
    const key = `${day} ${h}:${minute}`;
    return key === lastKey ? null : key;
  }
  if (when.kind === 'every') {
    const step = Math.max(1, +when.minutes || 60) * 60000;
    const slot = Math.floor(now / step) * step;
    const key = `every ${slot}`;
    return key === lastKey ? null : key;
  }
  return null;
}

/** Is an hourly routine on in this hour of this weekday (its step, window and days)? */
function hourOn(when, h, wd) {
  if (when.days && !when.days.includes(wd)) return false;
  const from = when.from ? +String(when.from).slice(0, 2) : 0,
    to = when.to ? +String(when.to).slice(0, 2) : 23;
  if (h < from || h > to) return false;
  if (when.step > 1 && (h - from) % when.step !== 0) return false;
  return true;
}

export function describeWhen(when) {
  if (!when) return '';
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  if (when.kind === 'daily') return `daily ${when.at}`;
  if (when.kind === 'weekdays') return `weekdays ${when.at}`;
  if (when.kind === 'weekly')
    return `${[...(when.days || [])]
      .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
      .map(d => names[d])
      .join('/')} ${when.at}`;
  if (when.kind === 'hourly')
    return `${when.step > 1 ? `every ${when.step} hours` : 'hourly'} at :${String(when.minute ?? 0).padStart(2, '0')}${when.from ? ` ${when.from}-${when.to}` : ''}${when.days ? (when.days.join() === '1,2,3,4,5' ? ' weekdays' : ' ' + when.days.map(d => names[d]).join('/')) : ''}`;
  if (when.kind === 'every') return `every ${when.minutes} min`;
  return when.kind;
}

/* ---------- wall-clock arithmetic in the office's zone ---------- */
const zCache = new Map();
function zparts(ts, tz) {
  let f = zCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    zCache.set(tz, f);
  }
  const o = {};
  for (const p of f.formatToParts(new Date(ts))) o[p.type] = +p.value;
  if (o.hour === 24) o.hour = 0;
  return o;
}
/** The instant when the wall clock in tz reads y-m-d hh:mm. */
export function zonedTime(y, mo, d, hh, mm, tz = 'Europe/London') {
  const want = Date.UTC(y, mo - 1, d, hh, mm);
  let t = want;
  for (let i = 0; i < 3; i++) {
    const p = zparts(t, tz);
    const seen = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    t += want - seen;
  }
  return t;
}
/** The wall-clock date in tz for an instant: { y, m, d, wd }. */
export function localDate(ts, tz = 'Europe/London') {
  const p = zparts(ts, tz);
  return { y: p.year, m: p.month, d: p.day, wd: new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() };
}
/** Add whole days to a local date (calendar arithmetic, not 24 h steps). */
export function addDays({ y, m, d }, n) {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), wd: t.getUTCDay() };
}

/**
 * Every time a routine fires between two instants (for the calendar and "next run"). Minute
 * cadences return nothing when the window is wider than a day (they would bury the calendar).
 */
export function slotsBetween(when, fromMs, toMs, tz = 'Europe/London', { max = 500 } = {}) {
  if (!when?.kind) return [];
  const out = [];
  if (when.kind === 'every') {
    if (toMs - fromMs > 86400000) return [];
    const step = Math.max(1, +when.minutes || 60) * 60000;
    for (let t = Math.ceil(fromMs / step) * step; t <= toMs && out.length < max; t += step) out.push(t);
    return out;
  }
  let d = localDate(fromMs, tz);
  const last = localDate(toMs, tz);
  for (let i = 0; i < 400 && out.length < max; i++) {
    const hm = h => [h, when.minute ?? 0];
    const times =
      when.kind === 'hourly'
        ? Array.from({ length: 24 }, (_, h) => h)
            .filter(h => hourOn(when, h, d.wd))
            .map(hm)
        : (when.kind === 'weekly' && !(when.days || []).includes(d.wd)) ||
            (when.kind === 'weekdays' && (d.wd === 0 || d.wd === 6))
          ? []
          : [
              String(when.at || '00:00')
                .split(':')
                .map(Number),
            ];
    for (const [hh, mm] of times) {
      const t = zonedTime(d.y, d.m, d.d, hh, mm, tz);
      if (t >= fromMs && t <= toMs) out.push(t);
    }
    if (d.y === last.y && d.m === last.m && d.d === last.d) break;
    d = addDays(d, 1);
  }
  return out;
}
/** The next time a routine fires after now (within 8 days), or 0. */
export function nextRun(when, now = Date.now(), tz = 'Europe/London') {
  if (when?.kind === 'every') {
    const step = Math.max(1, +when.minutes || 60) * 60000;
    return Math.floor(now / step) * step + step;
  }
  return slotsBetween(when, now + 1, now + 8 * 86400000, tz, { max: 1 })[0] || 0;
}

/** Why a schedule is not usable, or '' when it is. */
export function invalidWhen(w) {
  const hm = x => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(x || ''));
  const days = d => Array.isArray(d) && d.length > 0 && d.every(x => Number.isInteger(x) && x >= 0 && x <= 6);
  if (!w || typeof w !== 'object') return 'the schedule is missing';
  if (w.kind === 'daily' || w.kind === 'weekdays') return hm(w.at) ? '' : 'the time must be HH:MM';
  if (w.kind === 'weekly')
    return !hm(w.at) ? 'the time must be HH:MM' : !days(w.days) ? 'the days must be numbers 0 (Sunday) to 6' : '';
  if (w.kind === 'hourly') {
    if (w.minute !== undefined && !(Number.isInteger(w.minute) && w.minute >= 0 && w.minute < 60))
      return 'the minute must be 0 to 59';
    if (w.step !== undefined && !(Number.isInteger(w.step) && w.step >= 1 && w.step <= 12))
      return 'the step must be 1 to 12 hours';
    if ((w.from !== undefined && !hm(w.from)) || (w.to !== undefined && !hm(w.to)))
      return 'the window must be HH:MM to HH:MM';
    if (w.days !== undefined && !days(w.days)) return 'the days must be numbers 0 (Sunday) to 6';
    return '';
  }
  if (w.kind === 'every')
    return Number.isInteger(w.minutes) && w.minutes >= 5 && w.minutes <= 1440
      ? ''
      : 'every N minutes must be 5 to 1440';
  return `unknown schedule kind ${w.kind}`;
}
