/**
 * AI.js — controls every non-user player.
 * Roles chosen each frame from possession + who holds the ball:
 *   ball handler -> drive / shoot / pass    off-ball offense -> spacing & cuts
 *   defense      -> man-to-man with help     loose ball -> rebound / block / scramble
 */
import * as THREE from 'three';
import { PLAYER, SHOOTING } from '../config/Constants.js';
import { stepMovement, faceDir, faceInstant } from './Locomotion.js';
import { shotQuality } from './Shooting.js';

export class AI {
  update(dt, gs) {
    for (const p of gs.w.allPlayers) {
      if (p === gs.userPlayer) continue;
      this._init(p);
      this._tick(p, dt);
      const phase = gs.phase;
      if (phase === 'final' || phase === 'break' || phase === 'freeze') { this._idle(p); continue; }
      if (phase === 'tipoff') { this._tipoff(p, gs, dt); continue; }
      const ball = gs.ball;
      if (ball.state !== 'held') { this._loose(p, gs, dt); continue; }
      if (ball.holder === p) this._ballHandler(p, gs, dt);
      else if (p.teamKey === gs.possession) this._offBall(p, gs, dt);
      else this._defense(p, gs, dt);
    }
  }

  _init(p) {
    if (p._aiInit) return;
    p._aiInit = true;
    p._aiShot = null;
    p._passCd = 0; p._decideCd = 0; p._holdT = 0;
    p._reachBonus = 0;
    p._stealCd = p._stealCd || 0;
    p._juke = Math.random() < 0.5 ? -1 : 1;
  }
  _tick(p, dt) {
    p._passCd = Math.max(0, p._passCd - dt);
    p._decideCd = Math.max(0, p._decideCd - dt);
    p._stealCd = Math.max(0, (p._stealCd || 0) - dt);
    p._reachBonus = Math.max(0, p._reachBonus - dt * 2.5);
  }
  _speed(gs, f = 1) { return PLAYER.moveSpeed * (0.82 + 0.18 * gs.diff.react) * f; }

