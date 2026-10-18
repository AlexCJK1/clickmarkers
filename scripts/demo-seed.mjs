// The demo office: a made-up business (Larkspur Cleaning Co.) with made-up work and numbers, so anyone can
// open the page and click round it before setting anything up. `clickmarkers demo` calls seedDemo() on a fresh
// .demo folder and serves it with the office paused and no model reachable: nothing runs, nothing is sent.
// Every figure here is invented. Times are relative to now, so the demo always looks current.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../core/config.mjs';
import { dayKey, zonedTime } from '../core/clock.mjs';
import { draftHash } from '../company/tickets.mjs';

const HOUR = 3600000,
  DAY = 24 * HOUR;
// a small seeded random, so the demo looks the same from one run to the next
function rng(seed = 7) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}
const iso = t => new Date(t).toISOString().slice(0, 10);
const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

/** Build a demo office in `dir` (removed first). Returns the paths the server needs. */
export function seedDemo(dir, { now = Date.now(), tz = 'Europe/London' } = {}) {
  fs.rmSync(dir, { recursive: true, force: true });
  const brain = path.join(dir, 'brain'),
    data = path.join(dir, 'data'),
    company = path.join(dir, 'company');
  fs.mkdirSync(data, { recursive: true });
  fs.mkdirSync(company, { recursive: true });
  fs.cpSync(path.join(ROOT, 'examples', 'brain'), brain, { recursive: true });
  for (const f of ['company.json', 'routines.json', 'workflows.json'])
    fs.copyFileSync(path.join(ROOT, 'templates', 'agency', f), path.join(company, f));
  const r = rng();

  // ---- the stats file (what the owner's script or desk would write) ----
  const days = Array.from({ length: 14 }, (_, i) => now - (13 - i) * DAY);
  const adsDaily = days.map((t, i) => {
    const spend = i < 2 ? 0 : round(8 + r() * 4);
    const reach = Math.round(spend * (95 + r() * 30));
    return {
      date: iso(t),
      spend,
      impressions: Math.round(reach * 1.3),
      reach,
      linkClicks: Math.round(spend * (1.8 + r())),
      chats: i < 2 ? 0 : Math.round(spend / (3.2 + r() * 2.5)),
    };
  });
  adsDaily[13].spend = 6.4;
  adsDaily[13].chats = 2;
  adsDaily[13].linkClicks = 14; // today so far, as the ad account reports it (adsToday below)
  // the last three full days, which the ad pacing draft breaks down by ad
  for (const [i, spend, chats] of [
    [10, 11.2, 3],
    [11, 10.8, 3],
    [12, 11.4, 3],
  ])
    Object.assign(adsDaily[i], { spend, chats, linkClicks: Math.round(spend * 2.2) });
  const leadsDaily = days.map((t, i) => ({
    date: iso(t),
    leads: i < 2 ? 0 : Math.round(1 + r() * 4),
    clicks: i < 2 ? 0 : Math.round(9 + r() * 14),
  }));
  leadsDaily[13].leads = 3;
  const sum = (a, k, from = 0) => round(a.slice(from).reduce((s, x) => s + x[k], 0));
  // Split a total by shares, the last part taking what rounding leaves, so the parts always add up.
  const split = (total, shares, d = 0) => {
    const parts = shares.slice(0, -1).map(x => round(total * x, d));
    return [...parts, round(total - parts.reduce((a, b) => a + b, 0), d)];
  };
  // Every total on the page comes from the same daily figures, so no two panels disagree.
  const spendAll = sum(adsDaily, 'spend'),
    chatsAll = sum(adsDaily, 'chats');
  const adSpend = split(spendAll, [0.33, 0.27, 0.2, 0.2], 2),
    adChats = split(chatsAll, [0.42, 0.32, 0.2, 0.06]),
    adImpr = split(sum(adsDaily, 'impressions'), [0.34, 0.28, 0.19, 0.19]);
  const ads = [
    'Reel · before and after',
    'Post · spring windows from £15',
    'Post · end of tenancy cleans',
    'Post · gutter clear',
  ].map((name, i) => ({ id: `ad${i + 1}`, name, spend: adSpend[i], impressions: adImpr[i], chats: adChats[i] }));
  // the pipeline holds every lead of the fortnight: today's are new, the rest have moved on
  const leadsAll = sum(leadsDaily, 'leads');
  const [contacted, quoted, booked, regular, lost] = split(leadsAll - 3, [0.17, 0.22, 0.3, 0.19, 0.12]);
  const tags = ['site-top', 'site', 'fb14', 'fb15', 'fb16', 'fb17', 'reel3', 'reel4', 'messenger'];
  const tagClicks = split(sum(leadsDaily, 'clicks', 7), [0.31, 0.17, 0.13, 0.07, 0.1, 0.05, 0.08, 0.06, 0.03]);
  const costPerChat = round(spendAll / chatsAll);
  // the last 7 full days: today is still running, so it is not in the week's figures
  const week = adsDaily.slice(6, 13);
  const spend7 = sum(week, 'spend'),
    chats7 = sum(week, 'chats');
  const stats = {
    updatedAt: new Date(now - 6 * 60000).toISOString(),
    currency: 'GBP',
    marketing: { postsScheduled: 7, costPerChat, targetCostPerChat: 6 },
    sales: { leadsToday: 3, leads7d: sum(leadsDaily, 'leads', 7), waitingForOwner: 2, stuck: 3, stuckDays: 2 },
    fin: { spendToday: 6.4, spend7d: spend7, spendAll, dailyBudget: 12 },
    ads: ads.map(a => ({ ...a, effective_status: 'ACTIVE', costPerChat: a.chats ? round(a.spend / a.chats) : null })),
    funnel: { new: 3, contacted, quoted, booked, regular, lost },
    stageLabels: {
      new: 'New',
      contacted: 'Contacted',
      quoted: 'Quoted',
      booked: 'Booked',
      regular: 'Regular customer',
      lost: 'Lost',
    },
    goal: { from: 'quoted', to: 'booked' },
    daily: { ads: adsDaily, leads: leadsDaily },
    charts: [
      { id: 'leads', dept: 'sales', title: 'New leads per day', sub: 'Messenger', kind: 'bar', labels: [], series: [] },
    ],
    _inputs: {
      leads: {
        today: { date: iso(now) },
        last7d: { clicksByTag: Object.fromEntries(tags.map((t, i) => [t, tagClicks[i]])) },
      },
      adsToday: {
        campaign: { name: 'Bristol windows, autumn', dailyBudget: 12, spend: 6.4, linkClicks: 14, chats: 2 },
      },
      adsAll: {
        campaign: {
          name: 'Bristol windows, autumn',
          spend: spendAll,
          chats: chatsAll,
          linkClicks: sum(adsDaily, 'linkClicks'),
          impressions: sum(adsDaily, 'impressions'),
        },
      },
    },
  };
  fs.writeFileSync(path.join(brain, '00-Meta', 'stats.json'), JSON.stringify(stats, null, 1));
  fs.appendFileSync(
    path.join(brain, '00-Meta', 'numbers-ledger.md'),
    `\n- ${iso(now)}: ad spend yesterday £${adsDaily[12].spend}, this week £${spend7}; ${stats.sales.leads7d} leads this week; cost per enquiry £${costPerChat}\n`,
  );

  // ---- tickets ----
  let n = 0;
  const id = () => `demo${String(++n).padStart(3, '0')}`;
  const base = {
    parent: null,
    children: [],
    comments: [],
    calls: [],
    reads: [],
    after: [],
    note: '',
    error: '',
    draft: '',
    result: '',
    lane: 'api',
    engine: 'agent',
    effort: '',
    at: 0,
    routine: '',
    workflow: '',
    thread: '',
    priority: 0,
    eval: null,
    evalRounds: 0,
    evalProblems: [],
    evalDraft: '',
    runId: '',
    checking: false,
    pendingDraft: '',
    pendingFixed: [],
    needsOk: false,
    phase: 'draft',
    estUsd: 0,
  };
  const T = o => {
    const t = { ...base, id: id(), dept: '', by: 'routine', model: 'claude-sonnet-5-5', costUsd: 0, timings: {}, ...o };
    t.title ||= t.text.split('\n')[0].slice(0, 90);
    t.thread ||= t.id;
    t.estUsd ||= t.costUsd;
    return t;
  };
  const at = h => now - h * HOUR;
  // Hours ago of the last time a routine's slot came round (today's, or the last matching day), plus the few
  // minutes the run took, so the board and the calendar show each routine running at its own time.
  const slotAgo = (hm, days = null, tookMin = 3) => {
    const [h, m] = hm.split(':').map(Number);
    for (let back = 0; back < 8; back++) {
      const d = new Date(now - back * DAY);
      const ymd = dayKey(d.getTime(), tz).split('-').map(Number);
      const t = zonedTime(ymd[0], ymd[1], ymd[2], h, m, tz) + tookMin * 60000;
      const dow = new Date(Date.UTC(ymd[0], ymd[1] - 1, ymd[2])).getUTCDay();
      if (t < now - 60000 && (!days || days.includes(dow))) return (now - t) / HOUR;
    }
    return 24;
  };
  const done = (agent, dept, text, result, hAgo, o = {}) =>
    T({
      agent,
      dept,
      text,
      result,
      state: 'done',
      costUsd: o.cost ?? round(0.02 + r() * 0.2, 3),
      model: o.model || 'claude-sonnet-5-5',
      reads: o.reads || [],
      calls: o.calls || [],
      createdAt: at(hAgo + 0.05),
      updatedAt: at(hAgo),
      timings: { totalMs: Math.round(20000 + r() * 70000) },
      routine: o.routine || '',
      by: o.by || 'routine',
      ...o.extra,
    });
  const quoteReply =
    'Reply to Jo Bright, who asked what a window clean costs for a 3-bed semi in Horfield.\n\nHi Jo, thanks for getting in touch. Outside windows on a 3-bed semi are from £20, and inside and out from £35; the final price depends on how many windows there are and how easy they are to reach. Could you send me the address, so I can check which round you are on?\n\nAFTER YOUR OK\n1. mail_send(to: "jo.bright@example.com", subject: "Re: Window cleaning quote", body: the reply above)';
  const adDraft =
    'The gutter clear ad has spent £6.50 in the last three days without one enquiry. The other three ads are under the £6 target.\n\nLast 3 days, per ad:\n- Reel · before and after: £11.30, 4 enquiries, £2.83 each\n- Post · spring windows: £9.20, 3 enquiries, £3.07 each\n- Post · end of tenancy: £6.40, 2 enquiries, £3.20 each\n- Post · gutter clear: £6.50, no enquiries\n\nAFTER YOUR OK\n1. ads_update_entity(id: "ad4", status: "PAUSED"): pause "Post · gutter clear". The daily budget stays at £12 and moves to the other three.';
  const tickets = [
    T({
      agent: 'piper',
      dept: 'sales',
      text: 'Reply to the quote request from Jo Bright (3-bed semi, Horfield)',
      state: 'waiting',
      needsOk: true,
      draft: quoteReply,
      draftHash: draftHash(quoteReply),
      costUsd: 0.094,
      model: 'claude-opus-5-5',
      engine: 'batch',
      note: 'queued for the batch (half price; usually back within the hour, at most 24 hours)',
      by: 'inbox lead',
      createdAt: at(slotAgo('09:00', null, 3)),
      updatedAt: at(slotAgo('09:00', null, 26)),
      reads: ['20-Brand/voice.md', '10-Business/price-list.md', '10-Business/facts.md'],
      timings: { totalMs: 1402000 },
      eval: {
        verdict: 'pass',
        why: 'Both prices are from the price list, no slot is promised, and the send is the one step under AFTER YOUR OK.',
        rounds: 1,
        problems: [],
        autofixed: [],
        notes: [],
        at: at(slotAgo('09:00', null, 26)),
      },
      evalRounds: 1,
    }),
    T({
      agent: 'invo',
      dept: 'fin',
      text: 'Morning ad pacing: per ad, and the change to propose if one is due',
      state: 'waiting',
      needsOk: true,
      draft: adDraft,
      draftHash: draftHash(adDraft),
      costUsd: 0.21,
      model: 'claude-opus-5-5',
      routine: 'ad-pacing',
      createdAt: at(slotAgo('08:00', null, 0)),
      updatedAt: at(slotAgo('08:00', null, 1)),
      reads: ['40-Marketing/ads-campaign.md'],
      calls: [{ server: 'meta-ads-remote', tool: 'ads_get_ad_entities' }],
      timings: { totalMs: 64000 },
      eval: {
        verdict: 'pass',
        why: 'The figures match the ads report the desk read; the pause is under AFTER YOUR OK.',
        rounds: 1,
        problems: [],
        autofixed: [],
        notes: [],
        at: at(slotAgo('08:00', null, 1)),
      },
      evalRounds: 1,
    }),
    T({
      agent: 'mlead',
      dept: 'marketing',
      text: "Plan next week's posts: captions, visuals, slots, ready to schedule",
      state: 'next',
      by: 'owner',
      createdAt: at(0.4),
      updatedAt: at(0.4),
      lane: '',
      engine: '',
    }),
    T({
      agent: 'ilm',
      dept: 'sales',
      text: 'Chase the stuck quotes: who to call first and what to say',
      state: 'scheduled',
      by: 'owner',
      at: new Date(new Date(now + DAY).setHours(9, 0, 0, 0)).getTime(),
      createdAt: at(1),
      updatedAt: at(1),
      lane: '',
      engine: '',
    }),
    done(
      'ada',
      'marketing',
      'Which ad brings the cheapest enquiries this week?',
      `The before-and-after reel: £${stats.ads[0].costPerChat} per enquiry over the fortnight, against £${costPerChat} across all four ads. The gutter clear ad is the dearest, with no enquiry in the last three days.`,
      2,
      { by: 'owner', calls: [{ server: 'meta-ads-remote', tool: 'ads_get_ad_entities' }] },
    ),
    done(
      'dash',
      'ops',
      'Morning numbers: spend, enquiries, cost per enquiry, leads overnight, anything odd',
      `Spend yesterday £${adsDaily[12].spend}, this week £${spend7}. ${stats.sales.leads7d} leads this week, 3 overnight. Cost per enquiry £${costPerChat} (target £6). Odd: the gutter clear ad has had no enquiry in three days.`,
      slotAgo('07:45'),
      { routine: 'morning-numbers', reads: ['00-Meta/numbers-ledger.md', '00-Meta/stats.json'] },
    ),
    done(
      'cos',
      'exec',
      'Daily brief for the owner: what moved, what is waiting, what needs a decision',
      'Moved: 3 new leads overnight, 2 quotes booked yesterday.\nWaiting for you: two drafts in the in-tray (a quote reply, ad pacing).\nDecision today: pause the gutter clear ad or give it two more days.',
      slotAgo('08:15', null, 4),
      { model: 'claude-opus-5-5', routine: 'daily-brief', cost: 0.143 },
    ),
    done(
      'elead',
      'emails',
      'Inbox digest: customers, suppliers, platform notices, what needs the owner',
      '1. ACTION: Meta says a payment for the ad account went through after a retry.\n2. Two quote requests sent to REPLY DRAFTS.\n3. Supplier: filter cartridges back in stock (passed to SUPPLIERS).',
      slotAgo('09:00', null, 3),
      { routine: 'inbox-digest', calls: [{ server: 'mail', tool: 'mail_search' }] },
    ),
    done(
      'piper',
      'sales',
      'Reply to the quote request from Redland (3-bed semi, windows outside)',
      'Hi, thanks for getting in touch. Windows outside for a 3-bed semi are from £20, and we can do a regular round every 4 or 8 weeks. Which day of the week usually suits you?',
      2.6,
      { by: 'owner', model: 'claude-opus-5-5', reads: ['20-Brand/voice.md', '10-Business/price-list.md'] },
    ),
    done(
      'seo',
      'marketing',
      'Weekly search check: the website against what Bristol customers search for',
      '1. Home page: add "window cleaner Bristol" to the title (it ranks for neither word now).\n2. Prices page: add the end of tenancy price, which people search for.\n3. Add the areas list to the footer so each area name appears on every page.',
      slotAgo('10:00', [1], 6),
      { routine: 'seo-audit', model: 'claude-opus-5-5', calls: [{ server: 'browser', tool: 'browser_navigate' }] },
    ),
    done(
      'enzo',
      'sales',
      'Evening lead digest: new leads, stuck quotes, who is waiting for the owner',
      'New today: 4. Quoted: 6. Booked: 2. Stuck after a quote for 2 days or more: 3. Waiting for you: 2.',
      slotAgo('20:00', null, 4),
      { routine: 'lead-digest' },
    ),
    done(
      'report',
      'ops',
      'Friday one-pager: ads, Page, leads, bookings, what changed, what to decide',
      `Ads: £${spend7} spent this week, ${chats7} enquiries, £${round(spend7 / chats7)} each. Page: 7 posts, the before-and-after reel did best. Leads: ${booked} booked, ${regular} now regular. Decide: keep the budget at £12 a day.`,
      slotAgo('17:00', [5], 5),
      { routine: 'weekly-report', model: 'claude-opus-5-5' },
    ),
    done(
      'newt',
      'marketing',
      'Three posts on spring window cleaning',
      'Post 1: Spring is here. Sparkling windows from £15. Post 2: Inside and out from £35. Post 3: Regular rounds every 4 or 8 weeks.',
      30,
      { by: 'owner', model: 'claude-opus-5-5' },
    ),
  ];
  fs.writeFileSync(path.join(data, 'tickets.json'), JSON.stringify({ tickets }, null, 1));

  // ---- the ledger: 14 days of runs ----
  const desks = ['dash', 'cos', 'elead', 'enzo', 'invo', 'newt', 'piper', 'seo', 'report', 'mlead'];
  const ledger = [];
  for (let d = 13; d >= 1; d--) {
    const runs = 5 + Math.floor(r() * 6);
    for (let k = 0; k < runs; k++) {
      const t = now - d * DAY - (14 - k) * HOUR;
      const opus = r() < 0.35;
      // tokens first and the cost from them, at list prices, so the ledger's columns agree
      const tokens = {
        in: Math.round(400 + r() * 2500),
        out: Math.round(500 + r() * (opus ? 3500 : 2000)),
        cacheRead: Math.round(14000 + r() * 30000),
        cacheWrite: k === 0 ? Math.round(9000 + r() * 4000) : 0,
      };
      const [pin, pout, pread, pwrite] = opus ? [4, 20, 0.2, 5] : [2, 10, 0.1, 2.5];
      const usd = round(
        (tokens.in * pin + tokens.out * pout + tokens.cacheRead * pread + tokens.cacheWrite * pwrite) / 1e6,
        4,
      );
      ledger.push({
        at: t,
        day: dayKey(t, tz),
        ticket: '',
        agent: desks[Math.floor(r() * desks.length)],
        dept: '',
        lane: 'api',
        engine: (e => (e < 0.7 ? 'agent' : e < 0.85 ? 'oneshot' : 'batch'))(r()),
        model: opus ? 'claude-opus-5-5' : 'claude-sonnet-5-5',
        phase: 'draft',
        usd,
        estUsd: usd,
        tokens,
        ms: Math.round(15000 + r() * 80000),
      });
    }
  }
  // today: one line per run the board shows today, at its own cost, so the desk cards and the ledger agree
  const today = dayKey(now, tz);
  for (const t of tickets.filter(x => x.costUsd && dayKey(x.updatedAt, tz) === today)) {
    const opus = /opus/.test(t.model);
    const [pin, pout, pread] = opus ? [4, 20, 0.2] : [2, 10, 0.1];
    const out = Math.round((t.costUsd * 0.4 * 1e6) / pout),
      cacheRead = 30000;
    const tokens = {
      in: Math.max(300, Math.round(((t.costUsd - (out * pout + cacheRead * pread) / 1e6) * 1e6) / pin)),
      out,
      cacheRead,
      cacheWrite: 0,
    };
    ledger.push({
      at: t.updatedAt,
      day: today,
      ticket: t.id,
      agent: t.agent,
      dept: t.dept,
      lane: 'api',
      engine: t.engine || 'agent',
      model: t.model,
      phase: 'draft',
      usd: t.costUsd,
      estUsd: t.costUsd,
      tokens,
      ms: t.timings?.totalMs || 60000,
    });
  }
  ledger.sort((a, b) => a.at - b.at);
  fs.writeFileSync(path.join(data, 'ledger.jsonl'), ledger.map(x => JSON.stringify(x)).join('\n') + '\n');

  // ---- the wire: today's lines for the live logs ----
  let seq = 0;
  const ev = [];
  const E = (h, type, o) => ev.push({ seq: ++seq, at: at(h), type, ...o });
  E(5.2, 'connector', { key: 'browser', status: 'connected', tools: 21 });
  E(5.2, 'connector', { key: 'mail', status: 'connected', tools: 6 });
  E(5.2, 'connector', { key: 'meta-ads-remote', status: 'connected', tools: 12 });
  for (const [h, agent, title, usd] of [
    [4.25, 'dash', 'Morning numbers', 0.031],
    [3.75, 'cos', 'Daily brief', 0.143],
    [3.05, 'elead', 'Inbox digest', 0.052],
    [2.65, 'piper', 'Quote reply', 0.088],
  ]) {
    E(h + 0.03, 'intake', { ticket: 'x', agent, by: 'routine', why: title });
    E(h + 0.02, 'run', { ticket: 'x', agent, stage: 'start' });
    E(h + 0.015, 'run', { ticket: 'x', agent, stage: 'booted', bootMs: 4200, toolsInContext: 18 });
    if (agent === 'elead') E(h + 0.01, 'call', { ticket: 'x', agent, server: 'mail', tool: 'mail_search' });
    E(h, 'run', { ticket: 'x', agent, stage: 'done', ms: 61000, usd });
  }
  E(2.02, 'run', { ticket: 'x', agent: 'ada', stage: 'start' });
  E(2.01, 'call', { ticket: 'x', agent: 'ada', server: 'meta-ads-remote', tool: 'ads_get_ad_entities' });
  E(2, 'run', { ticket: 'x', agent: 'ada', stage: 'done', ms: 48000, usd: 0.061 });
  E(0.4, 'intake', { ticket: 'x', agent: 'mlead', by: 'owner', why: "next week's posts" });
  fs.writeFileSync(
    path.join(data, 'events.jsonl'),
    ev
      .sort((a, b) => a.at - b.at)
      .map(x => JSON.stringify(x))
      .join('\n') + '\n',
  );

  // ---- connector health and the office state ----
  const st = (status, tools, note = '') => ({ status, tools, at: now - 5 * HOUR, ms: 1800, note });
  fs.writeFileSync(
    path.join(data, 'connectors-state.json'),
    JSON.stringify(
      {
        servers: {
          browser: st('connected', 21),
          mail: st('connected', 6),
          'canva-remote': st('connected', 14),
          'meta-ads-remote': st('connected', 12),
          'google-drive': st('missing', 0, 'needs secret GOOGLE_REFRESH_TOKEN'),
          'google-docs': st('missing', 0),
          'google-sheets': st('missing', 0),
        },
      },
      null,
      1,
    ),
  );
  fs.writeFileSync(path.join(data, 'office.json'), JSON.stringify({ paused: true, at: now }));
  return {
    brain,
    data,
    company: path.join(company, 'company.json'),
    routines: path.join(company, 'routines.json'),
    workflows: path.join(company, 'workflows.json'),
    stats: path.join(brain, '00-Meta', 'stats.json'),
  };
}
