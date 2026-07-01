/**
 * Locomotion.js — shared movement kinematics for players (user + AI).
 * Players expose only .group; we keep a private velocity on the Player instance.
 */
import * as THREE from 'three';
import { PLAYER, COURT } from '../config/Constants.js';

function kin(p) {
  if (!p._vel) p._vel = new THREE.Vector3();
  return p._vel;
}

/**
 * Accelerate the player toward desiredDir*targetSpeed and integrate position.
 * @param desiredDir {x,z} unit (or {0,0} to stop)
 * @returns actual horizontal speed (m/s)
 */
export function stepMovement(p, desiredDir, targetSpeed, dt) {
  const v = kin(p);
  const dx = desiredDir.x || 0, dz = desiredDir.z || 0;
  const mag = Math.hypot(dx, dz);
  if (mag > 0.001 && targetSpeed > 0.01) {
    const tx = (dx / mag) * targetSpeed;
    const tz = (dz / mag) * targetSpeed;
    v.x += (tx - v.x) * Math.min(1, PLAYER.accel * dt / Math.max(targetSpeed, 1));
    v.z += (tz - v.z) * Math.min(1, PLAYER.accel * dt / Math.max(targetSpeed, 1));
  } else {
    const f = Math.max(0, 1 - PLAYER.friction * dt);
    v.x *= f; v.z *= f;
    if (Math.hypot(v.x, v.z) < 0.02) { v.x = 0; v.z = 0; }
  }
  const pos = p.group.position;
  pos.x += v.x * dt;
  pos.z += v.z * dt;
  clampToCourt(pos);
  pos.y = 0;
  return Math.hypot(v.x, v.z);
}

export function velocityOf(p) { return kin(p); }

export function faceDir(p, dx, dz, dt, rate = PLAYER.turnRate) {
  if (Math.hypot(dx, dz) < 0.001) return;
  const target = Math.atan2(-dz, dx);
  let cur = p.group.rotation.y;
  let diff = target - cur;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  p.group.rotation.y = cur + diff * Math.min(1, rate * dt);
}

export function faceInstant(p, dx, dz) {
  if (Math.hypot(dx, dz) < 0.001) return;
  p.group.rotation.y = Math.atan2(-dz, dx);
}

export function clampToCourt(pos, m = 1.2) {
  const lx = COURT.halfLength + m, lz = COURT.halfWidth + m;
  pos.x = THREE.MathUtils.clamp(pos.x, -lx, lx);
  pos.z = THREE.MathUtils.clamp(pos.z, -lz, lz);
}
