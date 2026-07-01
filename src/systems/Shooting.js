/**
 * Shooting.js — projectile math shared by the user controller and the AI.
 *
 * Shots compute a launch velocity toward the rim with an ERROR that grows as
 * shot quality drops, so the physics engine naturally resolves makes/misses
 * (and satisfying rim/backboard bounces) rather than scripting the outcome.
 */
import * as THREE from 'three';
import { PHYSICS, SHOOTING } from '../config/Constants.js';

const g = PHYSICS.gravity;

// standard-normal-ish sample in ~[-1.5,1.5]
function randn() { return (Math.random() + Math.random() + Math.random() - 1.5) / 1.5; }

/**
 * Velocity that carries a projectile from `from` to `to` in flight time `t`.
 */
export function solveArc(from, to, t) {
  return new THREE.Vector3(
    (to.x - from.x) / t,
    (to.y - from.y) / t + 0.5 * g * t,
    (to.z - from.z) / t,
  );
}

/** A pleasing arc time for a shot of the given horizontal distance. */
export function arcTime(horizDist, boost = 1) {
  return THREE.MathUtils.clamp((0.62 + horizDist * 0.085) * boost, 0.7, 1.6);
}

/**
 * Compute a shot velocity.
 * @param from   release position (Vector3)
 * @param rim    rim center (Vector3)
 * @param quality 0..1 (1 = perfect release, wide open, in range)
 */
export function computeShot(from, rim, quality) {
  const q = THREE.MathUtils.clamp(quality, 0, 1);
  const horiz = Math.hypot(rim.x - from.x, rim.z - from.z);
  const t = arcTime(horiz, SHOOTING.baseArc);
  const aim = new THREE.Vector3(rim.x, rim.y + 0.03, rim.z);
  const vel = solveArc(from, aim, t);

  const e = 1 - q;
  // depth (short/long): scale horizontal component
  const depth = 1 + randn() * 0.075 * e;
  vel.x *= depth; vel.z *= depth;
  // lateral: rotate horizontal velocity a touch
  const ang = randn() * 0.06 * e;
  const cx = Math.cos(ang), sx = Math.sin(ang);
  const vx = vel.x * cx - vel.z * sx;
  const vz = vel.x * sx + vel.z * cx;
  vel.x = vx; vel.z = vz;
  // vertical jitter
  vel.y *= 1 + randn() * 0.03 * e;
  return vel;
}

/**
 * Estimate shot quality from context (no randomness — deciding whether to shoot).
 * @param dist        distance to rim (m)
 * @param openness    0..1 (1 = wide open, 0 = smothered)
 * @param release     0..1 release timing quality (1 = perfect green)
 * @param skill       shooter base skill 0..1
 */
export function shotQuality(dist, openness, release, skill) {
  // distance falloff — comfortable inside ~7m, drops beyond maxRange
  const dq = THREE.MathUtils.clamp(1 - Math.max(0, dist - 4.5) / (SHOOTING.maxRange + 3), 0.15, 1);
  return THREE.MathUtils.clamp(
    0.20 + 0.32 * dq + 0.24 * openness + 0.18 * release + 0.16 * skill - 0.10,
    0.03, 0.99,
  );
}

/** Velocity for a chest/bounce pass reaching `to` at a given speed. */
export function passVelocity(from, to, speed = 13) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const dist = dir.length() || 1e-6;
  const t = dist / speed;
  return solveArc(from, to, Math.max(0.18, t));
}
