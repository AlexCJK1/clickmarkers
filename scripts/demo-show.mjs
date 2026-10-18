// nightdesk demo --show: a scripted day on the floor, replayed on the wire so the war room moves. Nothing
// runs and nothing is sent: these are the events a real run would put on the wire, played from a list, for
// people trying the demo and for the README clip. The office stays paused; no ticket changes.
import { emit } from '../core/events.mjs';

// [seconds after the last step, event]. A spring push: the chief splits it, marketing writes and designs,
// the ads desk reads the numbers, the numbers desk updates the ledger, and one draft waits for the OK.
const SCRIPT = [
  [0, { type: 'intake', agent: 'cos', by: 'owner', why: 'spring window-cleaning push' }],
  [1.5, { type: 'run', agent: 'cos', stage: 'start' }],
  [2, { type: 'call', agent: 'cos', server: 'office', tool: 'brain_read' }],
  [2, { type: 'say', agent: 'cos', text: 'Splitting the spring push: words and a visual from marketing, the ad numbers first.' }],
  [1.5, { type: 'delegate', from: 'cos', to: 'mlead' }],
  [1, { type: 'delegate', from: 'cos', to: 'ada' }],
  [1.5, { type: 'run', agent: 'ada', stage: 'start' }],
  [1, { type: 'run', agent: 'mlead', stage: 'start' }],
  [1.5, { type: 'call', agent: 'ada', server: 'meta-ads-remote', tool: 'ads_insights_performance_trend' }],
  [1.5, { type: 'call', agent: 'mlead', server: 'office', tool: 'brain_read' }],
  [1.5, { type: 'say', agent: 'mlead', text: 'CONTENT writes two captions, DESIGN makes the visual, RULINGS CHECK reads every line.' }],
  [1.5, { type: 'run', agent: 'newt', stage: 'start' }],
  [1, { type: 'say', agent: 'ada', text: 'Cost per enquiry £4.80 this week, under the £6 target. The van photo ad does best.' }],
  [1.5, { type: 'run', agent: 'gfx', stage: 'start' }],
  [1, { type: 'call', agent: 'gfx', server: 'canva-remote', tool: 'search-designs' }],
  [1.5, { type: 'run', agent: 'ada', stage: 'done', ms: 41000, usd: 0.06, lane: 'api' }],
  [1, { type: 'say', agent: 'newt', text: 'Two captions: "Spring is here, so is the pollen" and "Clear windows by Friday".' }],
  [1.5, { type: 'call', agent: 'gfx', server: 'canva-remote', tool: 'get-assets' }],
  [1.5, { type: 'run', agent: 'newt', stage: 'done', ms: 52000, usd: 0.04, lane: 'api' }],
  [1, { type: 'run', agent: 'comply', stage: 'start' }],
  [1.5, { type: 'call', agent: 'comply', server: 'office', tool: 'brain_read' }],
  [1.5, { type: 'say', agent: 'comply', text: 'Every price matches the list. "Guaranteed" is not allowed: changed to "we come back free".' }],
  [1.5, { type: 'run', agent: 'comply', stage: 'done', ms: 33000, usd: 0.03, lane: 'api' }],
  [1, { type: 'run', agent: 'gfx', stage: 'done', ms: 66000, usd: 0.05, lane: 'api' }],
  [1.5, { type: 'run', agent: 'dash', stage: 'start' }],
  [1, { type: 'call', agent: 'dash', server: 'google-sheets', tool: 'sheets_read' }],
  [1.5, { type: 'say', agent: 'mlead', text: 'Post ready for Thursday 18:00 with the van photo. Waiting for your OK.' }],
  [1.5, { type: 'run', agent: 'mlead', stage: 'waiting', eval: 'pass', why: 'EVALUATIONS: passed, 0 problems' }],
  [1, { type: 'run', agent: 'dash', stage: 'done', ms: 28000, usd: 0.02, lane: 'api' }],
  [1.5, { type: 'run', agent: 'cos', stage: 'done', ms: 94000, usd: 0.09, lane: 'api' }],
];

// The page reads which desks are working from /api/health, not from the wire, so the show keeps its own list
// for the demo to add there (see showRuns); otherwise the next refresh would put every show desk back to idle.
const playing = new Map();
/** The desks the show has working now, in the shape /api/health uses for running. */
export const showRuns = () => [...playing.entries()].map(([agent, since]) => ({ ticket: 'show', agent, since }));

/** Play the script on the wire, over and over, until stop() is called. Returns stop. */
export function startShow({ gapSec = 6, speed = 1 } = {}) {
  let timer = null; let i = 0; let stopped = false;
  const next = () => {
    if (stopped) return;
    const [, e] = SCRIPT[i];
    if (e.type === 'run') { if (e.stage === 'start') playing.set(e.agent, Date.now()); else playing.delete(e.agent); }
    emit(e.type, { ...e, type: undefined, ticket: e.ticket || 'show', show: true });
    i = (i + 1) % SCRIPT.length;
    const wait = i === 0 ? gapSec : SCRIPT[i][0];
    timer = setTimeout(next, Math.max(200, (wait * 1000) / speed));
  };
  timer = setTimeout(next, 1500);
  return () => { stopped = true; clearTimeout(timer); playing.clear(); };
}
export const SHOW_STEPS = SCRIPT.length;
