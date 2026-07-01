/**
 * Constants.js — Single source of truth for the entire game.
 *
 * COORDINATE SYSTEM (right-handed, Y up):
 *   +Y  = up (floor top surface is at Y = 0)
 *   ±X  = court LENGTH (baseline to baseline). Range [-COURT.halfLength, +COURT.halfLength].
 *   ±Z  = court WIDTH  (sideline to sideline).  Range [-COURT.halfWidth,  +COURT.halfWidth].
 *
 * Units are METERS, based on NBA regulation dimensions.
 *
 * HOME team defends the -X basket and attacks the +X basket.
 * AWAY team defends the +X basket and attacks the -X basket.
 * (i.e. a team's OWN hoop is the one it shoots AT.)
 */

// ---------------------------------------------------------------------------
// Court (NBA regulation: 94 ft x 50 ft)
// ---------------------------------------------------------------------------
export const COURT = {
  length: 28.65,          // 94 ft
  width: 15.24,           // 50 ft
  halfLength: 14.325,
  halfWidth: 7.62,
  thickness: 0.30,        // visual slab thickness below Y=0
  lineWidth: 0.05,        // painted line width (5 cm)

  keyWidth: 4.88,         // paint / lane width (16 ft)
  keyLength: 5.79,        // baseline to free-throw line (19 ft)
  freeThrowRadius: 1.80,  // 6 ft
  centerCircleRadius: 1.83,
  restrictedRadius: 1.22, // restricted-area arc (4 ft)

  threePointRadius: 7.24,     // 23.75 ft (top of arc, from basket center)
  cornerThreeFromSideline: 0.914, // 3 ft — corner-3 line offset from sideline

  // Colors
  woodColor: 0xcaa472,
  woodColorDark: 0xb08d5a,
  lineColor: 0xffffff,
  paintColor: 0xc0432f,   // colored key / paint
  logoColor: 0x203a5f,
  outOfBoundsMargin: 2.2, // apron of floor outside the lines
};

// ---------------------------------------------------------------------------
// Hoop / basket
// ---------------------------------------------------------------------------
export const HOOP = {
  rimRadius: 0.2286,          // 18 in diameter
  rimTubeRadius: 0.018,
  rimHeight: 3.048,           // 10 ft (top of rim plane)
  rimCenterFromBaseline: 1.60,// rim center is 5 ft 3 in from baseline
  rimColor: 0xff5a1f,

  backboardWidth: 1.829,      // 6 ft
  backboardHeight: 1.067,     // 3.5 ft
  backboardThickness: 0.04,
  backboardBottomHeight: 2.90,// bottom edge height
  backboardFromBaseline: 1.22,// 4 ft (front face distance from baseline)
  backboardSquareColor: 0xd23b2a,

  netLength: 0.45,
  netSegments: 12,            // radial segments around the rim
  netRings: 8,                // vertical rings

  poleColor: 0x2b2f36,
};

// Derived hoop world positions (rim center X, backboard X) for each side.
// side = -1 → HOME hoop (-X baseline);  side = +1 → AWAY hoop (+X baseline).
export function rimCenterX(side) {
  return side * (COURT.halfLength - HOOP.rimCenterFromBaseline); // ±12.725
}
export function backboardX(side) {
  return side * (COURT.halfLength - HOOP.backboardFromBaseline); // ±13.105
}
// The 3-D world position of a rim's center for a given side.
export function rimPosition(side) {
  return { x: rimCenterX(side), y: HOOP.rimHeight, z: 0 };
}

// ---------------------------------------------------------------------------
// Ball
// ---------------------------------------------------------------------------
export const BALL = {
  radius: 0.119,          // ~29.5 in circumference
  mass: 0.62,
  color: 0xd0651f,
  seamColor: 0x1a1a1a,
  restitutionFloor: 0.74,
  restitutionRim: 0.55,
  restitutionBackboard: 0.48,
  airDrag: 0.012,
  spinDamping: 0.98,
};

