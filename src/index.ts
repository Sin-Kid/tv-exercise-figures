// Stick-figure animations for every exercise.
//
// Pure TypeScript (no React Native imports) so the same data drives the TV app
// (src/components/ExerciseFigure.tsx) and the standalone animated .svg files
// (scripts/build-exercise-svgs.ts).
//
// Coordinate system: a 200×200 box, y grows downward, ground at y = 180.
// Side-view figures face right (+x). Limb angles are absolute, in degrees:
// 0 = pointing straight down, 90 = pointing forward (+x), 180 = straight up,
// -90 = pointing back. Torso angle: 0 = upright, 90 = leaning fully forward.

export type Vec = [number, number];
export type Limb = { a: [number, number] } | { to: Vec; bend?: 1 | -1 };

export interface Pose {
  hip: Vec;
  /** Torso angle (0 = upright, +90 = forward horizontal, -90 = back horizontal). */
  t: number;
  /** Head tilt relative to the torso (+ = chin toward the front/down). */
  h?: number;
  /** Far arm / near arm / far leg / near leg. */
  la: Limb;
  ra: Limb;
  ll: Limb;
  rl: Limb;
}

export interface Frame {
  p: Pose;
  /** Milliseconds to move from this pose to the next one. */
  ms: number;
  /** Milliseconds to hold this pose before moving. */
  hold?: number;
}

export type Prop =
  | { kind: 'dumbbell'; hands: 'both' | 'near' }
  | { kind: 'kettlebell' }
  | { kind: 'band'; from: 'hands' | 'feet' };

export interface ExerciseAnimation {
  key: string;
  label: string;
  view: 'side' | 'front';
  frames: Frame[];
  prop?: Prop;
  /** Loop the last frame back to the first by the shortest rotation. */
  circular?: boolean;
  /** Move at a constant speed between frames (no slow-down at each keyframe), e.g. arm circles. */
  linear?: boolean;
}

export const GROUND = 180;
const TORSO = 50;
const NECK = 4;
export const HEAD_R = 11;
const UA = 28; // upper arm
const FA = 26; // forearm
const TH = 34; // thigh
const SH = 34; // shin

// ---------- geometry ----------

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const limbDir = (a: number): Vec => [Math.sin(rad(a)), Math.cos(rad(a))];
const torsoDir = (t: number): Vec => [Math.sin(rad(t)), -Math.cos(rad(t))];
const add = (p: Vec, d: Vec, k: number): Vec => [p[0] + d[0] * k, p[1] + d[1] * k];
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const lerpV = (a: Vec, b: Vec, u: number): Vec => [lerp(a[0], b[0], u), lerp(a[1], b[1], u)];
const angleOf = (from: Vec, to: Vec) => deg(Math.atan2(to[0] - from[0], to[1] - from[1]));

/** Two-bone IK. bend +1 puts the middle joint on the "knee forward" side for a downward limb. */
function solveIK(root: Vec, target: Vec, l1: number, l2: number, bend: 1 | -1): [number, number] {
  const dx = target[0] - root[0];
  const dy = target[1] - root[1];
  const raw = Math.hypot(dx, dy) || 0.001;
  const d = Math.min(Math.max(raw, Math.abs(l1 - l2) + 0.01), l1 + l2 - 0.01);
  const base = Math.atan2(dy, dx);
  const a = Math.acos(Math.min(1, Math.max(-1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))));
  const pick = (th: number) => {
    const j: Vec = [root[0] + l1 * Math.cos(th), root[1] + l1 * Math.sin(th)];
    const cross = dx * (j[1] - root[1]) - dy * (j[0] - root[0]);
    return { j, cross };
  };
  const c1 = pick(base + a);
  const c2 = pick(base - a);
  const joint = (bend === 1 ? c1.cross < 0 : c1.cross > 0) ? c1.j : c2.j;
  const end: Vec = [root[0] + (dx / raw) * d, root[1] + (dy / raw) * d];
  return [angleOf(root, joint), angleOf(joint, end)];
}

function limbAngles(root: Vec, limb: Limb, l1: number, l2: number, defBend: 1 | -1): [number, number] {
  return 'a' in limb ? limb.a : solveIK(root, limb.to, l1, l2, limb.bend ?? defBend);
}

const shoulderOf = (p: Pose) => add(p.hip, torsoDir(p.t), TORSO);

function lerpAngle(a: number, b: number, u: number, shortest: boolean) {
  if (!shortest) return lerp(a, b, u);
  let d = ((b - a) % 360 + 540) % 360 - 180;
  if (d === -180) d = 180;
  return a + d * u;
}

