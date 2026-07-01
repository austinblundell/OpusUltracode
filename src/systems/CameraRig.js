/**
 * CameraRig.js — broadcast + follow cameras that track the action.
 */
import * as THREE from 'three';
import { COURT } from '../config/Constants.js';

const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'broadcast';
    this.pos = camera.position.clone();
    this.look = new THREE.Vector3(0, 1.5, 0);
    this._desiredPos = this.pos.clone();
    this._desiredLook = this.look.clone();
    this._shake = 0;
    this._t = 0;
    this.sidelineZ = -(COURT.halfWidth + 8.5);
    this.height = 9.5;
  }

  setMode(m) { this.mode = m; }
  shake(amount = 0.5) { this._shake = Math.min(1.2, this._shake + amount); }

  update(dt, focus, userPlayer, attackDir) {
    this._t += dt;
    if (this.mode === 'follow' && userPlayer) {
      const pp = userPlayer.group.position;
      const dir = attackDir || { x: 1, z: 0 };
      this._desiredPos.set(pp.x - dir.x * 7.5, 4.6, pp.z - dir.z * 7.5 + this.sidelineZ * 0.06);
      this._desiredLook.set(pp.x + dir.x * 4, 1.6, pp.z + dir.z * 4);
    } else {
      // broadcast: fixed sideline, pans along X with the ball
      const fx = THREE.MathUtils.clamp(focus.x, -COURT.halfLength, COURT.halfLength);
      this._desiredPos.set(fx * 0.55, this.height, this.sidelineZ);
      this._desiredLook.set(fx * 0.78, 1.8, 0.5);
    }
    const lam = this.mode === 'follow' ? 6 : 3.2;
    this.pos.x = damp(this.pos.x, this._desiredPos.x, lam, dt);
    this.pos.y = damp(this.pos.y, this._desiredPos.y, lam, dt);
    this.pos.z = damp(this.pos.z, this._desiredPos.z, lam, dt);
    this.look.x = damp(this.look.x, this._desiredLook.x, lam, dt);
    this.look.y = damp(this.look.y, this._desiredLook.y, lam, dt);
    this.look.z = damp(this.look.z, this._desiredLook.z, lam, dt);

    this.camera.position.copy(this.pos);
    if (this._shake > 0.001) {
      const s = this._shake * 0.25;
      this.camera.position.x += Math.sin(this._t * 63) * s;
      this.camera.position.y += Math.cos(this._t * 71) * s;
      this._shake *= Math.exp(-6 * dt);
    }
    this.camera.lookAt(this.look);
  }

  snap(focus) {
    // place instantly (used at tip-off / after cuts)
    this.update(1, focus, null, { x: 1, z: 0 });
    this.pos.copy(this._desiredPos);
    this.look.copy(this._desiredLook);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }
}
