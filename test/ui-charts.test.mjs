// The page's chart rules and figures, as pure functions (ui/src/lib): fixed day slots, "not tracked yet"
// never drawn as zero, the under-4-points switch to figures, two or three ticks, the telemetry figures
// read out of the stats file, the copy formats, and the colour tokens kept in step between CSS and JS.
// No DOM, no network.
import { test } from 'node:test';
process.env.CLICKMARKERS_NO_MODELS = '1'; // no test may reach a model
process.env.CLICKMARKERS_NO_LOCAL = '1'; // nor read this machine's office.config.local.json
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  niceTicks,
  daySlots,
  trackedFrom,
  markUntracked,
  chartForm,
  columnLayout,
  sparkLayout,
  sumLast,
  shortDate,
  dayLabel,
} from '../ui/src/lib/charts.js';
import {
  usd,
  usdShort,
  money,
  moneyShort,
  currencyName,
  dur,
  ago,
  until,
  modelName,
  sentence,
  dayHeading,
  plural,
} from '../ui/src/lib/format.js';
import { deriveStats, freshness, channelOf, pickRow } from '../ui/src/lib/stats.js';
import { T, CSS_TWINS, hex, rgba } from '../ui/src/lib/tokens.js';

const UI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'ui', 'src');

test('ticks: two or three steps, the top one just above the maximum', () => {
  assert.deepEqual(niceTicks(6), [0, 3, 6]);
  assert.deepEqual(niceTicks(64), [0, 25, 50, 75]);
  assert.deepEqual(niceTicks(0), [0, 1]);
  assert.deepEqual(niceTicks(-3), [0, 1]);
  for (const max of [0.4, 1, 3.69, 7, 18, 99, 120, 1234]) {
    const t = niceTicks(max);
    const top = t[t.length - 1];
    assert.ok(t.length >= 3 && t.length <= 4, `${max}: ${t}`);
    assert.ok(top >= max && top < max * 2.01, `${max}: top ${top}`);
    assert.equal(t[0], 0);
  }
});

test('slots: a window is always n slots, and a day the series lacks is not tracked (null), not 0', () => {
  const s = daySlots(['2026-10-11', '2026-10-12'], [3.69, 1.41], { n: 14, today: '2026-10-12' });
  assert.equal(s.length, 14);
  assert.equal(s[13].date, '2026-10-12');
  assert.equal(s[13].value, 1.41);
  assert.equal(s[12].value, 3.69);
  assert.equal(s[0].date, '2026-09-29');
  assert.equal(s[0].value, null);
  assert.equal(s.filter(x => x.value === null).length, 12);
  // a day before `since` is not tracked even when the series holds a value for it
  const t = daySlots(['2026-10-10', '2026-10-11'], [0, 2], { n: 3, today: '2026-10-11', since: '2026-10-11' });
  assert.deepEqual(
    t.map(x => x.value),
    [null, null, 2],
  );
});

test('tracking begins at the first counted day; the zeros before it become "not tracked"', () => {
  const leads = [0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 3, 4, 2, 6];
  assert.equal(trackedFrom(leads), 9);
  assert.equal(trackedFrom([0, 0, 0]), 3);
  assert.equal(trackedFrom([1, 0, 2], { dates: ['a', 'b', 'c'], since: 'b' }), 1);
  const m = markUntracked(leads, 9);
  assert.equal(m.filter(v => v === null).length, 9);
  assert.equal(m[13], 6);
  // the zero after tracking began stays a zero
  assert.deepEqual(markUntracked([0, 5, 0, 2], 1), [null, 5, 0, 2]);
});

test('form: under 4 tracked points the figures are shown instead of a chart; all zeros is a sentence', () => {
  assert.equal(chartForm([null, null, 3.69, 1.41]), 'figures');
  assert.equal(chartForm([null, 1, 2, 3, 4]), 'columns');
  assert.equal(chartForm([null, 0, 0, 0, 0]), 'zero');
  assert.equal(chartForm([null, null]), 'none');
  assert.equal(chartForm([]), 'none');
});

