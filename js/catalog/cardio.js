// cardio movements — see docs/ARCHITECTURE.md (Movement schema).
//
// Pose notes (js/figure.js): angles are absolute screen degrees, 0 up, 90 forward (screen right),
// 180 down, 270 back. Knee flexion = shin - thigh; elbow flexion = upper - fore.
// Demos whose standing foot alternates (marching, curls, wall climbers, skaters) cannot name one
// joint that is down in every key, so their `contacts` list only what stays planted throughout
// (possibly none); the standing foot of each key is noted beside it instead.
// Keys marked `tween: true` are in-between poses; the reduced-motion key strip skips them.

/** Side view: swap near and far limbs (the other leg / arm leads). Poses must list both sides. */
const swap = (p) => ({
  ...p,
  nearArm: p.farArm,
  farArm: p.nearArm,
  nearLeg: p.farLeg,
  farLeg: p.nearLeg,
  nearFoot: p.farFoot,
  farFoot: p.nearFoot,
});

/** Front view: mirror left/right across the vertical axis. Poses must list both sides. */
const neg = (a) => a.map((v) => -v);
const mirror = (p) => ({
  ...p,
  torso: -(p.torso ?? 0),
  head: -(p.head ?? p.torso ?? 0),
  nearArm: neg(p.farArm),
  farArm: neg(p.nearArm),
  nearLeg: neg(p.farLeg),
  farLeg: neg(p.nearLeg),
  nearFoot: -(p.farFoot ?? -105),
  farFoot: -(p.nearFoot ?? 105),
  dx: -(p.dx ?? 0),
});

// ---- Running in place (side view, hip pinned). Arms pump opposite to the legs.
const ARM_FWD = [140, 52];
const ARM_BACK = [212, 122];
const ARM_PASS_A = [184, 100];
const ARM_PASS_B = [176, 92];

const KNEE_UP = {
  torso: 3,
  nearLeg: [88, 180], nearFoot: 140, // near knee driven to hip height
  farLeg: [180, 184], farFoot: 125, // far leg pushing off the ball of the foot
  nearArm: ARM_BACK, farArm: ARM_FWD,
  lift: 4,
};
const RUN_PASS = {
  torso: 2,
  nearLeg: [176, 184], nearFoot: 108,
  farLeg: [182, 186], farFoot: 108,
  nearArm: ARM_PASS_A, farArm: ARM_PASS_B,
};

// Alternating standing moves (march, hamstring curls, wall climbers) pass through two "hover" tweens:
// the lifted foot first stops just above the spot where it lands, then the weight shifts (that foot
// plants as the other lifts straight up). Feet therefore never skid along the floor.
const MARCH_UP = {
  torso: 0,
  nearLeg: [106, 188], nearFoot: 128, // stands on far foot
  farLeg: [180, 180], farFoot: 100,
  nearArm: [196, 118], farArm: [152, 72],
};
const MARCH_HOVER = {
  torso: 0,
  nearLeg: [155.9, 205.5], nearFoot: 104, // near foot hovering above its spot
  farLeg: [180, 180], farFoot: 100,
  nearArm: [180, 100], farArm: [180, 100],
};

const KICK_UP = {
  torso: 4,
  nearLeg: [194, 340], nearFoot: 262, // near heel kicked up to the seat
  farLeg: [178, 182], farFoot: 125,
  nearArm: ARM_BACK, farArm: ARM_FWD,
  lift: 4,
};

const CURL_UP = {
  torso: 3,
  nearLeg: [192, 300], nearFoot: 225, // stands on far foot, near heel curls back
  farLeg: [180, 181], farFoot: 100,
  nearArm: [208, 112], farArm: [208, 112], // elbows draw back
};
const CURL_HOVER = {
  torso: 1,
  nearLeg: [156.4, 206], nearFoot: 104, // near foot hovering above its spot
  farLeg: [180, 181], farFoot: 100,
  nearArm: [140, 96], farArm: [140, 96], // arms reach forward
};