// ---------- skeleton ----------

export interface Skeleton {
  head: Vec;
  hip: Vec;
  shoulder: Vec;
  farArm: [Vec, Vec, Vec];
  nearArm: [Vec, Vec, Vec];
  farLeg: [Vec, Vec, Vec];
  nearLeg: [Vec, Vec, Vec];
}

function chain(root: Vec, ang: [number, number], l1: number, l2: number): [Vec, Vec, Vec] {
  const mid = add(root, limbDir(ang[0]), l1);
  return [root, mid, add(mid, limbDir(ang[1]), l2)];
}

function blendLimb(
  r0: Vec, l0: Limb, r1: Vec, l1: Limb, rNow: Vec, u: number,
  L1: number, L2: number, defBend: 1 | -1, shortest: boolean,
): [number, number] {
  if ('to' in l0 && 'to' in l1) {
    return solveIK(rNow, lerpV(l0.to, l1.to, u), L1, L2, (u < 0.5 ? l0.bend : l1.bend) ?? defBend);
  }
  const a0 = limbAngles(r0, l0, L1, L2, defBend);
  const a1 = limbAngles(r1, l1, L1, L2, defBend);
  return [lerpAngle(a0[0], a1[0], u, shortest), lerpAngle(a0[1], a1[1], u, shortest)];
}

/** Pose blended between p0 and p1 at u ∈ [0,1]. */
export function skeletonAt(p0: Pose, p1: Pose, u: number, shortest = false): Skeleton {
  const hip = lerpV(p0.hip, p1.hip, u);
  const t = lerp(p0.t, p1.t, u);
  const h = lerp(p0.h ?? 0, p1.h ?? 0, u);
  const shoulder = add(hip, torsoDir(t), TORSO);
  const head = add(shoulder, torsoDir(t + h), NECK + HEAD_R);
  const s0 = shoulderOf(p0);
  const s1 = shoulderOf(p1);
  const arm = (k: 'la' | 'ra') => chain(shoulder, blendLimb(s0, p0[k], s1, p1[k], shoulder, u, UA, FA, -1, shortest), UA, FA);
  const leg = (k: 'll' | 'rl') => chain(hip, blendLimb(p0.hip, p0[k], p1.hip, p1[k], hip, u, TH, SH, 1, false), TH, SH);
  return { head, hip, shoulder, farArm: arm('la'), nearArm: arm('ra'), farLeg: leg('ll'), nearLeg: leg('rl') };
}

// ---------- timeline ----------

export function cycleMs(anim: ExerciseAnimation): number {
  return anim.frames.reduce((s, f) => s + f.ms + (f.hold ?? 0), 0);
}

const ease = (u: number) => 0.5 - 0.5 * Math.cos(Math.PI * u);

export function skeletonAtTime(anim: ExerciseAnimation, ms: number): Skeleton {
  const total = cycleMs(anim);
  let t = ((ms % total) + total) % total;
  const n = anim.frames.length;
  for (let i = 0; i < n; i++) {
    const f = anim.frames[i];
    const next = anim.frames[(i + 1) % n];
    const hold = f.hold ?? 0;
    if (t < hold) return skeletonAt(f.p, f.p, 0);
    t -= hold;
    if (t < f.ms || i === n - 1) {
      const u = f.ms ? Math.min(1, t / f.ms) : 1;
      return skeletonAt(f.p, next.p, anim.linear ? u : ease(u), !!anim.circular && i === n - 1);
    }
    t -= f.ms;
  }
  return skeletonAt(anim.frames[0].p, anim.frames[0].p, 0);
}

// ---------- drawable shapes ----------

export type Role = 'far' | 'near' | 'prop' | 'band';
export type Shape =
  | { kind: 'poly'; pts: Vec[]; w: number; role: Role }
  | { kind: 'dot'; c: Vec; r: number; role: Role };

const perp = (a: Vec, b: Vec): Vec => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  return [-dy / l, dx / l];
};

function dumbbell(arm: [Vec, Vec, Vec]): Shape[] {
  const hand = arm[2];
  const n = perp(arm[1], arm[2]);
  const a = add(hand, n, -9);
  const b = add(hand, n, 9);
  return [
    { kind: 'poly', pts: [a, b], w: 4, role: 'prop' },
    { kind: 'dot', c: a, r: 5, role: 'prop' },
    { kind: 'dot', c: b, r: 5, role: 'prop' },
  ];
}

