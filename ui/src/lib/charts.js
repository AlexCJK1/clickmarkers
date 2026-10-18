// The chart rules, as pure functions (no DOM), so they can be tested with node:test and every chart on
// the page follows them the same way:
// - a window is drawn as fixed slots (14 days is 14 slots, whatever the data holds);
// - days before tracking began are "not tracked yet", never zero;
// - under 4 tracked points there is no chart: the figures are shown instead;
// - all zeros is a sentence, not a chart;
// - today is partial ("so far") and drawn outlined;
// - two or three ticks, the top one just above the maximum.

const DAY = 86400000;

/** An ISO day (YYYY-MM-DD) in local time. */
export function isoDay(ts) { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WKD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const parse = iso => { const [y, m, d] = String(iso).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
/** "8 Oct". */
export function shortDate(iso) { const d = parse(iso); return `${d.getDate()} ${MON[d.getMonth()]}`; }
/** "Sun 11 Oct". */
export function dayLabel(iso) { const d = parse(iso); return `${WKD[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`; }

/**
 * Fixed day slots ending on `today` (an ISO day). `series` is a list of { date, value } or two arrays
 * (dates, values). A day missing from the series, or before `since`, is not tracked (value null).
 */
export function daySlots(dates, values, { n = 14, today, since } = {}) {
  const map = new Map(); dates.forEach((d, i) => map.set(d, +values[i] || 0));
  const end = parse(today || dates[dates.length - 1] || isoDay(Date.now()));
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const day = isoDay(end.getTime() - i * DAY + 12 * 3600000); // noon, so a clock change never skips a day
    const tracked = map.has(day) && (!since || day >= since);
    out.push({ date: day, value: tracked ? map.get(day) : null });
  }
  return out;
}

/**
 * Where tracking began in a zero-padded series: the first day with a value above zero, or `since` when
 * it is known. Days before it are not tracked (they were never counted), the days after keep their zeros.
 */
export function trackedFrom(values, { dates, since } = {}) {
  if (since && dates) { const i = dates.findIndex(d => d >= since); return i < 0 ? values.length : i; }
  const i = values.findIndex(v => +v > 0); return i < 0 ? values.length : i;
}
/** Turn leading untracked days into nulls. */
export function markUntracked(values, from) { return values.map((v, i) => (i < from ? null : +v || 0)); }

/** How a series should be shown: 'none' (nothing tracked), 'zero' (all tracked days are 0),
 *  'figures' (under 4 tracked points: say the numbers), or 'columns'. */
export function chartForm(values) {
  const tracked = values.filter(v => v !== null && v !== undefined);
  if (!tracked.length) return 'none';
  if (tracked.every(v => +v === 0)) return 'zero';
  if (tracked.length < 4) return 'figures';
  return 'columns';
}

function ticksFor(max, n) {
  const raw = max / n; const mag = 10 ** Math.floor(Math.log10(raw)); const f = raw / mag;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 3 && mag >= 1 ? 3 : f <= 5 ? 5 : 10) * mag;
  const top = Math.ceil(max / step - 1e-9) * step; const out = [];
  for (let v = 0; v <= top + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}
/** Two or three steps from 0, whichever puts the top tick closest above the maximum. */
export function niceTicks(max, n) {
  if (!(max > 0)) return [0, 1];
  if (n) return ticksFor(max, n);
  const a = ticksFor(max, 2), b = ticksFor(max, 3);
  return a[a.length - 1] <= b[b.length - 1] ? a : b;
}

/**
 * The geometry of a fixed-slot column chart. values: numbers, or null for "not tracked yet".
 * Returns slots (x, bar rect, kind), the plot box, ticks with their y, which slots carry a direct label,
 * the untracked band, and the date labels (first, middle, last).
 */
export function columnLayout({ w, h, values, partialLast = true, maxBar = 16, top = partialLast ? 38 : 26, bottom = 24, tickW = 34, left = 2 }) {
  const n = values.length; const L = left, R = tickW, T = top, B = bottom;
  const pw = Math.max(1, w - L - R), ph = Math.max(1, h - T - B); const slot = pw / Math.max(1, n); const bw = Math.min(maxBar, slot * 0.64);
  const tracked = values.map(v => v !== null && v !== undefined);
  const maxV = Math.max(0, ...values.filter((v, i) => tracked[i]).map(Number));
  const ticks = niceTicks(maxV || 1); const topV = ticks[ticks.length - 1];
  const y = v => T + ph - (v / topV) * ph;
  const slots = values.map((v, i) => {
    const cx = L + slot * i + slot / 2;
    if (!tracked[i]) return { i, cx, kind: 'untracked', value: null };
    const last = i === n - 1 && partialLast; const value = +v;
    if (value <= 0) return { i, cx, kind: 'zero', value: 0, x: cx - bw / 2, y: T + ph - 2, w: bw, h: 2 };
    const bh = Math.max(2, (value / topV) * ph);
    return { i, cx, kind: last ? 'today' : 'day', value, x: cx - bw / 2, y: T + ph - bh, w: bw, h: bh };
  });
  const first = tracked.indexOf(true); const untracked = first > 0 ? { x0: L + 1, x1: L + slot * first - 2, from: 0, to: first - 1 } : first < 0 ? { x0: L + 1, x1: L + pw - 1, from: 0, to: n - 1 } : null;
  const tv = values.map((v, i) => (tracked[i] ? +v : -Infinity)); const maxI = first < 0 ? -1 : tv.indexOf(Math.max(...tv));
  const labelled = []; if (first >= 0) { if (maxI !== n - 1 && maxV > 0) labelled.push(maxI); if (tracked[n - 1]) labelled.push(n - 1); }
  const mid = Math.floor((n - 1) / 2);
  return {
    plot: { x: L, y: T, w: pw, h: ph, base: T + ph }, slot, barW: bw, slots, untracked, labelled, maxIndex: maxI,
    ticks: ticks.map(v => ({ v, y: y(v) })), dateIdx: [0, mid, n - 1].filter((v, i, a) => a.indexOf(v) === i), trackedStart: first,
  };
}

/** The spark: the same slots, smaller, no axis. */
export function sparkLayout({ w, h, values, maxBar = 8 }) {
  const n = values.length; const slot = w / Math.max(1, n); const bw = Math.min(maxBar, slot * 0.62);
  const tracked = values.map(v => v !== null && v !== undefined); const max = Math.max(1e-9, ...values.filter((v, i) => tracked[i]).map(Number));
  const first = tracked.indexOf(true); const H = h - 2;
  return {
    slot, untrackedW: first > 0 ? slot * first - 2 : first < 0 ? w : 0,
    bars: values.map((v, i) => (tracked[i] ? { i, x: slot * i + (slot - bw) / 2, w: bw, h: Math.max(2, (+v / max) * (H - 2)), today: i === n - 1, zero: +v <= 0 } : null)).filter(Boolean),
  };
}

/** Sum of the last n tracked values. */
export const sumLast = (values, n) => values.slice(-n).reduce((a, v) => a + (+v || 0), 0);