test('column layout: bars stay inside the box, today is outlined, untracked slots have no bar, the max and today are labelled', () => {
  const values = markUntracked([0, 0, 0, 0, 0, 0, 0, 0, 0, 28, 64, 7, 50, 25], 9);
  const L = columnLayout({ w: 600, h: 236, values });
  assert.equal(L.slots.length, 14);
  for (const s of L.slots) {
    if (s.kind === 'untracked') {
      assert.equal(s.x, undefined);
      continue;
    }
    assert.ok(s.x >= L.plot.x - 0.01 && s.x + s.w <= L.plot.x + L.plot.w + 0.01, `slot ${s.i} x`);
    assert.ok(s.y >= L.plot.y - 0.01 && s.y + s.h <= L.plot.base + 0.01, `slot ${s.i} y`);
  }
  assert.equal(L.slots[13].kind, 'today');
  assert.equal(L.slots[10].kind, 'day');
  assert.equal(L.slots.filter(s => s.kind === 'untracked').length, 9);
  assert.deepEqual(L.labelled, [10, 13]);
  assert.equal(L.maxIndex, 10);
  assert.deepEqual(
    L.ticks.map(t => t.v),
    [0, 25, 50, 75],
  );
  assert.ok(L.untracked && L.untracked.x1 > L.untracked.x0);
  assert.equal(L.trackedStart, 9);
  // a zero after tracking began is a flat mark on the baseline, not a gap
  const Z = columnLayout({ w: 300, h: 120, values: [null, 2, 0, 3, 1] });
  assert.equal(Z.slots[2].kind, 'zero');
  assert.equal(Z.slots[2].h, 2);
  // nothing tracked: the whole plot is the untracked band and nothing is labelled
  const N = columnLayout({ w: 300, h: 120, values: [null, null, null] });
  assert.deepEqual(N.labelled, []);
  assert.ok(N.untracked);
});

test('spark layout and sums', () => {
  const S = sparkLayout({ w: 170, h: 30, values: markUntracked([0, 0, 0, 3, 3, 4, 2, 6], 3) });
  assert.equal(S.bars.length, 5);
  assert.ok(S.untrackedW > 0);
  assert.ok(S.bars[S.bars.length - 1].today);
  assert.ok(S.bars.every(b => b.x >= 0 && b.x + b.w <= 170 + 0.01 && b.h <= 30));
  assert.equal(sumLast([1, 2, 3, null, 4], 2), 4);
});

test('dates and formats follow the copy rules', () => {
  assert.equal(shortDate('2026-10-08'), '8 Oct');
  assert.equal(dayLabel('2026-10-11'), 'Sun 11 Oct');
  assert.equal(usd(4.2), '$4.20');
  assert.equal(usdShort(15), '$15');
  assert.equal(usdShort(4.21), '$4.21');
  const sp = x => x.replace(/\u00a0/g, ' ');
  assert.equal(sp(dur(21000)), '21 s');
  assert.equal(sp(dur(89000)), '1 min 29 s');
  assert.equal(sp(dur(1402127)), '23 min 22 s');
  assert.equal(sp(dur(120000)), '2 min');
  assert.ok(!/\d /.test(dur(1402127)), 'a number keeps its unit on the same line');
  const now = new Date(2026, 9, 12, 17, 24).getTime();
  assert.equal(ago(now - 24 * 60000, now), '24 min ago');
  assert.equal(ago(0, now), 'never');
  assert.equal(until(now + 26 * 60000, now), 'in 26 min');
  assert.equal(dayHeading(new Date(2026, 9, 11, 23, 0).getTime(), now), 'Yesterday, Sun 11 Oct');
  assert.equal(modelName('claude-opus-5-5'), 'Opus 5.5');
  assert.equal(modelName('sonnet'), 'Sonnet 5.5');
  assert.equal(sentence('NEW LEADS PER DAY'), 'New leads per day');
  assert.equal(sentence('every tracked link'), 'Every tracked link');
  assert.equal(plural(1, 'desk'), '1 desk');
  assert.equal(plural(4, 'desk'), '4 desks');
  for (const s of [dur(5e6), ago(now - 9e7, now), dayHeading(now, now)]) assert.ok(!s.includes('—'), 'no em dashes');
});