// ---- Mountain climbers (side view, hands pinned).
const CLIMB_IN = {
  torso: 78, head: 82,
  nearArm: [178, 178], farArm: [178, 178],
  nearLeg: [156, 285], nearFoot: 230, // near knee driven in under the chest, foot off the floor
  farLeg: [245, 245], farFoot: 170,
};
const CLIMB_PASS = {
  torso: 82, head: 84, // legs scissor past each other; hips bob up slightly so the knees clear the floor
  nearArm: [184, 184], farArm: [184, 184],
  nearLeg: [230, 258], nearFoot: 200, // going back
  farLeg: [202, 281], farFoot: 205, // coming in
};
const PLANK = {
  torso: 72, head: 80,
  nearArm: [180, 180], farArm: [180, 180],
  nearLeg: [250, 250], nearFoot: 170,
  farLeg: [250, 250], farFoot: 170,
};
// Wall climbers (side view, hands pinned on a wall face at x 170).
const WALL_IN = {
  torso: 45, head: 55,
  nearArm: [100, 94], farArm: [100, 94],
  nearLeg: [112, 216], nearFoot: 118, // stands on far foot, near knee drives up
  farLeg: [202, 206], farFoot: 112,
};
const WALL_HOVER = {
  torso: 45, head: 55,
  nearArm: [100, 94], farArm: [100, 94],
  nearLeg: [183.3, 230.6], nearFoot: 112, // near foot hovering above its spot
  farLeg: [202, 206], farFoot: 112,
};

// ---- Skaters (front view). Landing on the near (screen-right) leg, far leg crossed behind.
const SKATE_LAND = {
  torso: 13, head: 6, // leans over the landing leg
  nearLeg: [163, 197], nearFoot: 105, // soft landing knee
  farLeg: [136, 148], farFoot: -150, // trailing leg sweeps behind and out, foot off the floor
  nearArm: [128, 142], farArm: [118, 92], // arms swing across toward the landing side
  dx: 21,
};
const SKATE_AIR = {
  torso: 0, head: 0,
  nearLeg: [150, 160], nearFoot: 110, // trailing leg after the push
  farLeg: [-170, -176], farFoot: -105, // leading leg reaching for the landing
  nearArm: [165, 170], farArm: [-165, -170],
  lift: 12,
  dx: 0,
};
// Skater steps (low impact): stand on one foot, the other sweeps behind it; that foot then swings
// out to hover above its own spot, the weight shifts onto it, and the first foot sweeps behind.
// The standing foot is pinned per key, so neither foot ever skids.
const SKATE_SWEEP = {
  torso: 8, head: 4,
  nearLeg: [156.4, -157.7], nearFoot: 105, // standing on the near foot (x 124)
  farLeg: [-167.1, 122.8], farFoot: -130, // far foot swept up behind the standing leg
  nearArm: [140, 150], farArm: [128, 104], // arms swing across toward the standing side
};
const SKATE_HOVER = {
  torso: 3, head: 2,
  nearLeg: [157.9, -178.2], nearFoot: 105, // near foot still planted
  farLeg: [-138.9, 170.5], farFoot: -110, // far foot hovering above its spot (x 76)
  nearArm: [168, 174], farArm: [-172, -178],
};

// ---- Burpees (side view, hands pinned at x 150; the jump key uses dx to stay over the feet).
// KICK_BACK is the mid-jump tuck: hips high, feet off the floor, so the hands stay planted.
const CROUCH = {
  torso: 62, head: 72,
  nearArm: [173, 173], farArm: [173, 173],
  nearLeg: [98, 234], nearFoot: 111,
  farLeg: [98, 234], farFoot: 111,
};
const KICK_BACK = {
  torso: 105, head: 100,
  nearArm: [185, 185], farArm: [185, 185],
  nearLeg: [175, 268], nearFoot: 172,
  farLeg: [175, 268], farFoot: 172,
};

// Step-back burpee (side view, far toes pinned). Tuned so the hands stay planted while each foot
// steps: the hips stay high enough for the stepping leg to pass under them.
const SB_DOWN = {
  torso: 124, head: 125,
  nearArm: [162, 162], farArm: [162, 162],
  nearLeg: [185, 225], nearFoot: 140,
  farLeg: [185, 225], farFoot: 140,
};
const SB_ONE_BACK = {
  torso: 107, head: 102,
  nearArm: [175, 175], farArm: [175, 175],
  nearLeg: [225, 225], nearFoot: 177, // near foot stepped back
  farLeg: [195, 230], farFoot: 114,
};
const SB_PLANK = {
  torso: 81, head: 80,
  nearArm: [189, 189], farArm: [189, 189],
  nearLeg: [244, 244], nearFoot: 168,
  farLeg: [244, 244], farFoot: 168,
  dx: -27,
};
const SB_ONE_IN = {
  torso: 101, head: 100,
  nearArm: [181, 181], farArm: [181, 181],
  nearLeg: [197, 239], nearFoot: 116, // near foot stepped back in
  farLeg: [230, 230], farFoot: 180,
  dx: -27,
};

