// Writes one self-animating .svg per exercise (SMIL, loops forever, works in
// browsers, GitHub READMEs and <img> tags) plus an index.html gallery.
//
//   npx tsx scripts/build-exercise-svgs.ts            → assets/exercises/
//   npx tsx scripts/build-exercise-svgs.ts <out-dir>

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ANIMATIONS,
  GROUND,
  cycleMs,
  shapesFor,
  skeletonAtTime,
  type ExerciseAnimation,
  type Role,
  type Shape,
} from '../src/index';

const OUT = process.argv[2] ?? join(__dirname, '..', 'svg');
const FPS = 24;

const COLORS: Record<Role, string> = {
  near: '#C6F432',
  far: '#7C9A20',
  prop: '#E8EDF2',
  band: '#FF7AB6',
};

const r1 = (n: number) => Math.round(n * 10) / 10;
const d = (s: Extract<Shape, { kind: 'poly' }>) => 'M' + s.pts.map((p) => `${r1(p[0])} ${r1(p[1])}`).join(' L');

export function animatedSvg(anim: ExerciseAnimation, opts: { title?: boolean } = {}): string {
  const total = cycleMs(anim);
  const n = Math.max(2, Math.round((total / 1000) * FPS));
  const frames = Array.from({ length: n + 1 }, (_, i) => shapesFor(anim, skeletonAtTime(anim, (i / n) * total)));
  const dur = `${(total / 1000).toFixed(2)}s`;
  const keyTimes = frames.map((_, i) => (i / n).toFixed(4)).join(';');
  const anim1 = (attr: string, values: string[]) =>
    `<animate attributeName="${attr}" dur="${dur}" repeatCount="indefinite" calcMode="linear" keyTimes="${keyTimes}" values="${values.join(';')}"/>`;

  const body = frames[0]
    .map((s0, k) => {
      const color = COLORS[s0.role];
      if (s0.kind === 'poly') {
        const values = frames.map((f) => d(f[k] as typeof s0));
        return `<path d="${values[0]}" fill="none" stroke="${color}" stroke-width="${s0.w}" stroke-linecap="round" stroke-linejoin="round">${anim1('d', values)}</path>`;
      }
      const xs = frames.map((f) => String(r1((f[k] as typeof s0).c[0])));
      const ys = frames.map((f) => String(r1((f[k] as typeof s0).c[1])));
      return `<circle cx="${xs[0]}" cy="${ys[0]}" r="${s0.r}" fill="${color}">${anim1('cx', xs)}${anim1('cy', ys)}</circle>`;
    })
    .join('\n  ');

  const title = opts.title === false ? '' : `<title>${anim.label}</title>\n  `;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200" role="img" aria-label="${anim.label} animation">
  ${title}<line x1="14" y1="${GROUND + 6}" x2="186" y2="${GROUND + 6}" stroke="#2A3441" stroke-width="3" stroke-linecap="round"/>
  ${body}
</svg>
`;
}

if (require.main === module) {
  mkdirSync(OUT, { recursive: true });
  for (const a of ANIMATIONS) writeFileSync(join(OUT, `${a.key}.svg`), animatedSvg(a));
  const cards = ANIMATIONS.map(
    (a) => `<figure><img src="${a.key}.svg" alt="${a.label}" width="200" height="200"><figcaption>${a.label}<small>${a.key}.svg</small></figcaption></figure>`,
  ).join('\n');
  writeFileSync(
    join(OUT, 'index.html'),
    `<!doctype html><meta charset="utf-8"><title>FitCoach TV exercise animations</title>
<style>body{background:#0B0F14;color:#F4F7FA;font-family:Arial,sans-serif;margin:24px}h1{font-size:22px}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px}
figure{margin:0;background:#151B23;border-radius:14px;padding:10px;text-align:center}
figcaption{font-weight:700}small{display:block;color:#9AA7B6;font-weight:400;margin-top:2px}</style>
<h1>FitCoach TV · ${ANIMATIONS.length} exercise animations</h1><main>${cards}</main>`,
  );
  console.log(`wrote ${ANIMATIONS.length} svgs + index.html to ${OUT}`);
}
