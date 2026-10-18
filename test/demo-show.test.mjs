// The demo show: its desks count as working while their scripted run lasts, and stopping clears them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startShow, showRuns, SHOW_STEPS } from '../scripts/demo-show.mjs';
import { subscribe } from '../core/events.mjs';

test('the show marks desks working between run start and run end, and stop() clears them', async () => {
  const seen = [];
  const off = subscribe(e => {
    if (e.show) seen.push(e);
  });
  const stop = startShow({ speed: 1000 });
  try {
    // the first event goes out after 1.5 s, then one every 200 ms at this speed
    let busy = false;
    for (let i = 0; i < 60 && !busy; i++) {
      await new Promise(r => setTimeout(r, 100));
      busy = showRuns().some(r => r.agent === 'cos');
    }
    assert.ok(busy, 'the chief of staff counts as working once its run starts');
    for (const r of showRuns()) {
      assert.equal(r.ticket, 'show');
      assert.ok(r.since > 0);
    }
    assert.ok(
      seen.every(e => e.ticket === 'show'),
      'every show event is tagged with the show ticket',
    );
  } finally {
    stop();
    off();
  }
  assert.deepEqual(showRuns(), [], 'stopping the show leaves no desk working');
  assert.ok(SHOW_STEPS > 10);
});