// ---- Inchworm (side view, toes pinned).
const FOLD = {
  torso: 124, head: 140,
  nearArm: [184, 180], farArm: [184, 180],
  nearLeg: [179, 188], farLeg: [179, 188],
};
const WALK_OUT = {
  torso: 118, head: 126,
  nearArm: [168, 168], farArm: [193, 178],
  nearLeg: [210, 210], nearFoot: 127,
  farLeg: [210, 210], farFoot: 127,
};
const WORM_PLANK = {
  torso: 74, head: 82,
  nearArm: [178, 178], farArm: [178, 178],
  nearLeg: [248, 248], nearFoot: 170,
  farLeg: [248, 248], farFoot: 170,
};

export default [
  // ------------------------------------------------------------------ 1. Jumping jacks
  {
    id: 'jumping-jacks',
    name: 'Jumping Jacks',
    say: 'Jumping jacks',
    category: 'cardio',
    region: 'full',
    pattern: 'jump',
    impact: 'high',
    equipment: 'none',
    setup: 'Stand tall with feet together and arms by your sides.',
    cue: 'Jump feet wide as your arms sweep overhead.',
    mistake: 'Landing flat-footed with locked knees.',
    caution: 'Land softly on the balls of your feet.',
    description:
      'Figure jumps the feet out wide while sweeping both arms overhead, then jumps back to feet together with arms down.',
    demo: {
      view: 'front',
      focus: ['full'],
      contacts: ['nearToe', 'farToe'],
      keys: [
        { pose: { nearArm: [174, 178], nearLeg: [179, 180] }, dur: 0.15, hold: 0.04, ease: 'out' },
        { pose: { nearArm: [100, 92], nearLeg: [168, 172], lift: 8 }, dur: 0.15, hold: 0, ease: 'in', tween: true },
        { pose: { nearArm: [28, 12], nearLeg: [160, 166] }, dur: 0.15, hold: 0.04, ease: 'out' },
        { pose: { nearArm: [100, 104], nearLeg: [168, 172], lift: 8 }, dur: 0.15, hold: 0, ease: 'in', tween: true },
      ],
    },
    alt: {
      name: 'Step Jacks',
      cue: 'Step one foot out as both arms rise overhead.',
      equipment: 'none',
      description:
        'Figure steps one foot out to the side while raising both arms overhead, steps back in, then repeats to the other side.',
      demo: {
        // The standing foot is pinned per key; the stepping foot lifts above its spot, steps out, comes
        // back to hover there, and the weight shifts so the other foot lifts straight up.
        view: 'front',
        anchor: { joint: 'farAnkle', x: 92.5 },
        focus: ['legs', 'arms'],
        contacts: ['farToe', 'farAnkle'],
        keys: [
          { pose: { torso: 0, nearArm: [174, 178], nearLeg: [150.3, 211.5], farLeg: [187, 172.6], nearFoot: 112, farFoot: -105 }, dur: 0.4, hold: 0.05 },
          { pose: { torso: 0, nearArm: [28, 12], nearLeg: [160.7, 179.9], farLeg: [197.8, 172.3], nearFoot: 110, farFoot: -105 }, dur: 0.4, hold: 0.15, contacts: ['nearToe', 'farToe'] },
          { pose: { torso: 0, nearArm: [96, 100], nearLeg: [150.3, 211.5], farLeg: [187, 172.6], nearFoot: 112, farFoot: -105 }, dur: 0.2, hold: 0, tween: true },
          { pose: { torso: 0, nearArm: [174, 178], nearLeg: [173, 187.4], farLeg: [209.7, 148.5], nearFoot: 105, farFoot: -112 }, dur: 0.4, hold: 0.05, anchor: { joint: 'nearAnkle', x: 107.5 }, contacts: ['nearToe', 'nearAnkle'] },
          { pose: { torso: 0, nearArm: [28, 12], nearLeg: [162.2, 187.7], farLeg: [199.3, 180.1], nearFoot: 105, farFoot: -110 }, dur: 0.4, hold: 0.15, anchor: { joint: 'nearAnkle', x: 107.5 }, contacts: ['nearToe', 'farToe'] },
          { pose: { torso: 0, nearArm: [96, 100], nearLeg: [173, 187.4], farLeg: [209.7, 148.5], nearFoot: 105, farFoot: -112 }, dur: 0.2, hold: 0, tween: true, anchor: { joint: 'nearAnkle', x: 107.5 }, contacts: ['nearToe', 'nearAnkle'] },
        ],
      },
    },
  },

  // ------------------------------------------------------------------ 2. High knees
  {
    id: 'high-knees',
    name: 'High Knees',
    say: 'High knees',
    category: 'cardio',
    region: 'full',
    pattern: 'run',
    impact: 'high',
    equipment: 'none',
    setup: 'Stand tall with feet hip-width apart and elbows bent.',
    cue: 'Drive each knee up to hip height, switching quickly.',
    mistake: 'Leaning back as the knees come up.',
    caution: 'Stay light on the balls of your feet.',
    description:
      'Figure runs in place, driving the knees up to hip height one at a time while the arms pump in opposition.',
    demo: {
      view: 'side',
      focus: ['legs', 'core'],
      contacts: ['nearToe', 'farToe'],
      keys: [
        { pose: KNEE_UP, dur: 0.14, hold: 0.02, ease: 'in' },
        { pose: RUN_PASS, dur: 0.14, hold: 0, ease: 'out', tween: true },
        { pose: swap(KNEE_UP), dur: 0.14, hold: 0.02, ease: 'in' },
        { pose: swap(RUN_PASS), dur: 0.14, hold: 0, ease: 'out', tween: true },
      ],
    },
    alt: {
      name: 'Marching Knee Lifts',
      cue: 'March in place, lifting each knee toward hip height.',
      equipment: 'none',
      description:
        'Figure marches in place, lifting one knee at a time toward hip height while the other foot stays on the floor and the arms swing.',
      demo: {
        view: 'side',
        focus: ['legs', 'core'],
        contacts: ['farToe', 'farAnkle'],
        keys: [
          { pose: MARCH_UP, dur: 0.38, hold: 0.12 }, // stands on far foot
          { pose: MARCH_HOVER, dur: 0.16, hold: 0, tween: true },
          { pose: swap(MARCH_HOVER), dur: 0.38, hold: 0, tween: true, contacts: ['nearToe', 'nearAnkle'] },
          { pose: swap(MARCH_UP), dur: 0.38, hold: 0.12, contacts: ['nearToe', 'nearAnkle'] }, // stands on near foot
          { pose: swap(MARCH_HOVER), dur: 0.16, hold: 0, tween: true, contacts: ['nearToe', 'nearAnkle'] },
          { pose: MARCH_HOVER, dur: 0.38, hold: 0, tween: true },
        ],
      },
    },
  },

  // ------------------------------------------------------------------ 3. Mountain climbers
  {
    id: 'mountain-climbers',
    name: 'Mountain Climbers',
    say: 'Mountain climbers',
    category: 'cardio',
    region: 'full',
    pattern: 'climber',
    impact: 'low',
    equipment: 'none',
    setup: 'Start in a high plank with hands under your shoulders.',
    cue: 'Drive one knee toward your chest, then switch.',
    mistake: 'Letting the hips pike up or sag toward the floor.',
    caution: 'Slow down if your wrists or shoulders need a break.',
    description:
      'Figure holds a high plank and drives the knees toward the chest one at a time at a quick pace.',
    demo: {
      view: 'side',
      anchor: { joint: 'nearHand', x: 145 },
      focus: ['core', 'legs'],
      contacts: ['nearHand', 'farHand'],
      keys: [
        { pose: CLIMB_IN, dur: 0.18, hold: 0.04, ease: 'in' },
        { pose: CLIMB_PASS, dur: 0.18, hold: 0, ease: 'out', tween: true },
        { pose: swap(CLIMB_IN), dur: 0.18, hold: 0.04, ease: 'in' },
        { pose: swap(CLIMB_PASS), dur: 0.18, hold: 0, ease: 'out', tween: true },
      ],
    },
    alt: {
      name: 'Wall Climbers',
      cue: 'Hands on a wall, drive one knee up, then switch.',
      equipment: 'wall',
      description:
        'Figure leans into a wall with straight arms and drives one knee up toward the chest at a time while the other foot stays on the floor.',
      demo: {
        view: 'side',
        anchor: { joint: 'nearHand', x: 165.4 },
        props: [{ type: 'wall', x: 170 }],
        focus: ['core', 'legs'],
        contacts: ['farToe'],
        keys: [
          { pose: WALL_IN, dur: 0.36, hold: 0.15 }, // stands on far foot
          { pose: WALL_HOVER, dur: 0.16, hold: 0, tween: true },
          { pose: swap(WALL_HOVER), dur: 0.36, hold: 0, tween: true, contacts: ['nearToe'] },
          { pose: swap(WALL_IN), dur: 0.36, hold: 0.15, contacts: ['nearToe'] }, // stands on near foot
          { pose: swap(WALL_HOVER), dur: 0.16, hold: 0, tween: true, contacts: ['nearToe'] },
          { pose: WALL_HOVER, dur: 0.36, hold: 0, tween: true },
        ],
      },
    },
  },

  // ------------------------------------------------------------------ 4. Squat jumps
  {
    id: 'squat-jumps',
    name: 'Squat Jumps',
    say: 'Squat jumps',
    category: 'cardio',
    region: 'legs',
    pattern: 'squat',
    impact: 'high',
    equipment: 'none',
    setup: 'Stand with feet shoulder-width apart, arms at your sides.',
    cue: 'Sit back into a squat, then jump straight up.',
    mistake: 'Landing with stiff legs or knees falling inward.',
    caution: 'Land softly and sink straight into the next squat.',
    description:
      'Figure lowers into a squat with the arms swinging back, jumps straight up with the arms reaching high, and lands softly back into a squat.',
    demo: {
      view: 'side',
      anchor: { joint: 'nearAnkle', x: 96 },
      focus: ['legs'],
      contacts: ['nearToe'],
      keys: [
        { pose: { torso: 35, head: 25, nearArm: [215, 205], nearLeg: [100, 205] }, dur: 0.24, hold: 0.1, ease: 'in' },
        { pose: { torso: 10, nearArm: [95, 80], nearLeg: [165, 190], nearFoot: 130 }, dur: 0.14, hold: 0, ease: 'out', tween: true },
        { pose: { torso: 2, nearArm: [50, 38], nearLeg: [180, 182], nearFoot: 138, lift: 8 }, dur: 0.26, hold: 0.04, ease: 'in' },
        { pose: { torso: 22, nearArm: [120, 100], nearLeg: [140, 205] }, dur: 0.38, hold: 0 },
      ],
    },
    alt: {
      name: 'Squat to Calf Raise',
      cue: 'Squat down, then stand and rise onto your toes.',
      equipment: 'none',
      description:
        'Figure lowers into a squat with arms forward, then stands tall and rises onto the toes with arms reaching up.',
      demo: {
        view: 'side',
        anchor: { joint: 'nearToe', x: 104 },
        focus: ['legs', 'calves'],
        contacts: ['nearToe'],
        keys: [
          { pose: { torso: 32, nearArm: [92, 90], nearLeg: [100, 202] }, dur: 0.9, hold: 0.2 },
          { pose: { torso: 0, nearArm: [40, 30], nearLeg: [180, 180], nearFoot: 145 }, dur: 0.9, hold: 0.3 },
        ],
      },
    },
  },

  // ------------------------------------------------------------------ 5. Skaters
  {
    id: 'skaters',
    name: 'Skaters',
    say: 'Skaters',
    category: 'cardio',
    region: 'full',
    pattern: 'lateral',
    impact: 'high',
    equipment: 'none',
    setup: 'Stand on one leg with a soft knee, ready to hop sideways.',
    cue: 'Bound side to side, sweeping the back leg behind.',
    mistake: 'Landing on a straight, stiff knee.',
    caution: 'Land softly, and shorten the hop if you need to.',
    description:
      'Figure hops sideways from one foot to the other, landing softly while the trailing leg sweeps behind and the arms swing across.',
    demo: {
      view: 'front',
      focus: ['legs'],
      contacts: [],
      keys: [
        { pose: SKATE_LAND, dur: 0.2, hold: 0.08, ease: 'linear' }, // lands on near foot
        { pose: SKATE_AIR, dur: 0.2, hold: 0, ease: 'linear' },
        { pose: mirror(SKATE_LAND), dur: 0.2, hold: 0.08, ease: 'linear' }, // lands on far foot
        { pose: mirror(SKATE_AIR), dur: 0.2, hold: 0, ease: 'linear', tween: true },
      ],
    },
    alt: {
      name: 'Skater Steps',
      cue: 'Step to the side and sweep the other foot behind.',
      equipment: 'none',
      description:
        'Front view. The figure steps out to one side and sweeps the trailing foot up behind the standing leg, then steps back the other way, arms swinging across the body.',
      demo: {
        view: 'front',
        anchor: { joint: 'nearAnkle', x: 124 },
        focus: ['legs'],
        contacts: ['nearToe', 'nearAnkle'],
        keys: [
          { pose: SKATE_SWEEP, dur: 0.42, hold: 0.18 },
          { pose: SKATE_HOVER, dur: 0.2, hold: 0, tween: true },
          { pose: mirror(SKATE_HOVER), dur: 0.42, hold: 0, tween: true, anchor: { joint: 'farAnkle', x: 76 }, contacts: ['farToe', 'farAnkle'] },
          { pose: mirror(SKATE_SWEEP), dur: 0.42, hold: 0.18, anchor: { joint: 'farAnkle', x: 76 }, contacts: ['farToe', 'farAnkle'] },
          { pose: mirror(SKATE_HOVER), dur: 0.2, hold: 0, tween: true, anchor: { joint: 'farAnkle', x: 76 }, contacts: ['farToe', 'farAnkle'] },
          { pose: SKATE_HOVER, dur: 0.42, hold: 0, tween: true },
        ],
      },
    },
  },

  // ------------------------------------------------------------------ 6. Burpees
  {
    id: 'burpees',
    name: 'Burpees',
    say: 'Burpees',
    category: 'cardio',
    region: 'full',
    pattern: 'burpee',
    impact: 'high',
    equipment: 'none',
    setup: 'Stand with feet hip-width apart and room behind you.',
    cue: 'Squat, jump back to plank, jump in, then jump up.',
    mistake: 'Letting the hips sag in the plank.',
    caution: 'Step back instead of jumping whenever you need to.',
    description:
      'Figure squats and places the hands down, jumps the feet back to a plank, jumps them back in, then jumps up reaching high.',
    demo: {
      view: 'side',
      anchor: { joint: 'nearHand', x: 150 },
      focus: ['full'],
      contacts: ['nearHand', 'farHand'],
      keys: [
        { pose: CROUCH, dur: 0.32, hold: 0.25, ease: 'in' },
        { pose: KICK_BACK, dur: 0.25, hold: 0, ease: 'out', tween: true }, // jumping the feet back
        { pose: PLANK, dur: 0.28, hold: 0.45, ease: 'in' },
        { pose: KICK_BACK, dur: 0.25, hold: 0, ease: 'out', tween: true }, // jumping the feet in
        { pose: CROUCH, dur: 0.38, hold: 0.15, ease: 'out' },
        { pose: { torso: 2, nearArm: [50, 38], nearLeg: [180, 182], nearFoot: 138, lift: 8, dx: -22 }, dur: 0.42, hold: 0.04, ease: 'in' },
      ],
    },
    alt: {
      name: 'Step-back Burpee',
      cue: 'Hands down, step back to plank, step in, stand tall.',
      equipment: 'none',
      description:
        'Figure bends down to place the hands on the floor, steps one foot at a time back to a plank, steps back in, and stands tall reaching up.',
      demo: {
        view: 'side',
        anchor: { joint: 'farToe', x: 62 },
        focus: ['full'],
        contacts: ['nearToe', 'farToe'],
        keys: [
          { pose: { torso: 2, nearArm: [22, 14], nearLeg: [180, 180] }, dur: 0.7, hold: 0.25 },
          { pose: SB_DOWN, dur: 0.55, hold: 0.1 },
          { pose: SB_ONE_BACK, dur: 0.55, hold: 0.1 },
          { pose: SB_PLANK, dur: 0.55, hold: 0.25 },
          { pose: SB_ONE_IN, dur: 0.55, hold: 0.1 },
          { pose: SB_DOWN, dur: 0.7, hold: 0.1, tween: true },
        ],
      },
    },
  },

  // ------------------------------------------------------------------ 7. Butt kicks
  {
    id: 'butt-kicks',
    name: 'Butt Kicks',
    say: 'Butt kicks',
    category: 'cardio',
    region: 'full',
    pattern: 'run',
    impact: 'high',
    equipment: 'none',
    setup: 'Stand tall with feet hip-width apart and elbows bent.',
    cue: 'Jog in place, kicking your heels up behind you.',
    mistake: 'Leaning forward from the waist.',
    caution: 'Stay light on the balls of your feet.',
    description:
      'Figure jogs in place, kicking each heel up toward the seat while the arms pump in opposition.',
    demo: {
      view: 'side',
      focus: ['legs'],
      contacts: ['nearToe', 'farToe'],
      keys: [
        { pose: KICK_UP, dur: 0.14, hold: 0.02, ease: 'in' },
        { pose: RUN_PASS, dur: 0.14, hold: 0, ease: 'out', tween: true },
        { pose: swap(KICK_UP), dur: 0.14, hold: 0.02, ease: 'in' },
        { pose: swap(RUN_PASS), dur: 0.14, hold: 0, ease: 'out', tween: true },
      ],
    },
    alt: {
      name: 'Hamstring Curls',
      cue: 'Curl one heel up toward your seat, then switch.',
      equipment: 'none',
      description:
        'Figure stands tall and curls one heel up behind at a time while drawing the elbows back, keeping the other foot on the floor.',
      demo: {
        view: 'side',
        focus: ['legs'],
        contacts: ['farToe', 'farAnkle'],
        keys: [
          { pose: CURL_UP, dur: 0.42, hold: 0.12 }, // stands on far foot
          { pose: CURL_HOVER, dur: 0.16, hold: 0, tween: true },
          { pose: swap(CURL_HOVER), dur: 0.42, hold: 0, tween: true, contacts: ['nearToe', 'nearAnkle'] },
          { pose: swap(CURL_UP), dur: 0.42, hold: 0.12, contacts: ['nearToe', 'nearAnkle'] }, // stands on near foot
          { pose: swap(CURL_HOVER), dur: 0.16, hold: 0, tween: true, contacts: ['nearToe', 'nearAnkle'] },
          { pose: CURL_HOVER, dur: 0.42, hold: 0, tween: true },
        ],
      },
    },
  },

  // ------------------------------------------------------------------ 8. Shadow boxing
  {
    id: 'shadow-boxing',
    name: 'Shadow Boxing',
    say: 'Shadow boxing',
    category: 'cardio',
    region: 'full',
    pattern: 'punch',
    impact: 'low',
    equipment: 'none',
    setup: 'Stand in a staggered stance with fists up by your chin.',
    cue: 'Punch straight ahead, alternating arms, staying light.',
    mistake: 'Snapping the elbow straight at full reach.',
    description:
      'Figure stands in a staggered stance with fists up and throws alternating straight punches with a light bounce in the knees.',
    demo: {
      view: 'side',
      anchor: { joint: 'nearToe', x: 122 },
      focus: ['arms', 'shoulders'],
      contacts: ['nearToe', 'farToe'],
      keys: [
        { pose: { torso: 8, nearArm: [88, 81], farArm: [150, 30], nearLeg: [169, 187], farLeg: [205, 210], farFoot: 140 }, dur: 0.22, hold: 0.04 },
        { pose: { torso: 6, nearArm: [150, 30], farArm: [160, 40], nearLeg: [163, 194], farLeg: [198, 220], farFoot: 140 }, dur: 0.22, hold: 0.02 },
        { pose: { torso: 10, nearArm: [150, 30], farArm: [86, 79], nearLeg: [169, 187], farLeg: [205, 210], farFoot: 140 }, dur: 0.22, hold: 0.04 },
        { pose: { torso: 6, nearArm: [150, 30], farArm: [160, 40], nearLeg: [163, 194], farLeg: [198, 220], farFoot: 140 }, dur: 0.22, hold: 0.02, tween: true },
      ],
    },
    alt: {
      name: 'Slow Punches',
      cue: 'Feet planted, punch slowly and return to guard.',
      equipment: 'none',
      description:
        'Side view. The figure stands steady in a staggered stance with fists up and throws slow, alternating straight punches, bringing each fist back to guard. The feet stay planted.',
      demo: {
        view: 'side',
        anchor: { joint: 'nearToe', x: 122 },
        focus: ['arms', 'shoulders'],
        contacts: ['nearToe', 'farToe'],
        keys: [
          { pose: { torso: 4, nearArm: [150, 30], farArm: [160, 40], nearLeg: [169, 187], farLeg: [205, 210], farFoot: 140 }, dur: 0.45, hold: 0.15 },
          { pose: { torso: 8, nearArm: [88, 81], farArm: [160, 40], nearLeg: [169, 187], farLeg: [205, 210], farFoot: 140 }, dur: 0.45, hold: 0.15 },
          { pose: { torso: 4, nearArm: [150, 30], farArm: [160, 40], nearLeg: [169, 187], farLeg: [205, 210], farFoot: 140 }, dur: 0.45, hold: 0.15, tween: true },
          { pose: { torso: 9, nearArm: [150, 30], farArm: [86, 79], nearLeg: [169, 187], farLeg: [205, 210], farFoot: 140 }, dur: 0.45, hold: 0.15 },
        ],
      },
    },
  },

  // ------------------------------------------------------------------ 9. Inchworm
  {
    id: 'inchworm',
    name: 'Inchworm',
    say: 'Inchworms',
    category: 'cardio',
    region: 'full',
    pattern: 'crawl',
    impact: 'low',
    equipment: 'none',
    setup: 'Stand tall with feet hip-width apart.',
    cue: 'Fold forward, walk your hands out to plank and back.',
    mistake: 'Letting the hips sag when the hands reach the plank.',
    caution: 'Bend your knees as much as you need to reach the floor.',
    description:
      'Figure folds forward to place the hands on the floor, walks the hands out to a plank, walks them back to the feet, and stands up.',
    demo: {
      view: 'side',
      anchor: { joint: 'nearToe', x: 38 },
      focus: ['full'],
      contacts: ['nearToe', 'farToe'],
      keys: [
        { pose: { torso: 0, nearArm: [180, 180], nearLeg: [180, 180] }, dur: 0.6, hold: 0.2 },
        { pose: FOLD, dur: 0.5, hold: 0.1 },
        { pose: WALK_OUT, dur: 0.5, hold: 0.05 },
        { pose: WORM_PLANK, dur: 0.5, hold: 0.3 },
        { pose: swap(WALK_OUT), dur: 0.5, hold: 0.05, tween: true },
        { pose: FOLD, dur: 0.6, hold: 0.1, tween: true },
      ],
    },
    alt: {
      name: 'Half Inchworm',
      cue: 'Bend your knees, walk your hands out partway and back.',
      equipment: 'none',
      description:
        'Figure bends the knees to place the hands on the floor, walks the hands out partway with the hips high, walks them back, and stands up.',
      demo: {
        view: 'side',
        anchor: { joint: 'nearToe', x: 55 },
        focus: ['full'],
        contacts: ['nearToe', 'farToe'],
        keys: [
          { pose: { torso: 0, nearArm: [180, 180], nearLeg: [180, 180] }, dur: 0.8, hold: 0.2 },
          { pose: { torso: 116, head: 130, nearArm: [182, 180], nearLeg: [158, 202] }, dur: 0.7, hold: 0.15 },
          { pose: { torso: 118, head: 126, nearArm: [165, 165], farArm: [188, 180], nearLeg: [180, 212], nearFoot: 118 }, dur: 0.7, hold: 0.3 },
          { pose: { torso: 116, head: 130, nearArm: [182, 180], nearLeg: [158, 202] }, dur: 0.8, hold: 0.15, tween: true },
        ],
      },
    },
  },
];
