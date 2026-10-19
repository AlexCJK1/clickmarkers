// The war room's idle sweep as plain arithmetic, so it is tested without a browser: a faint beam turns
// round the table once every SWEEP_MS, and a pod glints for GLINT_SPAN radians after the beam passes it.
export const SWEEP_MS = 16000;
export const GLINT_SPAN = 0.55;
const TAU = Math.PI * 2;

/** The beam's angle at time `now` (ms). */
export const beamAt = now => ((now % SWEEP_MS) / SWEEP_MS) * TAU;

/** How far behind the beam the point (x, z) on the table is: 0 just passed, up to 2π. */
export function sweepLag(beam, x, z) {
  const d = (beam - Math.atan2(-z, x)) % TAU;
  return d < 0 ? d + TAU : d;
}

/** The glint of a pod at (x, z): 1 as the beam passes, fading to 0 over GLINT_SPAN, 0 elsewhere. */
export function glintOf(beam, x, z) {
  const lag = sweepLag(beam, x, z);
  return lag < GLINT_SPAN ? 1 - lag / GLINT_SPAN : 0;
}