/** Ordered shapes for one frame. Same count/order every frame, so they can be tweened. */
export function shapesFor(anim: ExerciseAnimation, s: Skeleton): Shape[] {
  const front = anim.view === 'front';
  const farRole: Role = front ? 'near' : 'far';
  const out: Shape[] = [
    { kind: 'poly', pts: s.farArm, w: 8, role: farRole },
    { kind: 'poly', pts: s.farLeg, w: 9, role: farRole },
    { kind: 'poly', pts: [s.hip, s.shoulder], w: 11, role: 'near' },
    { kind: 'dot', c: s.head, r: HEAD_R, role: 'near' },
    { kind: 'poly', pts: s.nearLeg, w: 9, role: 'near' },
    { kind: 'poly', pts: s.nearArm, w: 8, role: 'near' },
  ];
  const p = anim.prop;
  if (p?.kind === 'dumbbell') {
    if (p.hands === 'both') out.push(...dumbbell(s.farArm));
    out.push(...dumbbell(s.nearArm));
  } else if (p?.kind === 'kettlebell') {
    const hands = lerpV(s.farArm[2], s.nearArm[2], 0.5);
    const dir: Vec = (() => {
      const m = lerpV(s.farArm[1], s.nearArm[1], 0.5);
      const l = Math.hypot(hands[0] - m[0], hands[1] - m[1]) || 1;
      return [(hands[0] - m[0]) / l, (hands[1] - m[1]) / l];
    })();
    out.push({ kind: 'dot', c: add(hands, dir, 10), r: 9, role: 'prop' });
  } else if (p?.kind === 'band') {
    if (p.from === 'hands') out.push({ kind: 'poly', pts: [s.farArm[2], s.nearArm[2]], w: 3, role: 'band' });
    else {
      out.push({ kind: 'poly', pts: [s.farLeg[2], s.farArm[2]], w: 3, role: 'band' });
      out.push({ kind: 'poly', pts: [s.nearLeg[2], s.nearArm[2]], w: 3, role: 'band' });
    }
  }
  return out;
}

// ---------- the animations ----------

const STAND: Pose = { hip: [100, 112], t: 0, la: { a: [4, 8] }, ra: { a: [-3, 2] }, ll: { to: [97, GROUND] }, rl: { to: [103, GROUND] } };
const S = (o: Partial<Pose> = {}): Pose => ({ ...STAND, ...o });
const HIPS: Limb = { a: [-35, 40] }; // hands on hips
const FEET_FWD = { ll: { to: [97, GROUND] as Vec }, rl: { to: [101, GROUND] as Vec } };

// High plank on a straight line from the feet (30,180) through the hips.
const PLANK_HI: Pose = { hip: [92, 152], t: 60, la: { to: [136, GROUND] }, ra: { to: [140, GROUND] }, ll: { to: [28, GROUND], bend: -1 }, rl: { to: [32, GROUND], bend: -1 } };
const PUSH_LO: Pose = { hip: [96, 165], t: 77.2, la: { to: [136, GROUND] }, ra: { to: [140, GROUND] }, ll: { to: [28, GROUND], bend: -1 }, rl: { to: [32, GROUND], bend: -1 } };

// Higher-hip plank for moves where a knee swings under the body.
const PLANK_UP: Pose = { hip: [92, 137], t: 76, la: { to: [134, GROUND] }, ra: { to: [138, GROUND] }, ll: { to: [32, GROUND] }, rl: { to: [36, GROUND] } };

// On all fours: knees under hips, hands under shoulders.
const FOURS = (o: Partial<Pose> = {}): Pose => ({
  hip: [76, 146], t: 70, h: 0,
  la: { to: [121, GROUND] }, ra: { to: [125, GROUND] },
  ll: { a: [2, -90] }, rl: { a: [-2, -90] },
  ...o,
});

// Lying on the back, head to the left, knees bent.
const BACK = (o: Partial<Pose> = {}): Pose => ({
  hip: [112, 168], t: -91, h: 0,
  la: { a: [92, 90] }, ra: { a: [94, 90] },
  ll: { to: [143, GROUND], bend: 1 }, rl: { to: [147, GROUND], bend: 1 },
  ...o,
});

const SQUAT_LOW = (arms: Partial<Pose> = {}): Pose => ({ ...S(FEET_FWD), hip: [82, 142], t: 38, la: { a: [84, 88] }, ra: { a: [88, 92] }, ...arms });
const RACK = { la: { to: [124, 102] as Vec }, ra: { to: [128, 100] as Vec } }; // weights at the shoulders (squat)
const OVERHEAD = { la: { to: [99, 8] as Vec }, ra: { to: [103, 8] as Vec } };

