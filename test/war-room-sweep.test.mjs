import test from 'node:test';
import assert from 'node:assert/strict';
import { beamAt, glintOf, sweepLag, SWEEP_MS } from '../ui/src/floor/sweep.js';

test('the idle sweep glints a pod just behind its beam and leaves the rest of the table dark', () => {
  // the beam along +x has just passed a pod on the +x axis
  assert.equal(sweepLag(0, 10, 0), 0);
  assert.ok(glintOf(0, 10, 0) > 0.99);
  // a little behind the beam the glint is fading; ahead of it the pod waits in the dark
  assert.ok(Math.abs(sweepLag(0.3, 10, 0) - 0.3) < 1e-9);
  assert.ok(glintOf(0.3, 10, 0) > 0 && glintOf(0.3, 10, 0) < 1);
  assert.equal(glintOf(-0.3, 10, 0), 0);
  // the lag lands in [0, 2π) whichever way the angles wrap, and the beam turns once per SWEEP_MS
  for (const beam of [-7, -1, 0, 3, 6.5, 13])
    for (const [x, z] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
      [3, -4],
    ]) {
      const lag = sweepLag(beam, x, z);
      assert.ok(lag >= 0 && lag < Math.PI * 2);
    }
  assert.equal(beamAt(0), 0);
  assert.ok(Math.abs(beamAt(SWEEP_MS / 2) - Math.PI) < 1e-9);
});