/** A stats file shaped like the stats job writes it (made-up figures, no names). */
const STATS = {
  updatedAt: '2026-10-12T16:00:02.025Z',
  rows: {
    fin: [
      ['SPEND TODAY', '$4.21'],
      ['DAILY BUDGET', '$15'],
    ],
    marketing: [
      ['COST PER CHAT', '—'],
      ['POSTS SCHEDULED', '14'],
    ],
    sales: [
      ['LEADS TODAY', '6'],
      ['WAITING ON YOU', '1'],
    ],
  },
  fin: { spendTodayUsd: 4.21, spend7dUsd: 14.11, spendAllUsd: 18.32, dailyBudgetUsd: 15 },
  sales: { leadsToday: 6, leads7d: 18, waitingForOwner: 1, stuckAfterLink: 4 },
  marketing: { postsScheduled: 14, costPerChatUsd: null },
  ads: [
    { name: 'Post A', spend: 0.75, impressions: 111, chats: 0 },
    { name: 'Post B', spend: 16.56, impressions: 2483, chats: 0 },
  ],
  funnel: { new: 1, contacted: 0, screening: 3, not_eligible: 1, link_sent: 11, applied: 0, dropped: 2 },
  daily: {
    leads: ['2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12'].map((date, i) => ({
      date,
      leads: [0, 3, 4, 2, 6][i],
      clicks: [0, 64, 7, 50, 25][i],
    })),
    ads: ['2026-10-10', '2026-10-11', '2026-10-12'].map((date, i) => ({
      date,
      spend: [0, 14.11, 4.21][i],
      chats: 0,
      linkClicks: [0, 14, 8][i],
    })),
  },
  charts: [
    { id: 'leads', sub: '14 days · Messenger bot', series: [{ name: 'leads', values: [0, 3, 4, 2, 6] }] },
    { id: 'extra', title: 'SOMETHING ELSE', series: [] },
  ],
  _inputs: {
    leads: {
      today: { date: '2026-10-12' },
      last7d: { clicksByTag: { site: 30, 'site-top': 19, fb09: 9, fb01: 8, reel4: 5, messenger: 3, 'test-post': 1 } },
      stuckAfterLink: { count: 4, thresholdDays: 2 },
    },
    adsToday: { campaign: { name: 'Test campaign', linkClicks: 8, dailyBudgetUsd: 15 } },
    adsAll: { campaign: { spend: 18.32, impressions: 2717, linkClicks: 22, chats: 0 } },
  },
};

test('telemetry figures: read from the stats file; a missing figure is null, never 0', () => {
  const now = Date.parse('2026-10-12T16:24:00Z');
  const s = deriveStats(STATS, { now });
  assert.equal(s.spendToday, 4.21);
  assert.equal(s.budget, 15);
  assert.equal(s.spend7, 14.11);
  assert.equal(s.spendAll, 18.32);
  assert.equal(s.costPerChat, null, 'a dash is no value');
  assert.equal(s.chatsAll, 0);
  assert.equal(s.noChats, true);
  assert.equal(s.spendYesterday, 14.11);
  assert.equal(s.linkClicksToday, 8);
  assert.equal(s.byAd[0].name, 'Post B', 'biggest spend first');
  assert.equal(s.leadsToday, 6);
  assert.equal(s.leads7, 18);
  assert.equal(s.waiting, 1);
  assert.equal(s.stuck, 4);
  assert.equal(s.posts, 14);
  assert.equal(s.leadTracked, 1, 'tracking began on the first counted day');
  assert.equal(s.campaignSince, '2026-10-11');
  assert.equal(s.spendFrom, 1);
  assert.equal(s.leadSource, 'Messenger bot');
  assert.deepEqual(
    s.channels.map(c => [c.name, c.clicks]),
    [
      ['Site', 49],
      ['Facebook', 17],
      ['Reels', 5],
      ['Messenger', 3],
      ['Test', 1],
    ],
  );
  assert.equal(s.clicks7, 75);
  assert.equal(s.linkCount, 7);
  assert.equal(s.stages[0].label, 'New');
  assert.ok(s.stages.find(x => x.key === 'link_sent').n === 11);
  assert.deepEqual(
    s.exits.map(x => x.label),
    ['Not eligible', 'Dropped'],
  );
  assert.equal(s.leadsAll, 18);
  assert.deepEqual(
    s.more.map(c => c.id),
    ['extra'],
  );
  // no file, or the server's "no stats file": no figures at all rather than zeros
  assert.equal(deriveStats(null), null);
  assert.equal(deriveStats({ error: 'no stats file' }), null);
  // only the rows: the figures still come through, and an absent one is null
  const r = deriveStats({ rows: STATS.rows }, { now });
  assert.equal(r.spendToday, 4.21);
  assert.equal(r.spend7, null);
  assert.equal(r.leads7, null);
  assert.equal(r.noChats, false);
  assert.equal(pickRow(STATS.rows, 'LEADS TODAY'), '6');
});

