/**
 * Ball.js — the basketball. Holds mesh + physics state.
 *
 * States: 'held' (attached to holder, dribbling or gathered) | 'flight' | 'loose'
 * Physics.js integrates the ball when it is NOT held.
 * Ball.update(dt) handles the dribble/carry visual (when held) and rolling spin (when free).
 */
import * as THREE from 'three';
import { BALL } from '../config/Constants.js';

function makeBallTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const ctx = c.getContext('2d');
  // base
  const g = ctx.createRadialGradient(256, 200, 40, 256, 256, 360);
  g.addColorStop(0, '#e8813a');
  g.addColorStop(1, '#c05a17');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  // subtle pebbling
  for (let i = 0; i < 5000; i++) {
    ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`;
    ctx.beginPath();
    ctx.arc(Math.random() * 512, Math.random() * 512, Math.random() * 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
  // seams
  ctx.strokeStyle = '#1a1108';
  ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(0, 256); ctx.lineTo(512, 256); ctx.stroke();          // horizontal
  ctx.beginPath(); ctx.moveTo(256, 0); ctx.lineTo(256, 512); ctx.stroke();          // vertical
  ctx.beginPath(); ctx.moveTo(60, 0); ctx.quadraticCurveTo(180, 256, 60, 512); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(452, 0); ctx.quadraticCurveTo(332, 256, 452, 512); ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

export class Ball {
  constructor() {
    const geo = new THREE.SphereGeometry(BALL.radius, 32, 24);
    const mat = new THREE.MeshStandardMaterial({
      map: makeBallTexture(), roughness: 0.62, metalness: 0.02,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.castShadow = true;
    this.mesh.position.set(0, BALL.radius, 0);

    this.position = this.mesh.position;            // alias
    this.velocity = new THREE.Vector3();
    this.state = 'loose';                          // 'held' | 'flight' | 'loose'
    this.holder = null;
    this.lastShooter = null;
    this.lastTouchTeam = null;                     // 'home' | 'away'
    this.shotWorth = 2;
    this.dribbling = false;
    this._pass = false;                            // in-flight pass (ignored by score detection)
    this._dribbleRate = 9.5;
    this.onBounce = null;                          // callback(volume)

    this._dribblePhase = 0;
    this._prevLow = false;
    this._tmp = new THREE.Vector3();
    this._spinAxis = new THREE.Vector3(1, 0, 0);
  }

  attachTo(player, dribble = true) {
    this.state = 'held';
    this.holder = player;
    this.dribbling = dribble;
    this._pass = false;
    this.lastTouchTeam = player.teamKey;
    this.velocity.set(0, 0, 0);
  }

  release(velocity, worth, shooter) {
    this.state = 'flight';
    this.holder = null;
    this.dribbling = false;
    this._pass = false;
    this.lastShooter = shooter;
    this.lastTouchTeam = shooter.teamKey;
    this.shotWorth = worth;
    this.velocity.copy(velocity);
  }

  pass(velocity, fromPlayer) {
    this.state = 'flight';
    this.holder = null;
    this.dribbling = false;
    this._pass = true;
    this.lastShooter = null;
    this.lastTouchTeam = fromPlayer.teamKey;
    this.velocity.copy(velocity);
  }

  setLoose(velocity) {
    this.state = 'loose';
    this.holder = null;
    this.dribbling = false;
    this._pass = false;
    if (velocity) this.velocity.copy(velocity);
  }

  update(dt) {
    if (this.state === 'held' && this.holder) {
      const hand = this.holder.handAnchor;
      hand.getWorldPosition(this._tmp);
      if (this.dribbling) {
        // bounce between hand height and floor
        this._dribblePhase += dt * this._dribbleRate;
        const s = Math.abs(Math.sin(this._dribblePhase));
        const lowY = BALL.radius;
        const highY = Math.max(this._tmp.y, 0.85);
        this.position.set(this._tmp.x, lowY + (highY - lowY) * s, this._tmp.z);
        const low = s < 0.12;
        if (low && !this._prevLow && this.onBounce) this.onBounce(0.5);
        this._prevLow = low;
      } else {
        this.position.copy(this._tmp);
      }
      // gentle spin while carried
      this.mesh.rotation.x += dt * 2;
    } else {
      // free ball: roll/spin based on velocity
      const v = this.velocity;
      const speed = v.length();
      if (speed > 0.05) {
        this._spinAxis.set(-v.z, 0, v.x).normalize();
        this.mesh.rotateOnWorldAxis(this._spinAxis, Math.min(speed * dt / BALL.radius, 0.6));
      }
    }
  }
}
