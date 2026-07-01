/**
 * PlayerController.js — drives the user-controlled player.
 * Camera-relative movement + contextual actions:
 *   with ball  : hold Space to charge shot meter (release in the green), E pass, Shift sprint
 *   on defense : Q steal, Space contest/block, F switch player
 */
import * as THREE from 'three';
import { PLAYER, SHOOTING } from '../config/Constants.js';
import { stepMovement, faceDir, faceInstant, velocityOf } from './Locomotion.js';

const CHARGE_DUR = 0.62;      // time to fill the meter to 1.0
const RELEASE_DUR = 0.34;     // follow-through duration
const PERFECT_CENTER = 0.9;

export class PlayerController {
  constructor(input, camera) {
    this.input = input;
    this.cam = camera;
    this._shot = null;                 // {phase:'charge'|'release', t, quality, launched}
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._rimDir = new THREE.Vector3();
  }

  _basis() {
    this.cam.getWorldDirection(this._fwd);
    this._fwd.y = 0;
    if (this._fwd.lengthSq() < 1e-5) this._fwd.set(0, 0, 1);
    this._fwd.normalize();
    this._right.crossVectors(this._up, this._fwd).normalize();
  }

  idle(dt, gs) {
    const p = gs.userPlayer;
    if (!p) return;
    stepMovement(p, { x: 0, z: 0 }, 0, dt);
    if (gs.ball.holder !== p) p.setAnimation('idle');
  }

  update(dt, gs) {
    const p = gs.userPlayer;
    if (!p) return;
    if (p._stealCd > 0) p._stealCd -= dt;
    this._basis();
    const input = this.input;
    const mv = input.move;
    const hasBall = gs.ball.holder === p;

    // desired world-space movement direction
    const dir = new THREE.Vector3()
      .addScaledVector(this._right, mv.x)
      .addScaledVector(this._fwd, mv.y);
    const moving = dir.lengthSq() > 0.001;
    if (moving) dir.normalize();

    // ------------- shot in progress locks movement -------------
    if (this._shot) { this._updateShot(dt, gs, p); return; }

    if (hasBall) {
      // start a shot
      if (input.pressed('shoot')) {
        this._shot = { phase: 'charge', t: 0, quality: 0, launched: false };
        const ps = PERFECT_CENTER - SHOOTING.perfectWindow;
        const pe = PERFECT_CENTER + SHOOTING.perfectWindow;
        gs.w.hud.showMeter(ps, pe);
        gs.w.hud.setHint('Release in the green!');
        return;
      }
      // pass
      if (input.pressed('pass')) {
        const rec = this._bestReceiver(gs, p);
        if (rec) { gs.passBall(p, rec); }
      }
      // dribble drive
      const speed = (input.sprint ? PLAYER.sprintSpeed : PLAYER.moveSpeed) * 0.92;
      const sp = stepMovement(p, dir, moving ? speed : 0, dt);
      gs.ball._dribbleRate = 8 + sp * 0.8;
      if (moving) faceDir(p, dir.x, dir.z, dt);
      p.setAnimation('dribble', { speed: Math.max(sp, moving ? 2 : 0.2) });
    } else {
      // defense / off-ball
      if (input.pressed('switch')) gs.switchUserPlayer();
      if (input.pressed('steal')) { gs.attemptSteal(p); p.setAnimation('defense'); }
      if (input.pressed('shoot')) { gs.attemptBlock(p); }
      const speed = input.sprint ? PLAYER.sprintSpeed : PLAYER.moveSpeed;
      const sp = stepMovement(p, dir, moving ? speed : 0, dt);
      if (moving) faceDir(p, dir.x, dir.z, dt);
      const onD = !gs.isOffense(p);
      if (sp > 0.3) p.setAnimation('run', { speed: sp });
      else p.setAnimation(onD ? 'defense' : 'idle');
    }
  }

  _updateShot(dt, gs, p) {
    const hud = gs.w.hud;
    // face the rim while shooting
    const rim = gs.targetRim(p.teamKey);
    this._rimDir.set(rim.x - p.group.position.x, 0, rim.z - p.group.position.z);
    faceInstant(p, this._rimDir.x, this._rimDir.z);
    stepMovement(p, { x: 0, z: 0 }, 0, dt);   // planted

    if (this._shot.phase === 'charge') {
      this._shot.t += dt;
      const meter = this._shot.t / CHARGE_DUR;
      hud.updateMeter(Math.min(meter, 1));
      p.setAnimation('shoot', { progress: Math.min(meter * 0.5, 0.5) });
      const released = this.input.released('shoot') || !this.input.shootHeld;
      if (released || meter >= 1.18) {
        this._shot.quality = this._releaseQuality(meter);
        this._shot.phase = 'release';
        this._shot.t = 0;
        hud.hideMeter();
        hud.setHint('');
      }
    } else { // release / follow-through
      this._shot.t += dt;
      const prog = Math.min(this._shot.t / RELEASE_DUR, 1);
      p.setAnimation('shoot', { progress: 0.5 + 0.5 * prog });
      if (!this._shot.launched && prog >= 0.55) {
        this._shot.launched = true;
        gs.shootBall(p, this._shot.quality);
      }
      if (prog >= 1) this._shot = null;
    }
  }

  _releaseQuality(meter) {
    const d = Math.abs(meter - PERFECT_CENTER);
    if (meter > 1.06) return 0.12;                       // overcharge = brick
    if (d <= SHOOTING.perfectWindow) return 1.0;         // perfect green
    if (d <= SHOOTING.goodWindow) return THREE.MathUtils.mapLinear(d, SHOOTING.perfectWindow, SHOOTING.goodWindow, 0.95, 0.55);
    return Math.max(0.12, 0.5 - (d - SHOOTING.goodWindow));
  }

  _bestReceiver(gs, p) {
    const mates = gs.teammatesOf(p);
    const atk = gs.attackDir(p.teamKey);
    let best = null, bs = -Infinity;
    for (const m of mates) {
      const to = new THREE.Vector3().subVectors(m.group.position, p.group.position);
      const dist = to.length();
      if (dist < 1.5 || dist > 22) continue;
      to.normalize();
      const forward = to.x * atk.x + to.z * atk.z;      // prefer passes toward basket
      const open = gs.nearestOf(gs.opponentsOf(p), m.group.position).dist;
      const score = forward * 1.3 + open * 0.6 - dist * 0.04;
      if (score > bs) { bs = score; best = m; }
    }
    return best || mates[0];
  }
}