  _moveTo(p, tx, tz, speed, dt) {
    const pos = p.group.position;
    const dx = tx - pos.x, dz = tz - pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.18) { return stepMovement(p, { x: 0, z: 0 }, 0, dt); }
    return stepMovement(p, { x: dx / d, z: dz / d }, speed, dt);
  }

  _idle(p) {
    if (!p._vel) return;
    p._vel.x *= 0.8; p._vel.z *= 0.8;
    p.setAnimation('idle');
  }

  _tipoff(p, gs, dt) {
    const ball = gs.ball;
    if (p.roleIndex === 0) {
      p.setAnimation('tipoff');
      this._moveTo(p, ball.position.x * 0.45, ball.position.z * 0.45, 1.6, dt);
    } else {
      this._moveTo(p, p.group.position.x, p.group.position.z, 0, dt);
      p.setAnimation('idle');
    }
  }

  _loose(p, gs, dt) {
    const ball = gs.ball;
    const pos = p.group.position;
    const myDist = Math.hypot(pos.x - ball.position.x, pos.z - ball.position.z);
    let closer = 0;
    for (const q of gs.w.allPlayers) {
      if (q === p) continue;
      const dq = Math.hypot(q.group.position.x - ball.position.x, q.group.position.z - ball.position.z);
      if (dq < myDist) closer++;
    }
    const passToMine = ball._pass && ball.lastTouchTeam === p.teamKey;
    const pursue = closer < 2 || (passToMine && closer < 1);
    if (pursue) {
      const tx = ball.position.x + ball.velocity.x * 0.12;
      const tz = ball.position.z + ball.velocity.z * 0.12;
      const sp = this._moveTo(p, tx, tz, this._speed(gs, 1.08), dt);
      if (myDist < 1.6) p._reachBonus = 1.0;
      faceDir(p, tx - pos.x, tz - pos.z, dt);
      p.setAnimation(sp > 0.4 ? 'run' : 'jump', { speed: sp, progress: 0.6 });
      if (ball.state === 'flight' && !ball._pass && ball.lastShooter &&
          ball.lastShooter.teamKey !== p.teamKey && p._stealCd <= 0) {
        p._stealCd = gs.attemptBlock(p) ? 0.7 : 0.5;
      }
    } else {
      if (p.teamKey === gs.possession) {
        const s = gs.offenseSpots(p.teamKey)[p.roleIndex];
        const sp = this._moveTo(p, s.x, s.z, this._speed(gs, 0.8), dt);
        p.setAnimation(sp > 0.4 ? 'run' : 'idle', { speed: sp });
      } else {
        const rim = gs.ownRim(p.teamKey);
        const sp = this._moveTo(p, rim.x * 0.55, pos.z * 0.7, this._speed(gs, 0.8), dt);
        p.setAnimation(sp > 0.4 ? 'run' : 'defense', { speed: sp });
      }
      faceDir(p, ball.position.x - pos.x, ball.position.z - pos.z, dt);
    }
  }

  _ballHandler(p, gs, dt) {
    p._holdT += dt;
    const rim = gs.targetRim(p.teamKey);
    const pos = p.group.position;
    const dist = Math.hypot(rim.x - pos.x, rim.z - pos.z);
    const opp = gs.nearestOpponent(p);
    const open = THREE.MathUtils.clamp((opp.dist - 0.6) / 2.2, 0, 1);

    if (p._aiShot) { this._progressShot(p, gs, dt, rim); return; }

    if (p._decideCd <= 0) {
      p._decideCd = 0.18;
      const est = shotQuality(dist, open, 0.75, p.skill);
      const layup = dist < 2.0 && open > 0.15;
      const desperate = gs.shotClock < 6;
      const want = layup || desperate ||
        (est > (0.52 - 0.14 * gs.diff.shootUrge) && dist < SHOOTING.maxRange && open > 0.25 &&
         p._holdT > 0.35 && Math.random() < 0.5 * gs.diff.shootUrge + 0.2);
      if (want) { this._startShot(p, gs, dist, open); return; }
      if (opp.dist < 1.1 && gs.shotClock > 6 && p._passCd <= 0 && Math.random() < 0.4) {
        const rec = this._bestReceiver(gs, p);
        if (rec) { gs.passBall(p, rec); p._passCd = 0.8; return; }
      }
    }

    // drive toward a lane at shooting distance
    const ax = gs.attackDir(p.teamKey);
    const driveDist = 4.2;
    let gx = rim.x - ax.x * driveDist;
    let gz = THREE.MathUtils.clamp(pos.z * 0.5 + p._juke * 1.6, -6.2, 6.2);
    if (opp.dist < 1.7) gz += p._juke * 2.2;   // veer around pressure
    const speed = this._speed(gs, dist > 6 ? 1.0 : 0.72);
    const sp = this._moveTo(p, gx, gz, speed, dt);
    gs.ball._dribbleRate = 8 + sp * 0.8;
    faceDir(p, rim.x - pos.x, rim.z - pos.z, dt);
    p.setAnimation('dribble', { speed: Math.max(sp, 1) });
  }

  _startShot(p, gs, dist, open) {
    const q = THREE.MathUtils.clamp(
      0.4 + 0.5 * p.skill + 0.2 * open - (dist > 7 ? 0.15 : 0) + (Math.random() - 0.5) * 0.25,
      0.1, 0.98) * (0.72 + 0.28 * gs.diff.react);
    p._aiShot = { t: 0, launched: false, q };
    p._holdT = 0;
  }
  _progressShot(p, gs, dt, rim) {
    p._aiShot.t += dt;
    const prog = Math.min(p._aiShot.t / 0.5, 1);
    faceInstant(p, rim.x - p.group.position.x, rim.z - p.group.position.z);
    stepMovement(p, { x: 0, z: 0 }, 0, dt);
    p.setAnimation('shoot', { progress: prog });
    if (!p._aiShot.launched && prog >= 0.7) { p._aiShot.launched = true; gs.shootBall(p, p._aiShot.q); }
    if (prog >= 1) p._aiShot = null;
  }

  _offBall(p, gs, dt) {
    const s = gs.offenseSpots(p.teamKey)[p.roleIndex];
    const rim = gs.targetRim(p.teamKey);
    // subtle idle drift so it isn't robotic
    const t = (p._holdT = (p._holdT || 0) + dt);
    const jx = Math.sin(t * 0.7 + p.roleIndex) * 0.6;
    const sp = this._moveTo(p, s.x + jx, s.z, this._speed(gs, 0.85), dt);
    faceDir(p, rim.x - p.group.position.x, rim.z - p.group.position.z, dt);
    p.setAnimation(sp > 0.4 ? 'run' : 'idle', { speed: sp });
  }

  _defense(p, gs, dt) {
    const handler = gs.ball.holder;
    const own = gs.ownRim(p.teamKey);
    const pos = p.group.position;
    let guardHandler = false;
    if (handler) {
      const mates = gs.w.players[p.teamKey];
      let nearest = null, nd = Infinity;
      for (const m of mates) {
        if (m === gs.userPlayer) continue;         // user takes their own assignment
        const d = m.group.position.distanceTo(handler.group.position);
        if (d < nd) { nd = d; nearest = m; }
      }
      if (nearest === p) guardHandler = true;
    }
    let man = guardHandler ? handler
      : (gs.w.players[gs.possession][p.roleIndex] || handler);
    if (!man) { this._idle(p); return; }
    const mp = man.group.position;
    let dx = own.x - mp.x, dz = own.z - mp.z;
    const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    const gap = guardHandler ? 1.1 : 1.9;
    const sp = this._moveTo(p, mp.x + dx * gap, mp.z + dz * gap, this._speed(gs, guardHandler ? 1.0 : 0.9), dt);
    faceDir(p, mp.x - pos.x, mp.z - pos.z, dt);
    if (guardHandler && p._stealCd <= 0 &&
        pos.distanceTo(handler.group.position) < PLAYER.reach + 0.2 &&
        Math.random() < 0.013 * gs.diff.steal) {
      p._stealCd = gs.attemptSteal(p) ? 0.9 : 0.7;
    }
    p.setAnimation(sp > 0.6 ? 'run' : 'defense', { speed: sp });
  }

  _bestReceiver(gs, p) {
    const mates = gs.teammatesOf(p);
    const atk = gs.attackDir(p.teamKey);
    let best = null, bs = -Infinity;
    for (const m of mates) {
      const to = new THREE.Vector3().subVectors(m.group.position, p.group.position);
      const dist = to.length();
      if (dist < 2 || dist > 22) continue;
      to.normalize();
      const forward = to.x * atk.x + to.z * atk.z;
      const open = gs.nearestOf(gs.opponentsOf(p), m.group.position).dist;
      const score = forward * 1.1 + open * 0.7 - dist * 0.05;
      if (score > bs) { bs = score; best = m; }
    }
    return best;
  }
}
