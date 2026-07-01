/**
 * Physics.js — integrates the free ball and resolves collisions with the
 * floor, rims, backboards and nets, and detects made baskets.
 *
 * Only runs while ball.state !== 'held'. Uses internal sub-stepping so fast
 * shots don't tunnel through the thin rim/backboard.
 *
 * Events (set as callbacks):
 *   onScore(hoopSide, worth, shooter)   // hoopSide +1 = the +X hoop
 *   onFloorBounce(volume)
 *   onRimHit()
 *   onBackboardHit()
 *   onOutOfBounds(position)
 */
import * as THREE from 'three';
import { BALL, PHYSICS, COURT, HOOP, backboardX } from '../config/Constants.js';

export class Physics {
  constructor(ball, hoops) {
    this.ball = ball;
    this.hoops = hoops;              // [hoopMinus, hoopPlus] groups w/ userData
    this.onScore = null;
    this.onFloorBounce = null;
    this.onRimHit = null;
    this.onBackboardHit = null;
    this.onOutOfBounds = null;

    this._scoreArmed = [true, true];  // per hoop, re-armed when ball leaves rim area
    this._oob = false;
    this._n = new THREE.Vector3();
    this._d = new THREE.Vector3();
    this._prev = new THREE.Vector3();
  }

  reset() {
    this._scoreArmed = [true, true];
    this._oob = false;
  }

  update(dt) {
    const ball = this.ball;
    if (ball.state === 'held') { this._oob = false; return; }
    // adaptive sub-steps so displacement per step < ~half a ball radius
    const speed = ball.velocity.length();
    const steps = Math.min(PHYSICS.maxSubSteps * 3,
      Math.max(1, Math.ceil((speed * dt) / (BALL.radius * 0.5))));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) this._step(h);
  }

  _step(h) {
    const ball = this.ball;
    const p = ball.position, v = ball.velocity;
    this._prev.copy(p);

    // integrate
    v.y -= PHYSICS.gravity * h;
    const drag = 1 - BALL.airDrag * h;
    v.multiplyScalar(drag);
    p.addScaledVector(v, h);

    // ---- floor ----
    if (p.y < BALL.radius) {
      p.y = BALL.radius;
      if (v.y < 0) {
        const impact = -v.y;
        v.y = impact * BALL.restitutionFloor;
        v.x *= 0.82; v.z *= 0.82;               // rolling friction
        if (this.onFloorBounce && impact > 0.6) this.onFloorBounce(Math.min(1, impact / 6));
        if (v.y < 0.4 && Math.hypot(v.x, v.z) < 0.4) { v.y = 0; }  // settle
      }
    }

    // ---- hoops ----
    for (let s = 0; s < this.hoops.length; s++) {
      const hoop = this.hoops[s];
      const C = hoop.userData.rimCenter;
      const R = hoop.userData.rimRadius;
      const side = hoop.userData.side;

      // rim ring collision (torus tube)
      const dx = p.x - C.x, dz = p.z - C.z;
      const horiz = Math.hypot(dx, dz) || 1e-6;
      const ringX = C.x + (dx / horiz) * R;
      const ringZ = C.z + (dz / horiz) * R;
      this._n.set(p.x - ringX, p.y - C.y, p.z - ringZ);
      const nd = this._n.length() || 1e-6;
      const minDist = BALL.radius + HOOP.rimTubeRadius;
      if (nd < minDist && p.y > C.y - 0.25 && p.y < C.y + 0.35) {
        this._n.multiplyScalar(1 / nd);
        // push out
        p.addScaledVector(this._n, (minDist - nd) + 1e-4);
        const vn = v.dot(this._n);
        if (vn < 0) {
          v.addScaledVector(this._n, -(1 + BALL.restitutionRim) * vn);
          v.multiplyScalar(0.9);
          if (this.onRimHit) this.onRimHit();
        }
      }

      // net drag (below rim, inside cylinder)
      if (p.y < C.y && p.y > C.y - HOOP.netLength && horiz < R) {
        v.x *= 0.9; v.z *= 0.9; v.y *= 0.985;
      }

      // backboard collision (vertical rectangle)
      const faceX = backboardX(side);
      const halfW = hoop.userData.backboardHalf.w;
      const bTop = HOOP.backboardBottomHeight + HOOP.backboardHeight;
      const bBot = HOOP.backboardBottomHeight;
      const withinBoard = Math.abs(p.z) < halfW && p.y > bBot && p.y < bTop;
      if (withinBoard) {
        if (side > 0) {
          if (p.x > faceX - BALL.radius && this._prev.x <= faceX - BALL.radius + 1e-3 && v.x > 0) {
            p.x = faceX - BALL.radius; v.x = -v.x * BALL.restitutionBackboard; v.multiplyScalar(0.92);
            if (this.onBackboardHit) this.onBackboardHit();
          }
        } else {
          if (p.x < faceX + BALL.radius && this._prev.x >= faceX + BALL.radius - 1e-3 && v.x < 0) {
            p.x = faceX + BALL.radius; v.x = -v.x * BALL.restitutionBackboard; v.multiplyScalar(0.92);
            if (this.onBackboardHit) this.onBackboardHit();
          }
        }
      }

      // ---- score detection ----
      const inCol = horiz < (R - BALL.radius * 0.35);
      if (this._scoreArmed[s] && !ball._pass && this._prev.y >= C.y && p.y < C.y && v.y < 0 && inCol) {
        this._scoreArmed[s] = false;
        hoop.userData.net.swish(Math.min(1, -v.y / 4 + 0.4));
        if (this.onScore) this.onScore(side, ball.shotWorth, ball.lastShooter);
      }
      // re-arm once ball clears above the rim again
      if (!this._scoreArmed[s] && p.y > C.y + 0.4) this._scoreArmed[s] = true;
    }

    // ---- out of bounds (free ball only) ----
    const outX = Math.abs(p.x) > COURT.halfLength + 0.15;
    const outZ = Math.abs(p.z) > COURT.halfWidth + 0.15;
    if ((outX || outZ) && !this._oob) {
      this._oob = true;
      if (this.onOutOfBounds) this.onOutOfBounds(p);
    } else if (!outX && !outZ) {
      this._oob = false;
    }
  }
}