const halo = (key: string, label: string, prop: Prop): ExerciseAnimation => {
  const c: Vec = [100, 40];
  const pts = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    return [c[0] + 26 * Math.cos(a), c[1] + 22 * Math.sin(a)] as Vec;
  });
  return {
    key, label, view: 'front', prop,
    frames: pts.map((pt) => ({ p: S({ la: { to: pt, bend: 1 }, ra: { to: pt, bend: -1 } }), ms: 260 })),
  };
};

export const ANIMATIONS: ExerciseAnimation[] = [
  // ----- warm-up -----
  {
    key: 'march', label: 'March in Place', view: 'side',
    frames: [
      { p: S({ la: { a: [40, 95] }, ra: { a: [-30, -10] }, rl: { a: [75, 0] } }), ms: 450 },
      { p: S({ ra: { a: [40, 95] }, la: { a: [-30, -10] }, ll: { a: [75, 0] } }), ms: 450 },
    ],
  },
  {
    // Two forward circles (over the top toward the front), then two backward circles.
    // Angles keep counting past ±360 so each segment turns the right way.
    key: 'armCircles', label: 'Arm Circles', view: 'side', linear: true,
    frames: [0, -90, -180, -270, -360, -450, -540, -630, -720, -630, -540, -450, -360, -270, -180, -90].map((th, i) => ({
      p: S({ la: { a: [th + 14, th + 14] }, ra: { a: [th, th] } }),
      ms: 300,
      hold: i === 0 || i === 8 ? 250 : 0,
    })),
  },
  {
    key: 'hipOpeners', label: 'Hip Openers', view: 'side',
    frames: [
      { p: S({ la: HIPS, ra: HIPS }), ms: 500 },
      { p: S({ la: HIPS, ra: HIPS, rl: { a: [88, -5] } }), ms: 500 },
      { p: S({ la: HIPS, ra: HIPS, rl: { a: [35, -70] }, t: -3 }), ms: 600 },
      { p: S({ la: HIPS, ra: HIPS }), ms: 500 },
      { p: S({ la: HIPS, ra: HIPS, ll: { a: [88, -5] } }), ms: 500 },
      { p: S({ la: HIPS, ra: HIPS, ll: { a: [35, -70] }, t: -3 }), ms: 600 },
    ],
  },
  // ----- cool-down -----
  {
    key: 'quadStretch', label: 'Standing Quad Stretch', view: 'side',
    frames: [
      { p: S({ la: { a: [80, 85] }, ra: { a: [-20, -5] }, rl: { a: [-10, -170] } }), ms: 1400 },
      { p: S({ hip: [100, 111], t: 3, la: { a: [84, 88] }, ra: { a: [-20, -5] }, rl: { a: [-10, -170] } }), ms: 1400 },
      { p: S(), ms: 900 },
      { p: S({ ra: { a: [80, 85] }, la: { a: [-20, -5] }, ll: { a: [-10, -170] } }), ms: 1400 },
      { p: S({ hip: [100, 111], t: 3, ra: { a: [84, 88] }, la: { a: [-20, -5] }, ll: { a: [-10, -170] } }), ms: 1400 },
      { p: S(), ms: 900 },
    ],
  },
  {
    key: 'forwardFold', label: 'Forward Fold', view: 'side',
    frames: [
      { p: S(), ms: 1600, hold: 300 },
      { p: S({ hip: [92, 112], t: 130, h: 10, la: { a: [-12, -78] }, ra: { a: [-15, -82] } }), ms: 1600, hold: 1000 },
    ],
  },
  {
    key: 'breathing', label: 'Deep Breathing', view: 'side',
    frames: [
      { p: S(), ms: 2400, hold: 300 },
      { p: S({ hip: [100, 111], t: -3, h: -10, la: { a: [160, 165] }, ra: { a: [165, 170] } }), ms: 2400, hold: 300 },
    ],
  },
  // ----- strength / main -----
  {
    key: 'squat', label: 'Bodyweight Squats', view: 'side',
    frames: [{ p: S(FEET_FWD), ms: 700 }, { p: SQUAT_LOW(), ms: 700, hold: 250 }],
  },
  {
    key: 'pushup', label: 'Push-ups', view: 'side',
    frames: [{ p: PLANK_HI, ms: 650, hold: 150 }, { p: PUSH_LO, ms: 650, hold: 100 }],
  },
  {
    key: 'lunge', label: 'Reverse Lunges', view: 'side',
    frames: [
      { p: S({ la: HIPS, ra: HIPS }), ms: 650 },
      { p: S({ hip: [92, 140], t: 4, la: HIPS, ra: HIPS, ll: { to: [112, GROUND] }, rl: { to: [56, GROUND], bend: 1 } }), ms: 650, hold: 200 },
      { p: S({ la: HIPS, ra: HIPS }), ms: 650 },
      { p: S({ hip: [92, 140], t: 4, la: HIPS, ra: HIPS, rl: { to: [112, GROUND] }, ll: { to: [56, GROUND], bend: 1 } }), ms: 650, hold: 200 },
    ],
  },
  {
    key: 'bridge', label: 'Glute Bridges', view: 'side',
    frames: [
      { p: BACK(), ms: 700, hold: 150 },
      { p: BACK({ hip: [112.1, 155.3], t: -105.9, h: 16 }), ms: 700, hold: 350 },
    ],
  },
  {
    key: 'plank', label: 'Plank Hold', view: 'side',
    frames: [
      { p: { hip: [96, 164], t: 76.3, la: { a: [2, 90] }, ra: { a: [0, 90] }, ll: { to: [28, GROUND], bend: -1 }, rl: { to: [32, GROUND], bend: -1 } }, ms: 1500 },
      { p: { hip: [96, 162.5], t: 76.3, h: -4, la: { a: [2, 90] }, ra: { a: [0, 90] }, ll: { to: [28, GROUND], bend: -1 }, rl: { to: [32, GROUND], bend: -1 } }, ms: 1500 },
    ],
  },
  {
    key: 'deepSquat', label: 'Deep Squat Hold', view: 'side',
    frames: [
      { p: S({ hip: [90, 160], t: 22, ll: { to: [100, GROUND] }, rl: { to: [104, GROUND] }, la: { to: [122, 120] }, ra: { to: [124, 118] } }), ms: 1600 },
      { p: S({ hip: [90, 158], t: 20, h: -6, ll: { to: [100, GROUND] }, rl: { to: [104, GROUND] }, la: { to: [122, 118] }, ra: { to: [124, 116] } }), ms: 1600 },
    ],
  },
  // ----- cardio -----
  {
    key: 'jacks', label: 'Jumping Jacks', view: 'front',
    frames: [
      { p: S({ la: { a: [-6, -4] }, ra: { a: [6, 4] }, ll: { to: [94, GROUND] }, rl: { to: [106, GROUND] } }), ms: 330 },
      { p: S({ hip: [100, 118], la: { a: [-150, -165] }, ra: { a: [150, 165] }, ll: { to: [72, GROUND] }, rl: { to: [128, GROUND] } }), ms: 330 },
    ],
  },
  {
    key: 'highKnees', label: 'High Knees', view: 'side',
    frames: [
      { p: S({ hip: [100, 109], la: { a: [60, 140] }, ra: { a: [-45, -20] }, rl: { a: [100, 5] }, ll: { to: [97, GROUND - 3] } }), ms: 260 },
      { p: S({ hip: [100, 109], ra: { a: [60, 140] }, la: { a: [-45, -20] }, ll: { a: [100, 5] }, rl: { to: [103, GROUND - 3] } }), ms: 260 },
    ],
  },
  {
    key: 'skater', label: 'Skater Hops', view: 'front',
    frames: [
      { p: S({ hip: [76, 120], t: -10, ll: { to: [70, GROUND] }, rl: { to: [96, 168], bend: -1 }, ra: { a: [-50, -70] }, la: { a: [-20, -10] } }), ms: 240, hold: 120 },
      { p: S({ hip: [100, 102], t: 0, ll: { to: [92, 164] }, rl: { to: [108, 164], bend: -1 }, la: { a: [-30, -20] }, ra: { a: [30, 20] } }), ms: 240 },
      { p: S({ hip: [124, 120], t: 10, rl: { to: [130, GROUND], bend: -1 }, ll: { to: [104, 168] }, la: { a: [50, 70] }, ra: { a: [20, 10] } }), ms: 240, hold: 120 },
      { p: S({ hip: [100, 102], t: 0, ll: { to: [92, 164] }, rl: { to: [108, 164], bend: -1 }, la: { a: [-30, -20] }, ra: { a: [30, 20] } }), ms: 240 },
    ],
  },
  {
    key: 'climbers', label: 'Mountain Climbers', view: 'side',
    frames: [
      { p: { ...PLANK_UP, rl: { a: [45, -110] } }, ms: 230 },
      { p: { ...PLANK_UP, ll: { a: [45, -110] } }, ms: 230 },
    ],
  },
  {
    key: 'boxing', label: 'Shadow Boxing', view: 'side',
    frames: [
      { p: S({ hip: [100, 116], t: 5, ll: { to: [120, GROUND] }, rl: { to: [84, GROUND] }, la: { to: [122, 58] }, ra: { to: [116, 64] } }), ms: 170, hold: 220 },
      { p: S({ hip: [102, 116], t: 8, ll: { to: [120, GROUND] }, rl: { to: [84, GROUND] }, la: { to: [158, 64] }, ra: { to: [116, 64] } }), ms: 170 },
      { p: S({ hip: [100, 116], t: 5, ll: { to: [120, GROUND] }, rl: { to: [84, GROUND] }, la: { to: [122, 58] }, ra: { to: [116, 64] } }), ms: 170, hold: 220 },
      { p: S({ hip: [104, 116], t: 14, ll: { to: [120, GROUND] }, rl: { to: [84, GROUND] }, la: { to: [124, 60] }, ra: { to: [162, 64] } }), ms: 170 },
    ],
  },
  // ----- mobility -----
  {
    key: 'wgs', label: "World's Greatest Stretch", view: 'side',
    frames: [
      { p: S({ hip: [96, 150], t: 55, ll: { to: [40, GROUND], bend: -1 }, rl: { to: [138, GROUND] }, ra: { to: [126, GROUND] }, la: { to: [120, GROUND - 2] } }), ms: 1300, hold: 400 },
      { p: S({ hip: [96, 150], t: 40, h: -25, ll: { to: [40, GROUND], bend: -1 }, rl: { to: [138, GROUND] }, ra: { to: [126, GROUND] }, la: { a: [178, 180] } }), ms: 1300, hold: 600 },
      { p: S({ hip: [96, 150], t: 55, ll: { to: [40, GROUND], bend: -1 }, rl: { to: [138, GROUND] }, ra: { to: [126, GROUND] }, la: { to: [120, GROUND - 2] } }), ms: 1300 },
      // other side: swap the front and back leg, the other arm reaches up
      { p: S({ hip: [96, 150], t: 55, rl: { to: [40, GROUND], bend: -1 }, ll: { to: [138, GROUND] }, la: { to: [126, GROUND] }, ra: { to: [120, GROUND - 2] } }), ms: 1300, hold: 400 },
      { p: S({ hip: [96, 150], t: 40, h: -25, rl: { to: [40, GROUND], bend: -1 }, ll: { to: [138, GROUND] }, la: { to: [126, GROUND] }, ra: { a: [178, 180] } }), ms: 1300, hold: 600 },
      { p: S({ hip: [96, 150], t: 55, rl: { to: [40, GROUND], bend: -1 }, ll: { to: [138, GROUND] }, la: { to: [126, GROUND] }, ra: { to: [120, GROUND - 2] } }), ms: 1300 },
    ],
  },
  {
    key: 'catCow', label: 'Cat-Cow', view: 'side',
    frames: [
      { p: FOURS({ hip: [76, 142], t: 64, h: 60 }), ms: 1400, hold: 300 },
      { p: FOURS({ hip: [76, 146], t: 76, h: -40 }), ms: 1400, hold: 300 },
    ],
  },
  {
    key: 'thoracic', label: 'Thoracic Rotations', view: 'side',
    frames: [
      { p: FOURS(), ms: 1100 },
      { p: FOURS({ h: -30, ra: { a: [178, 180] } }), ms: 1000, hold: 300 },
      { p: FOURS(), ms: 1000 },
      { p: FOURS({ h: 40, t: 74, ra: { a: [-60, -75] } }), ms: 1000, hold: 300 },
      { p: FOURS(), ms: 1000 },
      { p: FOURS({ h: -30, la: { a: [178, 180] } }), ms: 1000, hold: 300 },
      { p: FOURS(), ms: 1000 },
      { p: FOURS({ h: 40, t: 74, la: { a: [-60, -75] } }), ms: 1000, hold: 300 },
    ],
  },
  // ----- equipment -----
  {
    key: 'row', label: 'Dumbbell Rows', view: 'side', prop: { kind: 'dumbbell', hands: 'near' },
    frames: [
      { p: S({ hip: [86, 118], t: 72, ll: { to: [100, GROUND] }, rl: { to: [104, GROUND] }, la: { to: [112, 138] }, ra: { a: [0, 0] } }), ms: 600, hold: 150 },
      { p: S({ hip: [86, 118], t: 72, ll: { to: [100, GROUND] }, rl: { to: [104, GROUND] }, la: { to: [112, 138] }, ra: { to: [120, 112], bend: 1 } }), ms: 600, hold: 200 },
    ],
  },
  {
    key: 'press', label: 'Dumbbell Shoulder Press', view: 'side', prop: { kind: 'dumbbell', hands: 'both' },
    frames: [
      { p: S({ la: { to: [116, 66] }, ra: { to: [120, 64] } }), ms: 700, hold: 150 },
      { p: S(OVERHEAD), ms: 700, hold: 150 },
    ],
  },
  {
    key: 'kbSwing', label: 'Kettlebell Swings', view: 'side', prop: { kind: 'kettlebell' },
    frames: [
      { p: S({ hip: [82, 120], t: 68, ...FEET_FWD, la: { to: [98, 152] }, ra: { to: [100, 150] } }), ms: 480, hold: 60 },
      { p: S({ t: -4, ...FEET_FWD, la: { a: [88, 88] }, ra: { a: [90, 90] } }), ms: 480, hold: 120 },
    ],
  },
  {
    key: 'pullApart', label: 'Band Pull-Aparts', view: 'front', prop: { kind: 'band', from: 'hands' },
    frames: [
      { p: S({ la: { to: [88, 72], bend: 1 }, ra: { to: [112, 72], bend: -1 } }), ms: 650, hold: 150 },
      { p: S({ la: { a: [-90, -90] }, ra: { a: [90, 90] } }), ms: 650, hold: 250 },
    ],
  },
  {
    key: 'thruster', label: 'Dumbbell Thrusters', view: 'side', prop: { kind: 'dumbbell', hands: 'both' },
    frames: [{ p: SQUAT_LOW(RACK), ms: 650, hold: 120 }, { p: S({ ...FEET_FWD, ...OVERHEAD }), ms: 650, hold: 150 }],
  },
  halo('dbHalo', 'Dumbbell Halos', { kind: 'dumbbell', hands: 'near' }),
  halo('kbHalo', 'Kettlebell Halos', { kind: 'kettlebell' }),
  {
    key: 'bandSquatPress', label: 'Band Squat to Press', view: 'side', prop: { kind: 'band', from: 'feet' },
    frames: [{ p: SQUAT_LOW(RACK), ms: 650, hold: 120 }, { p: S({ ...FEET_FWD, ...OVERHEAD }), ms: 650, hold: 150 }],
  },
  // ----- extras for moves Bedrock commonly picks -----
  {
    key: 'curl', label: 'Bicep Curls', view: 'side', prop: { kind: 'dumbbell', hands: 'both' },
    frames: [
      { p: S({ la: { a: [-2, 2] }, ra: { a: [-4, 0] } }), ms: 600, hold: 100 },
      { p: S({ la: { a: [-2, 145] }, ra: { a: [-4, 150] } }), ms: 600, hold: 150 },
    ],
  },
  {
    key: 'deadlift', label: 'Romanian Deadlift', view: 'side', prop: { kind: 'dumbbell', hands: 'both' },
    frames: [
      { p: S({ ...FEET_FWD, la: { a: [2, 2] }, ra: { a: [0, 0] } }), ms: 900, hold: 150 },
      { p: S({ hip: [80, 118], t: 75, ...FEET_FWD, la: { a: [2, 2] }, ra: { a: [0, 0] } }), ms: 900, hold: 150 },
    ],
  },
  {
    key: 'burpee', label: 'Burpees', view: 'side',
    frames: [
      { p: S(FEET_FWD), ms: 350 },
      { p: S({ hip: [88, 150], t: 50, ...FEET_FWD, la: { to: [124, GROUND] }, ra: { to: [128, GROUND] } }), ms: 300 },
      { p: { ...PLANK_UP, la: { to: [124, GROUND] }, ra: { to: [128, GROUND] } }, ms: 300, hold: 150 },
      { p: S({ hip: [88, 150], t: 50, ...FEET_FWD, la: { to: [124, GROUND] }, ra: { to: [128, GROUND] } }), ms: 300 },
      { p: S({ hip: [100, 106], t: -2, la: { a: [158, 164] }, ra: { a: [162, 168] }, ll: { to: [98, 172] }, rl: { to: [102, 172] } }), ms: 300 },
    ],
  },
  {
    key: 'crunch', label: 'Crunches', view: 'side',
    frames: [
      { p: BACK({ la: { to: [44, 160], bend: 1 }, ra: { to: [46, 158], bend: 1 } }), ms: 600, hold: 150 },
      { p: BACK({ t: -62, la: { to: [50, 130], bend: 1 }, ra: { to: [52, 128], bend: 1 } }), ms: 600, hold: 200 },
    ],
  },
];

