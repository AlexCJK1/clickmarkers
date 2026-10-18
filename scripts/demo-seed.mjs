// The demo office: a made-up business (Larkspur Cleaning Co.) with made-up work and numbers, so anyone can
// open the page and click round it before setting anything up. `nightdesk demo` calls seedDemo() on a fresh
// .demo folder and serves it with the office paused and no model reachable: nothing runs, nothing is sent.
// Every figure here is invented. Times are relative to now, so the demo always looks current.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../core/config.mjs';
import { dayKey } from '../core/clock.mjs';
import { draftHash } from '../company/tickets.mjs';

const HOUR = 3600000, DAY = 24 * HOUR;
// a small seeded random, so the demo looks the same from one run to the next
function rng(seed = 7) { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }
const iso = t => new Date(t).toISOString().slice(0, 10);
const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

/** Build a demo office in `dir` (removed first). Returns the paths the server needs. */
export function seedDemo(dir, { now = Date.now(), tz = 'Europe/London' } = {}) {
  fs.rmSync(dir, { recursive: true, force: true });
  const brain = path.join(dir, 'brain'), data = path.join(dir, 'data'), company = path.join(dir, 'company');
  fs.mkdirSync(data, { recursive: true }); fs.mkdirSync(company, { recursive: true });
  fs.cpSync(path.join(ROOT, 'examples', 'brain'), brain, { recursive: true });
  for (const f of ['company.json', 'routines.json', 'workflows.json']) fs.copyFileSync(path.join(ROOT, 'company', f), path.join(company, f));
  const r = rng();

  // ---- the stats file (what a stats job would write) ----
  const days = Array.from({ length: 14 }, (_, i) => now - (13 - i) * DAY);
  const adsDaily = days.map((t, i) => { const spend = i < 2 ? 0 : round(8 + r() * 4); const reach = Math.round(spend * (95 + r() * 30)); return { date: iso(t), spend, impressions: Math.round(reach * 1.3), reach, linkClicks: Math.round(spend * (1.8 + r())), chats: i < 2 ? 0 : Math.round(spend / (3.2 + r() * 2.5)) }; });
  adsDaily[13].spend = 6.4; adsDaily[13].chats = 2;
  const leadsDaily = days.map((t, i) => ({ date: iso(t), leads: i < 2 ? 0 : Math.round(1 + r() * 4), clicks: i < 2 ? 0 : Math.round(9 + r() * 14) }));
  leadsDaily[13].leads = 3;
  const sum = (a, k, from = 0) => round(a.slice(from).reduce((s, x) => s + x[k], 0));
  const ads = [
    { id: 'ad1', name: 'Reel · before and after', spend: 71.2, impressions: 9800, chats: 19 },
    { id: 'ad2', name: 'Post · spring windows from £15', spend: 58.4, impressions: 8100, chats: 15 },
    { id: 'ad3', name: 'Post · end of tenancy cleans', spend: 44.9, impressions: 5200, chats: 8 },
    { id: 'ad4', name: 'Post · gutter clear', spend: 40.4, impressions: 4700, chats: 3 },
  ];
  const spendAll = round(ads.reduce((s, a) => s + a.spend, 0)), chatsAll = ads.reduce((s, a) => s + a.chats, 0);
  const stats = {
    updatedAt: new Date(now - 6 * 60000).toISOString(),
    marketing: { postsScheduled: 7, costPerChatUsd: round(spendAll / chatsAll), targetCostPerChatUsd: 6 },
    sales: { leadsToday: 3, leads7d: sum(leadsDaily, 'leads', 7), waitingForOwner: 2, stuck: 3, stuckDays: 2 },
    fin: { spendTodayUsd: 6.4, spend7dUsd: sum(adsDaily, 'spend', 7), spendAllUsd: spendAll, dailyBudgetUsd: 12 },
    ads: ads.map(a => ({ ...a, effective_status: 'ACTIVE', costPerChat: a.chats ? round(a.spend / a.chats) : null })),
    funnel: { new: 3, contacted: 4, quoted: 6, booked: 9, regular: 5, lost: 3 },
    stageLabels: { new: 'New', contacted: 'Contacted', quoted: 'Quoted', booked: 'Booked', regular: 'Regular customer', lost: 'Lost' },
    goal: { from: 'quoted', to: 'booked' },
    daily: { ads: adsDaily, leads: leadsDaily },
    charts: [{ id: 'leads', dept: 'sales', title: 'New leads per day', sub: 'Messenger', kind: 'bar', labels: [], series: [] }],
    _inputs: {
      leads: { today: { date: iso(now) }, last7d: { clicksByTag: { 'site-top': 41, site: 22, fb14: 17, fb15: 9, fb16: 14, fb17: 6, reel3: 11, reel4: 8, messenger: 5 } } },
      adsToday: { campaign: { name: 'Bristol windows, autumn', dailyBudgetUsd: 12, spend: 6.4, linkClicks: 14, chats: 2 } },
      adsAll: { campaign: { name: 'Bristol windows, autumn', spend: spendAll, chats: chatsAll, linkClicks: 412, impressions: 27800 } },
    },
  };
  fs.writeFileSync(path.join(brain, '00-Meta', 'stats.json'), JSON.stringify(stats, null, 1));
  fs.appendFileSync(path.join(brain, '00-Meta', 'numbers-ledger.md'), `\n- ${iso(now)}: ad spend yesterday $${adsDaily[12].spend}, this week $${stats.fin.spend7dUsd}; ${stats.sales.leads7d} leads this week; cost per enquiry $${stats.marketing.costPerChatUsd}\n`);

  // ---- tickets ----
  let n = 0; const id = () => `demo${String(++n).padStart(3, '0')}`;
  const base = { parent: null, children: [], comments: [], calls: [], reads: [], after: [], note: '', error: '', draft: '', result: '', lane: 'api', engine: 'agent', effort: '', at: 0, routine: '', workflow: '', thread: '', priority: 0, eval: null, evalRounds: 0, evalProblems: [], evalDraft: '', runId: '', checking: false, pendingDraft: '', pendingFixed: [], needsOk: false, phase: 'draft', estUsd: 0 };
  const T = (o) => { const t = { ...base, id: id(), dept: '', by: 'routine', model: 'claude-sonnet-5-5', costUsd: 0, timings: {}, ...o }; t.title ||= t.text.split('\n')[0].slice(0, 90); t.thread ||= t.id; t.estUsd ||= t.costUsd; return t; };
  const at = h => now - h * HOUR;
  const done = (agent, dept, text, result, hAgo, o = {}) => T({ agent, dept, text, result, state: 'done', costUsd: o.cost ?? round(0.02 + r() * 0.2, 3), model: o.model || 'claude-sonnet-5-5', reads: o.reads || [], calls: o.calls || [], createdAt: at(hAgo + 0.05), updatedAt: at(hAgo), timings: { totalMs: Math.round(20000 + r() * 70000) }, routine: o.routine || '', by: o.by || 'routine', ...o.extra });
  const capA = 'Thursday 18:00 (fb17)\nA: Sparkling windows, inside and out, from £35. Fully insured, DBS-checked cleaners across Bristol.\nB: When did you last see out of your windows properly? Inside and out from £35. Send us a message for a quote.\n\nFriday 18:00 (fb18)\nA: Moving out? End of tenancy cleans from £180 for a 2-bed flat, so you get your deposit back.\nB: Getting your deposit back? End of tenancy cleans from £180. Message us with the move-out date and we will check the diary.\n\nAFTER YOUR OK\n- Schedule caption A for Thursday 18:00 and caption B for Friday 18:00 on the Page.';
  const adDraft = 'The gutter clear ad has cost $13.47 per enquiry for three days running, more than twice the $6 target. The other three ads are under target.\n\nLast 3 days, per ad:\n- Reel · before and after: $14.10, 4 enquiries, $3.53 each\n- Post · spring windows: $12.90, 3 enquiries, $4.30 each\n- Post · end of tenancy: $9.80, 2 enquiries, $4.90 each\n- Post · gutter clear: $13.47, 1 enquiry, $13.47\n\nAFTER YOUR OK\n1. ads_update_entity(id: "ad4", status: "PAUSED"): pause "Post · gutter clear". The daily budget stays at $12 and moves to the other three.';
  const tickets = [
    T({ agent: 'newt', dept: 'marketing', text: 'Caption A/B: two captions for each post due in the next two days', state: 'waiting', needsOk: true, draft: capA, draftHash: draftHash(capA), costUsd: 0.094, model: 'claude-opus-5-5', engine: 'batch', note: 'queued for the batch (answers within the hour at half price)', createdAt: at(6), updatedAt: at(5.5), reads: ['40-Marketing/page-schedule.md', '20-Brand/voice.md', '10-Business/price-list.md'], timings: { totalMs: 1402000 }, eval: { verdict: 'pass', why: 'Every price is from the price list and both steps are under AFTER YOUR OK.', rounds: 1, problems: [], autofixed: [], notes: [], at: at(5.5) }, evalRounds: 1 }),
    T({ agent: 'invo', dept: 'fin', text: 'Morning ad pacing: per ad, and the change to propose if one is due', state: 'waiting', needsOk: true, draft: adDraft, draftHash: draftHash(adDraft), costUsd: 0.21, model: 'claude-opus-5-5', createdAt: at(4), updatedAt: at(3.8), reads: ['40-Marketing/ads-campaign.md'], calls: [{ server: 'meta-ads-remote', tool: 'ads_get_ad_entities' }], timings: { totalMs: 64000 }, eval: { verdict: 'pass', why: 'The figures match the ads report the desk read; the pause is under AFTER YOUR OK.', rounds: 1, problems: [], autofixed: [], notes: [], at: at(3.8) }, evalRounds: 1 }),
    T({ agent: 'mlead', dept: 'marketing', text: "Plan next week's posts: captions, visuals, slots, ready to schedule", state: 'next', by: 'owner', createdAt: at(0.4), updatedAt: at(0.4), lane: '', engine: '' }),
    T({ agent: 'ilm', dept: 'sales', text: 'Chase the stuck quotes: who to call first and what to say', state: 'scheduled', by: 'owner', at: new Date(new Date(now + DAY).setHours(9, 0, 0, 0)).getTime(), createdAt: at(1), updatedAt: at(1), lane: '', engine: '' }),
    T({ agent: 'ada', dept: 'marketing', text: 'Which ad brings the cheapest enquiries this week?', state: 'failed', by: 'owner', error: 'no connector ready on this desk: meta-ads-remote: needs secret META_MCP_TOKEN', createdAt: at(2), updatedAt: at(2), lane: '', engine: '' }),
    done('dash', 'ops', 'Morning numbers: spend, enquiries, cost per enquiry, leads overnight, anything odd', `Spend yesterday $${adsDaily[12].spend}, this week $${stats.fin.spend7dUsd}. ${stats.sales.leads7d} leads this week, 3 overnight. Cost per enquiry $${stats.marketing.costPerChatUsd} (target $6). Odd: the gutter clear ad is at $13.47 per enquiry.`, 4.2, { routine: 'morning-numbers', reads: ['00-Meta/numbers-ledger.md', '00-Meta/stats.json'] }),
    done('cos', 'exec', 'Daily brief for the owner: what moved, what is waiting, what needs a decision', 'Moved: 3 new leads overnight, 2 quotes booked yesterday.\nWaiting for you: two drafts in the in-tray (captions, ad pacing).\nDecision today: pause the gutter clear ad or give it two more days.', 3.7, { model: 'claude-opus-5-5', routine: 'daily-brief', cost: 0.143 }),
    done('elead', 'emails', 'Inbox digest: customers, suppliers, platform notices, what needs the owner', '1. ACTION: Meta says a payment for the ad account went through after a retry.\n2. Two quote requests sent to REPLY DRAFTS.\n3. Supplier: filter cartridges back in stock (passed to SUPPLIERS).', 3, { routine: 'inbox-digest', calls: [{ server: 'mail', tool: 'mail_search' }] }),
    done('piper', 'sales', 'Reply to the quote request from Redland (3-bed semi, windows outside)', 'Hi, thanks for getting in touch. Windows outside for a 3-bed semi are from £20, and we can do a regular round every 4 or 8 weeks. Which day of the week usually suits you?', 2.6, { by: 'owner', model: 'claude-opus-5-5', reads: ['20-Brand/voice.md', '10-Business/price-list.md'] }),
    done('seo', 'marketing', 'Weekly search check: the website against what Bristol customers search for', '1. Home page: add "window cleaner Bristol" to the title (it ranks for neither word now).\n2. Prices page: add the end of tenancy price, which people search for.\n3. Add the areas list to the footer so each area name appears on every page.', 26, { routine: 'seo-audit', model: 'claude-opus-5-5', calls: [{ server: 'browser', tool: 'browser_navigate' }] }),
    done('enzo', 'sales', 'Evening lead digest: new leads, stuck quotes, who is waiting for the owner', 'New today: 4. Quoted: 6. Booked: 2. Stuck after a quote for 2 days or more: 3. Waiting for you: 2.', 16, { routine: 'lead-digest' }),
    done('report', 'ops', 'Friday one-pager: ads, Page, leads, bookings, what changed, what to decide', 'Ads: $214.90 spent, 45 enquiries, $4.78 each. Page: 7 posts, the before-and-after reel did best. Leads: 9 booked, 5 now regular. Decide: keep the budget at $12 a day.', 70, { routine: 'weekly-report', model: 'claude-opus-5-5' }),
    done('newt', 'marketing', 'Three posts on spring window cleaning', 'Post 1: Spring is here. Sparkling windows from £15. Post 2: Inside and out from £35. Post 3: Regular rounds every 4 or 8 weeks.', 30, { by: 'owner', model: 'claude-opus-5-5' }),
  ];
  fs.writeFileSync(path.join(data, 'tickets.json'), JSON.stringify({ tickets }, null, 1));

  // ---- the ledger: 14 days of runs ----
  const desks = ['dash', 'cos', 'elead', 'enzo', 'invo', 'newt', 'piper', 'seo', 'report', 'mlead'];
  const ledger = [];
  for (let d = 13; d >= 0; d--) {
    const runs = d === 0 ? 7 : 5 + Math.floor(r() * 6);
    for (let k = 0; k < runs; k++) {
      const t = now - d * DAY - (d === 0 ? (7 - k) * 0.6 * HOUR : (14 - k) * HOUR); const opus = r() < 0.35; const usd = round((opus ? 0.08 : 0.02) + r() * (opus ? 0.25 : 0.08), 4);
      ledger.push({ at: t, day: dayKey(t, tz), ticket: '', agent: desks[Math.floor(r() * desks.length)], dept: '', lane: 'api', engine: (e => (e < 0.7 ? 'agent' : e < 0.85 ? 'oneshot' : 'batch'))(r()), model: opus ? 'claude-opus-5-5' : 'claude-sonnet-5-5', phase: 'draft', usd, estUsd: usd, ms: Math.round(15000 + r() * 80000) });
    }
  }
  fs.writeFileSync(path.join(data, 'ledger.jsonl'), ledger.map(x => JSON.stringify(x)).join('\n') + '\n');

  // ---- the wire: today's lines for the live logs ----
  let seq = 0; const ev = []; const E = (h, type, o) => ev.push({ seq: ++seq, at: at(h), type, ...o });
  E(5.2, 'connector', { key: 'browser', status: 'connected', tools: 21 }); E(5.2, 'connector', { key: 'mail', status: 'connected', tools: 6 }); E(5.2, 'connector', { key: 'meta-ads-remote', status: 'needs-auth', tools: 0 });
  for (const [h, agent, title, usd] of [[4.25, 'dash', 'Morning numbers', 0.031], [3.75, 'cos', 'Daily brief', 0.143], [3.05, 'elead', 'Inbox digest', 0.052], [2.65, 'piper', 'Quote reply', 0.088]]) {
    E(h + 0.03, 'intake', { ticket: 'x', agent, by: 'routine', why: title });
    E(h + 0.02, 'run', { ticket: 'x', agent, stage: 'start' });
    E(h + 0.015, 'run', { ticket: 'x', agent, stage: 'booted', bootMs: 4200, toolsInContext: 18 });
    if (agent === 'elead') E(h + 0.01, 'call', { ticket: 'x', agent, server: 'mail', tool: 'mail_search' });
    E(h, 'run', { ticket: 'x', agent, stage: 'done', ms: 61000, usd });
  }
  E(2, 'run', { ticket: 'x', agent: 'ada', stage: 'failed', error: 'connectors not ready' });
  E(0.4, 'intake', { ticket: 'x', agent: 'mlead', by: 'owner', why: 'next week\'s posts' });
  E(0.35, 'board', { office: 'paused' });
  fs.writeFileSync(path.join(data, 'events.jsonl'), ev.sort((a, b) => a.at - b.at).map(x => JSON.stringify(x)).join('\n') + '\n');

  // ---- connector health and the office state ----
  const st = (status, tools, note = '') => ({ status, tools, at: now - 5 * HOUR, ms: 1800, note });
  fs.writeFileSync(path.join(data, 'connectors-state.json'), JSON.stringify({ servers: { browser: st('connected', 21), mail: st('connected', 6), 'canva-remote': st('connected', 14), 'meta-ads-remote': st('needs-auth', 0, 'needs a sign-in: add META_MCP_TOKEN'), 'google-drive': st('missing', 0, 'needs secret GOOGLE_REFRESH_TOKEN'), 'google-docs': st('missing', 0), 'google-sheets': st('missing', 0) } }, null, 1));
  fs.writeFileSync(path.join(data, 'office.json'), JSON.stringify({ paused: true, at: now }));
  return { brain, data, company: path.join(company, 'company.json'), routines: path.join(company, 'routines.json'), workflows: path.join(company, 'workflows.json'), stats: path.join(brain, '00-Meta', 'stats.json') };
}
