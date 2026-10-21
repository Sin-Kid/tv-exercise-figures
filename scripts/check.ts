// Sanity checks for every animation: finite coordinates, stays on the 200×200 canvas,
// feet never go below the floor, and the same number of shapes every frame (so they tween).
import { ANIMATIONS, GROUND, cycleMs, shapesFor, skeletonAtTime } from '../src/index';

let failures = 0;
for (const a of ANIMATIONS) {
  const total = cycleMs(a);
  const count = shapesFor(a, skeletonAtTime(a, 0)).length;
  let ok = true;
  for (let i = 0; i <= 120; i++) {
    const s = skeletonAtTime(a, (i / 120) * total);
    const shapes = shapesFor(a, s);
    const pts = shapes.flatMap((sh) => (sh.kind === 'poly' ? sh.pts : [sh.c]));
    if (shapes.length !== count || pts.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 200 || y < 0 || y > 200)) ok = false;
    if ([s.farLeg[2], s.nearLeg[2]].some(([, y]) => y > GROUND + 1.5)) ok = false;
  }
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${a.key}`);
  if (!ok) failures++;
}
console.log(failures ? `\n${failures} failed` : `\nall ${ANIMATIONS.length} animations OK`);
process.exit(failures ? 1 : 0);