const BY_KEY = new Map(ANIMATIONS.map((a) => [a.key, a]));

// Order matters: more specific patterns first.
const MATCHERS: [RegExp, string][] = [
  [/kettle\w*\s*halo|halo.*kettle/, 'kbHalo'],
  [/halo/, 'dbHalo'],
  [/band.*(squat|press)|squat.*press.*band/, 'bandSquatPress'],
  [/thruster|squat\s*(to|and|&)?\s*press/, 'thruster'],
  [/arm\s*(circle|swing)|shoulder\s*roll/, 'armCircles'],
  [/leg\s*swing|hip\s*(open|circle)/, 'hipOpeners'],
  [/swing/, 'kbSwing'],
  [/pull.?apart|face\s*pull|reverse\s*fly/, 'pullApart'],
  [/\brows?\b|rowing|renegade/, 'row'],
  [/curl/, 'curl'],
  [/deadlift|good\s*morning|hinge/, 'deadlift'],
  [/press|overhead|push\s*press/, 'press'],
  [/burpee|sprawl/, 'burpee'],
  [/push.?up|press.?up/, 'pushup'],
  [/climber/, 'climbers'],
  [/crunch|sit.?up|v.?up|leg\s*raise|bicycle|dead\s*bug|hollow/, 'crunch'],
  [/bridge|hip\s*thrust/, 'bridge'],
  [/plank|bear\s*hold/, 'plank'],
  [/greatest|spiderman|lunge\s*(with|and|&)\s*(twist|rotation|reach)/, 'wgs'],
  [/box\s*jump|jump\s*squat|squat\s*jump/, 'squat'],
  [/deep\s*squat|squat\s*hold|goblet\s*hold|malasana/, 'deepSquat'],
  [/squat/, 'squat'],
  [/lunge|split\s*squat|step.?back/, 'lunge'],
  [/jack/, 'jacks'],
  [/high\s*knee|knee\s*drive|butt\s*kick|sprint/, 'highKnees'],
  [/skater|lateral|side\s*(hop|shuffle)|shuffle/, 'skater'],
  [/boxing|punch|\bjab|uppercut|\bhooks?\b|\bcross\b/, 'boxing'],
  [/\bcat\b|\bcow\b|cat.?cow/, 'catCow'],
  [/thoracic|thread|rotation|twist|open\s*book/, 'thoracic'],
  [/quad/, 'quadStretch'],
  [/fold|hamstring|toe\s*touch|ragdoll/, 'forwardFold'],
  [/breath|child|savasana|relax/, 'breathing'],
  [/arm\s*circle|arm\s*swing|shoulder\s*roll/, 'armCircles'],
  [/hip\s*(open|circle)|leg\s*swing/, 'hipOpeners'],
  [/march|walk|step|jog/, 'march'],
  [/stretch/, 'forwardFold'],
];