test('freshness and channels', () => {
  const now = Date.parse('2026-10-12T16:24:00Z');
  const f = freshness(STATS, now);
  assert.equal(f.mins, 24);
  assert.equal(f.old, false);
  assert.deepEqual(f.failed, []);
  assert.deepEqual(freshness({ updatedAt: '2026-10-12T10:00:00Z', errors: { meta: 'timeout' } }, now).failed, [
    'meta: timeout',
  ]);
  assert.equal(freshness({}, now).mins, null);
  assert.equal(channelOf('fb-full'), 'Facebook');
  assert.equal(channelOf('site-end'), 'Site');
  assert.equal(channelOf('reel5'), 'Reels');
  assert.equal(channelOf('qr-van'), 'Qr');
});

test('tokens: the JS mirror holds the same colours as the CSS, and components never write a colour', () => {
  const css = fs.readFileSync(path.join(UI, 'index.css'), 'utf8');
  for (const name of CSS_TWINS) {
    const kebab = name.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
    const m = css.match(new RegExp(`--nw-${kebab}:\\s*(#[0-9A-Fa-f]{6})`));
    assert.ok(m, `--nw-${kebab} is defined`);
    assert.equal(m[1].toUpperCase(), T[name].toUpperCase(), `--nw-${kebab} matches T.${name}`);
  }
  assert.equal(hex('#38CCD6'), 0x38ccd6);
  assert.equal(rgba('#FFFFFF', 0.5), 'rgba(255,255,255,0.5)');
  // the categorical palette stops at three validated slots; anything past them is the neutral grey
  assert.equal(T.cats.length, 3);
  const walk = d =>
    fs
      .readdirSync(d, { withFileTypes: true })
      .flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const dir of ['components', 'floor']) {
    for (const f of walk(path.join(UI, dir)).filter(f => /\.(jsx?|mjs)$/.test(f))) {
      const src = fs.readFileSync(f, 'utf8');
      const hits = src.match(/#[0-9A-Fa-f]{6}\b|#[0-9A-Fa-f]{3}\b(?![\w-])|rgba?\(\s*\d/g) || [];
      assert.deepEqual(hits, [], `${path.relative(UI, f)} writes a colour`);
    }
  }
});

test('the old look is gone: no walnut, no Mad Men fonts, no dead files', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(UI, '..', '..', 'package.json'), 'utf8'));
  for (const dep of ['@fontsource/bodoni-moda', '@fontsource/oswald', '@fontsource/playfair-display'])
    assert.ok(!pkg.dependencies[dep], `${dep} removed`);
  for (const dep of ['@fontsource-variable/archivo', '@fontsource-variable/inter', '@fontsource/jetbrains-mono'])
    assert.ok(pkg.dependencies[dep], `${dep} present`);
  const css = fs.readFileSync(path.join(UI, 'index.css'), 'utf8');
  assert.ok(!/bodoni|oswald|playfair|walnut|brass|cream/i.test(css), 'no walnut or Mad Men tokens');
  for (const f of ['floor/scene.js', 'components/glyphs.jsx', 'components/Room.jsx'])
    assert.ok(!fs.existsSync(path.join(UI, f)), `${f} deleted`);
});

test('office text for display: no em dashes, a capital first; capital desk prefixes and ad names read as names', async () => {
  const { plain, adName, tidyTitle, displayName } = await import('../ui/src/lib/format.js');
  assert.equal(plain('draft hash mismatch — reload the page'), 'Draft hash mismatch, reload the page');
  assert.equal(plain('a–b'), 'A-b');
  assert.equal(plain(''), '');
  assert.equal(plain(undefined), '');
  assert.equal(adName('LSC Leads · WINDOWS CLEANED BRISTOL'), 'Windows cleaned bristol');
  assert.equal(
    adName('Windows cleaned, Bristol'),
    'Windows cleaned, Bristol',
    "mixed case is the owner's own and left alone",
  );
  assert.equal(tidyTitle("NUMBERS: today's numbers in three lines"), "Numbers: today's numbers in three lines");
  assert.equal(tidyTitle('SEO WRITER: audit shopfront.uk'), 'SEO writer: audit shopfront.uk');
  assert.equal(
    tidyTitle('Caption A/B: two captions for Meta'),
    'Caption A/B: two captions for Meta',
    'not a capital prefix: untouched',
  );
  assert.equal(tidyTitle('Inbox digest: Meta notices, Cloudflare'), 'Inbox digest: Meta notices, Cloudflare');
  assert.equal(displayName('HR DESK'), 'HR desk');
});

