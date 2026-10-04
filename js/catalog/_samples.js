// Reference demos used to validate the rig (not part of the catalog).
const STAND = { torso: 0, nearArm: [180, 180], nearLeg: [180, 180] };

export default [
  {
    id: 'sample-squat',
    name: 'Squat',
    impact: 'low',
    demo: {
      view: 'side',
      anchor: { joint: 'nearAnkle', x: 100 },
      focus: ['legs'],
      contacts: ['nearToe', 'nearAnkle'],
      keys: [
        { pose: { ...STAND, nearArm: [175, 175], farArm: [185, 185] }, dur: 1.0, hold: 0.2 },
        { pose: { torso: 32, nearArm: [88, 92], farArm: [92, 96], nearLeg: [100, 202], farLeg: [100, 202] }, dur: 1.0, hold: 0.25 },
      ],
    },
  },
  {
    id: 'sample-pushup',
    name: 'Push-up',
    impact: 'low',
    demo: {
      view: 'side',
      anchor: { joint: 'nearHand', x: 140 },
      focus: ['chest', 'arms'],
      contacts: ['nearHand', 'nearToe'],
      keys: [
        { pose: { torso: 70, nearArm: [180, 180], nearLeg: [250, 250], nearFoot: 170 }, dur: 0.9, hold: 0.15 },
        { pose: { torso: 86, nearArm: [285, 178], nearLeg: [266, 266], nearFoot: 172 }, dur: 0.9, hold: 0.15 },
      ],
    },
  },
  {
    id: 'sample-jacks',
    name: 'Jumping Jacks',
    impact: 'high',
    demo: {
      view: 'front',
      focus: ['full'],
      contacts: ['nearToe', 'farToe'],
      keys: [
        { pose: { nearArm: [172, 176], nearLeg: [178, 180] }, dur: 0.32, hold: 0.04 },
        { pose: { nearArm: [40, 15], nearLeg: [160, 165], lift: 6 }, dur: 0.32, hold: 0.04 },
      ],
    },
  },
  {
    id: 'sample-bridge',
    name: 'Glute Bridge',
    impact: 'low',
    demo: {
      view: 'side',
      anchor: { joint: 'nearAnkle', x: 130 },
      props: [{ type: 'mat' }],
      focus: ['glutes', 'core'],
      contacts: ['head', 'nearToe', 'nearAnkle'],
      keys: [
        { pose: { torso: 270, nearArm: [95, 95], nearLeg: [40, 160] }, dur: 1.0, hold: 0.2 },
        { pose: { torso: 250, head: 262, nearArm: [95, 95], nearLeg: [70, 175] }, dur: 1.0, hold: 0.4 },
      ],
    },
  },
];
