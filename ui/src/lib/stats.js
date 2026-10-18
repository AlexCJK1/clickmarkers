// The figures on the telemetry column and the numbers sheet, read out of /api/stats (the stats
// file) in one place, so every panel says the same thing and a test can hold them to it. A figure the
// file does not carry is null, never 0: a missing number must not read as "on target" or "nothing".
import { isoDay, trackedFrom } from './charts.js';
import { sentence } from './format.js';

const num = v => {
  const n = parseFloat(String(v ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const first = (...xs) => {
  for (const x of xs) if (x !== null && x !== undefined && !(typeof x === 'number' && !Number.isFinite(x))) return x;
  return null;
};
// A money field by its plain name ("spendToday"), or by the older name with "Usd" on the end, which files
// written before the currency field still use. Both hold amounts in the file's currency.
const cash = (o, name) => first(num(o?.[name]), num(o?.[`${name}Usd`]));
/** A labelled row from the stats file ("SPEND TODAY", "$4.21"), whichever department it sits under. */
export function pickRow(rows, label) {
  for (const dept of Object.values(rows || {}))
    for (const r of dept || []) {
      const [l, v] = Array.isArray(r) ? r : [r.label, r.value];
      if (String(l).toUpperCase() === label) return v;
    }
  return null;
}
export const chartOf = (stats, id) => (stats?.charts || []).find(c => c.id === id) || null;

/** The ways out of the pipeline, unless the file names its own (stats.exits). */
const EXIT_KEYS = ['not_eligible', 'lost', 'dropped'];
const humanKey = k => sentence(String(k).replace(/_/g, ' '));

/** Which channel a tracked link belongs to, from its tag ("fb09", "site-top", "reel4"). */
export function channelOf(tag) {
  const p =
    String(tag)
      .toLowerCase()
      .match(/^[a-z]+/)?.[0] || 'other';
  return (
    {
      fb: 'Facebook',
      facebook: 'Facebook',
      site: 'Site',
      web: 'Site',
      reel: 'Reels',
      reels: 'Reels',
      messenger: 'Messenger',
      ig: 'Instagram',
      insta: 'Instagram',
      tt: 'TikTok',
      tiktok: 'TikTok',
    }[p] || sentence(p)
  );
}

/** A day series from the file's daily rows: { dates, values }, oldest first. */
function daySeries(rows, field) {
  return { dates: (rows || []).map(r => r.date), values: (rows || []).map(r => +r[field] || 0) };
}
/** The same from a chart whose labels are "29/9": dated by counting back from the file's day. */
function chartSeries(chart, seriesName, endIso) {
  const sr = (chart?.series || []).find(s => !seriesName || seriesName.test(s.name)) || chart?.series?.[0];
  const values = (sr?.values || []).map(v => +v || 0);
  if (!values.length) return null;
  const end = new Date(`${endIso}T12:00:00`);
  const dates = values.map((_, i) => isoDay(end.getTime() - (values.length - 1 - i) * 86400000));
  return { dates, values };
}

export function deriveStats(stats, { now = Date.now() } = {}) {
  if (!stats || stats.error) return null;
  const rows = stats.rows || {};
  const inputs = stats._inputs || {};
  const fin = stats.fin || {};
  const daily = stats.daily || {};
  const today = inputs.leads?.today?.date || (stats.updatedAt ? isoDay(Date.parse(stats.updatedAt)) : isoDay(now));
  const ads = Array.isArray(stats.ads) ? stats.ads : [];
  const campaign = inputs.adsToday?.campaign || null;
  const all = inputs.adsAll?.campaign || null;

  const spendDays = daily.ads?.length
    ? daySeries(daily.ads, 'spend')
    : chartSeries(chartOf(stats, 'ads'), /spend/i, today);
  const chatDays = daily.ads?.length
    ? daySeries(daily.ads, 'chats')
    : chartSeries(chartOf(stats, 'ads'), /chat/i, today);
  const linkDays = daily.ads?.length
    ? daySeries(daily.ads, 'linkClicks')
    : chartSeries(chartOf(stats, 'ads'), /click/i, today);
  const leadDays = daily.leads?.length
    ? daySeries(daily.leads, 'leads')
    : chartSeries(chartOf(stats, 'leads'), null, today);
  const clickDays = daily.leads?.length
    ? daySeries(daily.leads, 'clicks')
    : chartSeries(chartOf(stats, 'clicks'), null, today);
  // tracking began on the first day either series counted anything; the zeros before it were never counted
  const leadTracked = (() => {
    if (!leadDays) return 0;
    const a = trackedFrom(leadDays.values),
      b = clickDays ? trackedFrom(clickDays.values) : a;
    return Math.min(a, b);
  })();
  const spendFrom = spendDays ? trackedFrom(spendDays.values) : 0;

  const spendAll = first(cash(fin, 'spendAll'), num(pickRow(rows, 'SPEND ALL TIME')), all ? num(all.spend) : null);
  const chatsAll = ads.length ? ads.reduce((a, x) => a + (+x.chats || 0), 0) : first(all ? num(all.chats) : null);
  const cpc = first(cash(stats.marketing, 'costPerChat'), num(pickRow(rows, 'COST PER CHAT')));
  const ti = spendDays ? spendDays.dates.indexOf(today) : -1;
  const yesterdayIso = isoDay(new Date(`${today}T12:00:00`).getTime() - 86400000);
  const yi = spendDays ? spendDays.dates.indexOf(yesterdayIso) : -1;

  // clicks by channel over the last 7 days, from every tracked link
  const byTag = inputs.leads?.last7d?.clicksByTag || null;
  const channels = {};
  if (byTag)
    for (const [tag, v] of Object.entries(byTag)) {
      const c = channelOf(tag);
      channels[c] ||= { name: c, clicks: 0, links: [] };
      channels[c].clicks += +v || 0;
      channels[c].links.push({ tag, clicks: +v || 0 });
    }
  const channelList = Object.values(channels).sort((a, b) => b.clicks - a.clicks);
  for (const c of channelList) c.links.sort((a, b) => b.clicks - a.clicks);

  const funnel = stats.funnel || inputs.leads?.funnel || null;
  // the stages in the order the file gives them, named by stats.stageLabels or by the key in words
  const exitKeys = Array.isArray(stats.exits) ? stats.exits : EXIT_KEYS;
  const labelOf = k => stats.stageLabels?.[k] || humanKey(k);
  const stages = funnel
    ? Object.keys(funnel)
        .filter(k => !exitKeys.includes(k))
        .map(key => ({ key, label: labelOf(key), n: +funnel[key] || 0 }))
    : [];
  const exits = funnel
    ? exitKeys.filter(k => k in funnel).map(key => ({ key, label: labelOf(key), n: +funnel[key] || 0 }))
    : [];
  // the pipeline's headline pair: stats.goal { from, to } (two stage keys), or the last two stages
  const pick = k => stages.find(x => x.key === k) || null;
  const goal =
    stages.length >= 2
      ? {
          from: pick(stats.goal?.from) || stages[stages.length - 2],
          to: pick(stats.goal?.to) || stages[stages.length - 1],
        }
      : null;
  const stuckDays = stats.sales?.stuckDays ?? inputs.leads?.stuckAfterLink?.thresholdDays ?? 2;

  return {
    updatedAt: stats.updatedAt ? Date.parse(stats.updatedAt) : null,
    // the ad account's currency; every money field holds amounts in it
    currency: /^[A-Z]{3}$/.test(String(stats.currency || '')) ? stats.currency : 'USD',
    today,
    campaign: campaign?.name || null,
    campaignSince: spendDays && spendFrom < spendDays.values.length ? spendDays.dates[spendFrom] : null,
    spendToday: first(cash(fin, 'spendToday'), num(pickRow(rows, 'SPEND TODAY'))),
    budget: first(
      cash(fin, 'dailyBudget'),
      num(pickRow(rows, 'DAILY BUDGET')),
      campaign ? cash(campaign, 'dailyBudget') : null,
    ),
    spend7: first(cash(fin, 'spend7d'), num(pickRow(rows, 'SPEND 7 DAYS'))),
    spendAll,
    adCount: ads.length || null,
    chatsAll,
    costPerChat: cpc,
    cpcTarget: first(cash(stats.marketing, 'targetCostPerChat'), 3),
    noChats: cpc === null && chatsAll === 0 && spendAll > 0,
    spendYesterday: yi >= 0 ? spendDays.values[yi] : null,
    yesterday: yesterdayIso,
    chatsToday: ti >= 0 && chatDays ? chatDays.values[ti] : null,
    linkClicksToday: campaign ? num(campaign.linkClicks) : ti >= 0 && linkDays ? linkDays.values[ti] : null,
    linkClicksAll: all ? num(all.linkClicks) : null,
    impressionsAll: all ? num(all.impressions) : null,
    byAd: [...ads]
      .map(a => ({ name: a.name, spend: +a.spend || 0, impressions: +a.impressions || 0, chats: +a.chats || 0 }))
      .sort((a, b) => b.spend - a.spend),
    spendDays,
    chatDays,
    linkDays,
    spendFrom,
    leadsToday: first(num(stats.sales?.leadsToday), num(pickRow(rows, 'LEADS TODAY'))),
    leads7: first(num(stats.sales?.leads7d), num(pickRow(rows, 'LEADS 7 DAYS'))),
    waiting: first(num(stats.sales?.waitingForOwner), num(pickRow(rows, 'WAITING ON YOU'))),
    stuck: first(num(stats.sales?.stuck), num(stats.sales?.stuckAfterLink), num(pickRow(rows, 'STUCK LEADS'))),
    stuckDays,
    posts: first(num(stats.marketing?.postsScheduled), num(pickRow(rows, 'POSTS SCHEDULED'))),
    leadDays,
    clickDays,
    leadTracked,
    leadSource:
      sentence(
        String(chartOf(stats, 'leads')?.sub || '')
          .split('·')
          .pop()
          .trim(),
      ) || null,
    channels: channelList,
    clicks7: byTag ? Object.values(byTag).reduce((a, b) => a + (+b || 0), 0) : null,
    linkCount: byTag ? Object.keys(byTag).length : null,
    stages,
    exits,
    goal,
    leadsAll: funnel ? Object.values(funnel).reduce((a, b) => a + (+b || 0), 0) : null,
    // charts the curated panels do not already draw: shown on the numbers sheet as they come
    more: (stats.charts || []).filter(c => !['ads', 'leads', 'clicks', 'adsplit', 'funnel', 'tags'].includes(c.id)),
  };
}

/** How fresh the file is and what failed: { mins, old, failed: [text], stale }. */
export function freshness(stats, now = Date.now()) {
  const at = stats?.updatedAt ? Date.parse(stats.updatedAt) : 0;
  const mins = at ? Math.round((now - at) / 60000) : null;
  const stale = stats?.stale
    ? Array.isArray(stats.stale)
      ? stats.stale.length > 0
      : typeof stats.stale === 'object'
        ? Object.keys(stats.stale).length > 0
        : true
    : false;
  const failed = Array.isArray(stats?.errors)
    ? stats.errors.map(String)
    : stats?.errors && typeof stats.errors === 'object'
      ? Object.entries(stats.errors).map(([k, v]) => `${k}: ${v}`)
      : [];
  return { at, mins, old: mins !== null && mins > 45, stale, failed };
}