// ---------------------------------------------------------------------------
// Physics
// ---------------------------------------------------------------------------
export const PHYSICS = {
  gravity: 9.81,
  fixedStep: 1 / 120,     // physics sub-step (s)
  maxSubSteps: 8,
};

// ---------------------------------------------------------------------------
// Player (humanoid model + movement)
// ---------------------------------------------------------------------------
export const PLAYER = {
  height: 1.98,           // total standing height
  // segment sizes (approx, in meters) — used by the articulated model
  headRadius: 0.13,
  torsoHeight: 0.62,
  torsoWidth: 0.42,
  torsoDepth: 0.24,
  upperArm: 0.30,
  foreArm: 0.30,
  thigh: 0.46,
  shin: 0.46,
  limbRadius: 0.06,
  hipHeight: 0.98,        // pelvis height when standing

  moveSpeed: 6.2,         // m/s max run
  sprintSpeed: 8.0,
  accel: 34,
  friction: 12,
  turnRate: 12,           // rad/s model yaw slew

  reach: 1.1,             // arm reach for steals/blocks
  jumpVelocity: 4.2,
};

// ---------------------------------------------------------------------------
// Gameplay / rules
// ---------------------------------------------------------------------------
export const RULES = {
  quarterSeconds: 720,    // 12:00 (can be shortened by settings)
  quarters: 4,
  shotClockSeconds: 24,
  inboundSeconds: 5,
  teamSize: 5,            // 5-on-5
  madeTwoPoints: 2,
  madeThreePoints: 3,
};

// ---------------------------------------------------------------------------
// Teams (generic, non-licensed, city-flavored)
// ---------------------------------------------------------------------------
export const TEAMS = [
  { key: 'metro',   city: 'Metro City', name: 'Voltage',  abbr: 'MTR', primary: 0x1d64d8, secondary: 0xf5c518, trim: 0xffffff },
  { key: 'coastal', city: 'Bayline',    name: 'Tide',     abbr: 'BAY', primary: 0x0e9d78, secondary: 0x0b2a3a, trim: 0xffffff },
  { key: 'summit',  city: 'Summit',     name: 'Peaks',    abbr: 'SMT', primary: 0x8e2de2, secondary: 0xf0f0f0, trim: 0xffd23f },
  { key: 'ember',   city: 'Kiln',       name: 'Blaze',    abbr: 'KLN', primary: 0xe23b2a, secondary: 0x1a1a1a, trim: 0xffa41b },
  { key: 'frost',   city: 'North Point',name: 'Glaciers', abbr: 'NPG', primary: 0x2fb4e8, secondary: 0x102a43, trim: 0xffffff },
  { key: 'iron',    city: 'Forge',      name: 'Ironworks', abbr: 'FRG', primary: 0x6b7280, secondary: 0xf59e0b, trim: 0x111111 },
];

// ---------------------------------------------------------------------------
// Rendering / visual palette
// ---------------------------------------------------------------------------
export const VISUAL = {
  skyTop: 0x0a0d16,
  skyBottom: 0x161a26,
  crowdSeatColor: 0x14171f,
  standsColor: 0x1b1f2a,
  floorApronColor: 0x111318,
  exposure: 1.05,
  fogColor: 0x0a0d16,
  fogNear: 40,
  fogFar: 120,
};

// Skin-tone palette for procedural players (varied).
export const SKIN_TONES = [
  0x5a3a26, 0x7a4a2f, 0x8d5524, 0xa9743f, 0xc68642, 0xe0ac69, 0xf1c27d, 0xffdbac,
];

// Shooting feel (arcade-realistic)
export const SHOOTING = {
  perfectWindow: 0.06,    // fraction of meter travel considered "perfect"
  goodWindow: 0.16,
  baseArc: 1.15,          // arc height multiplier
  releaseTime: 0.42,      // s from shot start to release
  maxRange: 9.5,          // beyond this, accuracy falls off hard
};