test('a refused connector check is reported, and drafts already waiting at page load are not announced as new', () => {
  // the code as one line of single spaces, so the checks do not depend on how it is formatted
  const read = f =>
    fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f), 'utf8').replace(/\s+/g, ' ');
  const store = read('ui/src/lib/store.js');
  assert.match(
    store,
    /checkConnectors: async \(\) => \{[^\n]*if \(Array\.isArray\(r\)\) \{ set\(\{ connectors: r \}\); return r; \} return \{ error:/,
  );
  assert.match(store, /checkConnectors: async \(\) => \{[^\n]*catch \{ return \{ error:/);
  const strip = read('ui/src/components/ConnectorStrip.jsx');
  assert.match(strip, /const r = await a\.checkConnectors\(\); if \(r\?\.error\) setErr\(/);
  const app = read('ui/src/App.jsx');
  assert.match(
    app,
    /if \(!ready\) return;\s*const ids = new Set/,
    'the baseline waits for the first answer from the office',
  );
});

test('the log keys each line uniquely and the store keeps a replayed event once', () => {
  // the code as one line of single spaces, so the checks do not depend on how it is formatted
  const read = f =>
    fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f), 'utf8').replace(/\s+/g, ' ');
  const logs = read('ui/src/components/LiveLogs.jsx');
  assert.match(logs, /while \(keys\.has\(key\)\) key \+= '\+'; keys\.add\(key\);/);
  assert.match(logs, /<Fragment key=\{key\}>/);
  assert.doesNotMatch(logs, /key=\{e\.seq/);
  const store = read('ui/src/lib/store.js');
  assert.match(
    store,
    /const same = x => x\.seq === e\.seq && x\.type === e\.type && x\.at === e\.at && JSON\.stringify\(x\) === JSON\.stringify\(e\);/,
    'only a whole-event match is a replay',
  );
  assert.match(store, /!state\.wire\.slice\(-200\)\.some\(same\)/);
});

test('ad money: plain field names and the stats file currency; the old Usd names still read; US dollars when unset', () => {
  const now = Date.parse('2026-10-12T16:24:00Z');
  const plain = deriveStats(
    {
      currency: 'GBP',
      fin: { spendToday: 6.4, spend7d: 70.1, spendAll: 130.18, dailyBudget: 12 },
      marketing: { costPerChat: 4.2, targetCostPerChat: 6 },
    },
    { now },
  );
  assert.equal(plain.currency, 'GBP');
  assert.equal(plain.spendToday, 6.4);
  assert.equal(plain.spend7, 70.1);
  assert.equal(plain.spendAll, 130.18);
  assert.equal(plain.budget, 12);
  assert.equal(plain.cpcTarget, 6);
  assert.equal(deriveStats(STATS, { now }).currency, 'USD', 'no currency in the file: the page says dollars');
  assert.equal(deriveStats({ currency: 'pounds' }, { now }).currency, 'USD', 'only an ISO code is taken');
  assert.equal(money(4.2, 'GBP'), '£4.20');
  assert.equal(moneyShort(12, 'EUR'), '€12');
  assert.equal(money(3, 'SEK'), 'SEK 3.00');
  assert.equal(money(3), '$3.00');
  assert.equal(currencyName('GBP'), 'pounds sterling');
  // the panels show ad money in the file's currency, and the ledger stays in dollars (the API bills in dollars)
  const numbers = fs.readFileSync(path.join(UI, 'components', 'Numbers.jsx'), 'utf8');
  const tele = fs.readFileSync(path.join(UI, 'components', 'Telemetry.jsx'), 'utf8');
  for (const src of [numbers, tele]) assert.doesNotMatch(src, /\busd\(|usdShort\(/);
  assert.doesNotMatch(numbers, /as Meta bills it/);
});