/** Best animation for an exercise name (works for Bedrock-generated names too). */
export function animationFor(name: string, phase?: 'warmup' | 'main' | 'cooldown'): ExerciseAnimation {
  const n = name.toLowerCase();
  for (const [re, key] of MATCHERS) if (re.test(n)) return BY_KEY.get(key)!;
  return BY_KEY.get(phase === 'cooldown' ? 'breathing' : 'march')!;
}

/** Moves the phone camera counts reps for (keep in sync with backend/src/coach/formRules.ts). Others are holds or free movement. */
const REP_COUNTED = new Set([
  'squat', 'thruster', 'bandSquatPress', 'lunge', 'pushup', 'bridge', 'jacks', 'highKnees', 'march', 'climbers',
  'curl', 'press', 'deadlift', 'kbSwing', 'row', 'pullApart', 'burpee', 'skater', 'crunch', 'armCircles', 'boxing', 'dbHalo', 'kbHalo',
]);

/**
 * The key the form camera should coach for this move: its animation's key when we have a
 * dedicated one, otherwise 'other' (just "keep moving"), so an unknown move like "Butt Kicks"
 * isn't counted with marching rules.
 */
export function coachKeyFor(name: string, phase?: 'warmup' | 'main' | 'cooldown'): string {
  // Whole-body moves whose demo is only a stand-in: coach them as free movement, don't count.
  if (/inchworm|walk.?out|crawl|tuck\s*jump|star\s*jump|frog/i.test(name)) return 'other';
  return hasDedicatedAnimation(name) ? animationFor(name, phase).key : 'other';
}

export const countsReps = (coachKey: string) => REP_COUNTED.has(coachKey);

/** True when the name maps to a dedicated animation rather than the generic default. */
export function hasDedicatedAnimation(name: string): boolean {
  const n = name.toLowerCase();
  return MATCHERS.some(([re]) => re.test(n));
}
