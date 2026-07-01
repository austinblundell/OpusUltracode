/**
 * Player.js — an articulated humanoid basketball player.
 *
 * Built from grouped primitives with nested Object3D pivots (shoulders, elbows,
 * hips, knees, neck) so a small pose/animation state machine can rotate limb
 * joints believably. Controllers drive the player PURELY through the public API:
 *
 *   .group            THREE.Group, origin at the FEET on the floor (local Y=0).
 *                     Model FACES +X when group.rotation.y = 0.
 *   .height           PLAYER.height. Also .team / .number / .name / .isUser.
 *   .handAnchor       Object3D tracking the ball-handling hand for the pose.
 *   .releaseAnchor    Object3D at the shot release point (above/front of head).
 *   .setAnimation(name, opts)   choose pose; opts.speed (m/s) for run/dribble,
 *                     opts.progress [0..1] for shoot/pass/jump/block.
 *   .update(dt)       advance timers, pose the skeleton, sync anchors, breathe.
 *
 * The model is stylized-but-realistic and NBA-proportioned to PLAYER.height.
 * Everything casts shadows. No per-frame allocation in update().
 */
import * as THREE from 'three';
import { PLAYER } from '../config/Constants.js';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const _v = new THREE.Vector3();
const DEG = Math.PI / 180;

function hexStr(hex) {
  return '#' + ('000000' + (hex >>> 0).toString(16)).slice(-6);
}
function lerp(a, b, t) { return a + (b - a) * t; }
function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
function smooth(t) { t = clamp01(t); return t * t * (3 - 2 * t); }

// Jersey texture: number on team.primary with a team.trim ring/outline.
function makeJerseyTexture(number, primary, trim, secondary) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = hexStr(primary);
  ctx.fillRect(0, 0, 256, 256);

  // subtle vertical shading for fabric depth
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, 'rgba(255,255,255,0.06)');
  g.addColorStop(0.5, 'rgba(0,0,0,0.0)');
  g.addColorStop(1, 'rgba(0,0,0,0.16)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);

  // trim stripe across the shoulders (top) and hem (bottom)
  ctx.fillStyle = hexStr(trim);
  ctx.fillRect(0, 14, 256, 8);
  ctx.fillStyle = hexStr(secondary);
  ctx.fillRect(0, 236, 256, 10);

  // big jersey number, trim colored with a dark outline for readability
  const txt = String(number);
  ctx.font = 'bold 150px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 12;
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.strokeText(txt, 128, 140);
  ctx.fillStyle = hexStr(trim);
  ctx.fillText(txt, 128, 140);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

// Plain-color jersey texture (sides/back-of-shorts etc.) reused for material.
export class Player {
  constructor({ team, skin, number, name, isUser } = {}) {
    this.team = team || { primary: 0x1d64d8, secondary: 0xf5c518, trim: 0xffffff };
    this.skin = (skin === undefined || skin === null) ? 0xc68642 : skin;
    this.number = (number === undefined || number === null) ? 0 : number;
    this.name = name || 'Player';
    this.isUser = !!isUser;
    this.height = PLAYER.height;

    // Dribble rate hint consumed by Ball.js (bounces/sec-ish).
    this._dribbleRate = 9.5;

    // Animation state
    this._anim = 'idle';
    this._prevAnim = 'idle';
    this._blend = 1;          // 0..1 crossfade into current anim
    this._t = 0;              // generic time accumulator (idle sway, celebrate)
    this._cycle = 0;          // locomotion phase (run/dribble), radians
    this._progress = 0;       // phase for shoot/pass/jump/block
    this._speed = 0;          // m/s for run/dribble

    // Materials shared across parts
    this._buildMaterials();

    // Build the skeleton + meshes.
    this.group = new THREE.Group();
    this._buildModel();

    // Ball anchors (children of group; moved every update to match pose).
    this.handAnchor = new THREE.Object3D();
    this.releaseAnchor = new THREE.Object3D();
    this.group.add(this.handAnchor, this.releaseAnchor);

    // Neutral rest pose then first sync.
    this._applyIdle(0, 1);
    this._syncAnchors();
  }

  // -------------------------------------------------------------------------
  // Materials
  // -------------------------------------------------------------------------
  _buildMaterials() {
    const t = this.team;
    this._skinMat = new THREE.MeshStandardMaterial({
      color: this.skin, roughness: 0.72, metalness: 0.0,
    });
    this._jerseyMat = new THREE.MeshStandardMaterial({
      map: makeJerseyTexture(this.number, t.primary, t.trim, t.secondary),
      color: 0xffffff, roughness: 0.78, metalness: 0.02,
    });
    // shorts = darker primary
    const dark = new THREE.Color(t.primary).multiplyScalar(0.55);
    this._shortsMat = new THREE.MeshStandardMaterial({
      color: dark, roughness: 0.82, metalness: 0.02,
    });
    this._trimMat = new THREE.MeshStandardMaterial({
      color: t.trim, roughness: 0.6, metalness: 0.05,
    });
    this._shoeMat = new THREE.MeshStandardMaterial({
      color: t.secondary, roughness: 0.5, metalness: 0.08,
    });
    this._soleMat = new THREE.MeshStandardMaterial({
      color: 0xf2f2f2, roughness: 0.85, metalness: 0.0,
    });
    this._hairMat = new THREE.MeshStandardMaterial({
      color: 0x141414, roughness: 0.85, metalness: 0.0,
    });
  }

  _mesh(geo, mat) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  // -------------------------------------------------------------------------
  // Model construction — nested joint pivots.
  //
  // Vertical layout (standing), feet at group Y=0:
  //   hipHeight (pelvis)  ~0.98
  //   torso spans hipHeight .. hipHeight + torsoHeight
  //   shoulders at torso top; neck+head above.
  // -------------------------------------------------------------------------
  _buildModel() {
    const P = PLAYER;
    const g = this.group;

    const hipY = P.hipHeight;                 // pelvis pivot height
    const torsoTop = hipY + P.torsoHeight;    // shoulders live here
    const shoulderY = torsoTop - 0.06;
    const shoulderX = P.torsoWidth * 0.5 - 0.02;
    const hipX = P.torsoWidth * 0.28;

    // ---- Pelvis / shorts ----
    const pelvis = new THREE.Group();
    pelvis.position.set(0, hipY, 0);
    g.add(pelvis);
    this._pelvis = pelvis;

    const shortsGeo = new THREE.CylinderGeometry(
      P.torsoWidth * 0.44, P.torsoWidth * 0.5, 0.30, 16, 1, false
    );
    const shorts = this._mesh(shortsGeo, this._shortsMat);
    shorts.position.set(0, 0.02, 0);
    shorts.scale.set(1, 1, 0.72);
    pelvis.add(shorts);
    // shorts trim hem
    const hem = this._mesh(
      new THREE.TorusGeometry(P.torsoWidth * 0.46, 0.012, 8, 20),
      this._trimMat
    );
    hem.rotation.x = Math.PI / 2;
    hem.position.set(0, -0.15, 0);
    hem.scale.set(1, 0.72, 1);
    pelvis.add(hem);

    // ---- Torso (jersey) ----
    // A tapered cylinder for the trunk (belly->chest), boxier shoulders.
    const torsoPivot = new THREE.Group();
    torsoPivot.position.set(0, hipY + 0.08, 0);
    g.add(torsoPivot);
    this._torso = torsoPivot;

    const torsoH = P.torsoHeight - 0.02;
    const torsoGeo = new THREE.CylinderGeometry(
      P.torsoWidth * 0.44, P.torsoWidth * 0.40, torsoH, 20, 1, false
    );
    const torso = this._mesh(torsoGeo, this._jerseyMat);
    torso.position.set(0, torsoH * 0.5 - 0.02, 0);
    torso.scale.set(1, 1, P.torsoDepth / P.torsoWidth * 1.35);
    // Rotate so the CanvasTexture number faces +X (front) and -X (back).
    torso.rotation.y = Math.PI / 2;
    torsoPivot.add(torso);

    // shoulder yoke (rounded top of jersey)
    const yoke = this._mesh(
      new THREE.SphereGeometry(P.torsoWidth * 0.46, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5),
      this._jerseyMat
    );
    yoke.position.set(0, torsoH - 0.06, 0);
    yoke.scale.set(1, 0.55, P.torsoDepth / P.torsoWidth * 1.35);
    torsoPivot.add(yoke);

    // ---- Neck + Head ----
    const neckPivot = new THREE.Group();
    neckPivot.position.set(0, torsoTop - hipY - 0.09, 0); // relative to torsoPivot
    torsoPivot.add(neckPivot);
    this._neck = neckPivot;

    const neck = this._mesh(
      new THREE.CylinderGeometry(0.055, 0.07, 0.12, 12),
      this._skinMat
    );
    neck.position.set(0, 0.06, 0);
    neckPivot.add(neck);

    const head = this._mesh(new THREE.SphereGeometry(P.headRadius, 24, 18), this._skinMat);
    head.position.set(0.008, 0.12 + P.headRadius, 0);
    head.scale.set(0.94, 1.06, 1.0);
    neckPivot.add(head);
    this._head = head;

    // simple hair cap
    const hair = this._mesh(
      new THREE.SphereGeometry(P.headRadius * 1.02, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.62),
      this._hairMat
    );
    hair.position.copy(head.position);
    hair.position.y += 0.01;
    hair.rotation.x = -0.18;
    neckPivot.add(hair);

    // team headband (trim over primary) around the forehead
    const band = this._mesh(
      new THREE.TorusGeometry(P.headRadius * 0.98, 0.02, 8, 22),
      this._trimMat
    );
    band.rotation.x = Math.PI / 2;
    band.position.copy(head.position);
    band.position.y += P.headRadius * 0.28;
    band.scale.set(1, 1.0, 0.96);
    neckPivot.add(band);

    // ---- Arms ---- (shoulder -> elbow -> forearm -> hand)
    this._arms = {};
    this._arms.R = this._buildArm(+1, shoulderX, shoulderY - hipY - 0.08, torsoPivot);
    this._arms.L = this._buildArm(-1, -shoulderX, shoulderY - hipY - 0.08, torsoPivot);

    // ---- Legs ---- (hip -> knee -> shin -> shoe)
    this._legs = {};
    this._legs.R = this._buildLeg(+1, hipX, 0, pelvis);
    this._legs.L = this._buildLeg(-1, -hipX, 0, pelvis);
  }

  _buildArm(sign, x, y, parent) {
    const P = PLAYER;
    const r = P.limbRadius * 0.92;

    const shoulder = new THREE.Group();
    shoulder.position.set(x, y, 0);
    parent.add(shoulder);

    // upper arm capsule hangs downward from shoulder
    const upper = this._mesh(
      new THREE.CapsuleGeometry(r, P.upperArm - r * 2, 6, 12),
      this._skinMat
    );
    upper.position.set(0, -P.upperArm * 0.5, 0);
    shoulder.add(upper);

    // small deltoid cap (jersey sleeve)
    const sleeve = this._mesh(
      new THREE.SphereGeometry(r * 1.35, 14, 10),
      this._jerseyMat
    );
    sleeve.position.set(0, -0.02, 0);
    sleeve.scale.set(1, 0.8, 1);
    shoulder.add(sleeve);

    const elbow = new THREE.Group();
    elbow.position.set(0, -P.upperArm, 0);
    shoulder.add(elbow);

    const fore = this._mesh(
      new THREE.CapsuleGeometry(r * 0.9, P.foreArm - r * 2, 6, 12),
      this._skinMat
    );
    fore.position.set(0, -P.foreArm * 0.5, 0);
    elbow.add(fore);

    // hand
    const hand = this._mesh(new THREE.SphereGeometry(r * 1.25, 12, 10), this._skinMat);
    hand.position.set(0, -P.foreArm - 0.01, 0);
    hand.scale.set(1, 1.15, 0.75);
    elbow.add(hand);

    // wristband
    const wrist = this._mesh(
      new THREE.TorusGeometry(r * 1.0, 0.014, 6, 12),
      this._trimMat
    );
    wrist.rotation.x = Math.PI / 2;
    wrist.position.set(0, -P.foreArm + 0.03, 0);
    elbow.add(wrist);

    return { sign, shoulder, elbow, hand };
  }

  _buildLeg(sign, x, y, parent) {
    const P = PLAYER;
    const r = P.limbRadius;

    const hip = new THREE.Group();
    hip.position.set(x, y, 0);
    parent.add(hip);

    const thigh = this._mesh(
      new THREE.CapsuleGeometry(r * 1.12, P.thigh - r * 2, 6, 12),
      this._skinMat
    );
    thigh.position.set(0, -P.thigh * 0.5, 0);
    hip.add(thigh);

    const knee = new THREE.Group();
    knee.position.set(0, -P.thigh, 0);
    hip.add(knee);

    const shin = this._mesh(
      new THREE.CapsuleGeometry(r * 0.92, P.shin - r * 2, 6, 12),
      this._skinMat
    );
    shin.position.set(0, -P.shin * 0.5, 0);
    knee.add(shin);

    // sock cuff
    const sock = this._mesh(
      new THREE.CylinderGeometry(r * 0.98, r * 0.98, 0.12, 12),
      this._soleMat
    );
    sock.position.set(0, -P.shin + 0.08, 0);
    knee.add(sock);

    // ---- Foot / shoe ---- (ankle pivot so foot can flatten / go on toes)
    const ankle = new THREE.Group();
    ankle.position.set(0, -P.shin, 0);
    knee.add(ankle);

    const shoe = this._mesh(
      new THREE.BoxGeometry(0.11, 0.09, 0.27),
      this._shoeMat
    );
    shoe.position.set(0, -0.045, 0.06);
    ankle.add(shoe);

    const sole = this._mesh(
      new THREE.BoxGeometry(0.12, 0.03, 0.29),
      this._soleMat
    );
    sole.position.set(0, -0.085, 0.06);
    ankle.add(sole);

    // toe cap rounding
    const toe = this._mesh(
      new THREE.SphereGeometry(0.055, 12, 8),
      this._shoeMat
    );
    toe.position.set(0, -0.05, 0.185);
    toe.scale.set(1, 0.9, 1.1);
    ankle.add(toe);

    return { sign, hip, knee, ankle };
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------
  setAnimation(name, opts = {}) {
    if (name !== this._anim) {
      this._prevAnim = this._anim;
      this._anim = name;
      this._blend = 0;         // start crossfade
      // reset locomotion phase only when switching AWAY from a cyclic anim
      if (name !== 'run' && name !== 'dribble') this._cycle = 0;
    }
    if (opts.speed !== undefined) this._speed = opts.speed;
    if (opts.progress !== undefined) this._progress = clamp01(opts.progress);
  }

  update(dt) {
    if (!(dt > 0)) dt = 0;
    this._t += dt;
    if (this._blend < 1) this._blend = Math.min(1, this._blend + dt * 8);

    const a = this._anim;
    const b = smooth(this._blend);

    // Advance cyclic phase for locomotion by distance travelled.
    if (a === 'run' || a === 'dribble') {
      // stride length ~ 1.5 m per full cycle; cap cadence for a jog->sprint feel.
      const cadence = Math.max(0.4, this._speed) / 1.5;
      this._cycle += dt * cadence * Math.PI * 2;
    }

    // Reset skeleton to neutral, then apply the active pose (blended from idle).
    this._resetPose();

    switch (a) {
      case 'run':       this._applyRun(this._cycle, this._speed, b); break;
      case 'dribble':   this._applyDribble(this._cycle, this._speed, b); break;
      case 'shoot':     this._applyShoot(this._progress, b); break;
      case 'pass':      this._applyPass(this._progress, b); break;
      case 'jump':      this._applyJump(this._progress, b); break;
      case 'block':     this._applyBlock(this._progress, b); break;
      case 'defense':   this._applyDefense(b); break;
      case 'celebrate': this._applyCelebrate(this._t, b); break;
      case 'tipoff':    this._applyTipoff(b); break;
      case 'fall':      this._applyFall(b); break;
      case 'idle':
      default:          this._applyIdle(this._t, b); break;
    }

    this._syncAnchors();
  }

  // -------------------------------------------------------------------------
  // Pose primitives
  // -------------------------------------------------------------------------
  // Reset every joint to a neutral standing rest, plus a persistent breathing
  // baseline. Individual _apply* poses then rotate joints from this base and
  // lerp toward the pose by blend `b`.
  _resetPose() {
    this._pelvis.position.set(0, PLAYER.hipHeight, 0);
    this._pelvis.rotation.set(0, 0, 0);
    this._torso.rotation.set(0, 0, 0);
    this._neck.rotation.set(0, 0, 0);

    for (const key in this._arms) {
      const arm = this._arms[key];
      arm.shoulder.rotation.set(0, 0, 0);
      arm.elbow.rotation.set(0, 0, 0);
    }
    for (const key in this._legs) {
      const leg = this._legs[key];
      leg.hip.rotation.set(0, 0, 0);
      leg.knee.rotation.set(0, 0, 0);
      leg.ankle.rotation.set(0, 0, 0);
    }
  }

  // Convenience: set an arm's joints (rotations in radians).
  // sx,sz = shoulder pitch(around Z lifts arm forward/back)/roll; ebend = elbow flex.
  _armPose(arm, shoulderPitch, shoulderRoll, elbowBend, shoulderYaw = 0) {
    arm.shoulder.rotation.set(shoulderPitch, shoulderYaw, shoulderRoll);
    arm.elbow.rotation.set(elbowBend, 0, 0);
  }
  _legPose(leg, hipPitch, kneeBend, anklePitch = 0, hipRoll = 0) {
    leg.hip.rotation.set(hipPitch, 0, hipRoll);
    leg.knee.rotation.set(kneeBend, 0, 0);
    leg.ankle.rotation.set(anklePitch, 0, 0);
  }

  // ---- IDLE: athletic stance, gentle breathing & sway ----
  _applyIdle(t, b) {
    const breath = Math.sin(t * 1.6) * 0.5 + 0.5;   // 0..1
    const sway = Math.sin(t * 0.9) * 0.02;

    const R = this._arms.R, L = this._arms.L;
    // arms hang, elbows slightly bent, resting a touch forward
    this._blendArm(R, 0.14, -0.22, 0.30, b);
    this._blendArm(L, 0.14, 0.22, 0.30, b);
    // slight knee bend (ready stance)
    this._blendLeg(this._legs.R, -0.08, 0.16, 0.02, b);
    this._blendLeg(this._legs.L, -0.08, 0.16, 0.02, b);

    // breathing: subtle torso rise + chest expansion via pelvis micro-lift
    this._pelvis.position.y = PLAYER.hipHeight + breath * 0.008;
    this._torso.rotation.x = lerp(this._torso.rotation.x, 0.02 + breath * 0.015, b);
    this._torso.rotation.z = lerp(this._torso.rotation.z, sway, b);
    this._neck.rotation.z = lerp(this._neck.rotation.z, -sway * 0.6, b);
    this._neck.rotation.y = lerp(this._neck.rotation.y, Math.sin(t * 0.5) * 0.08, b);
  }

  // ---- RUN: opposing arm/leg swing, forward lean, vertical bob ----
  _applyRun(cycle, speed, b) {
    const s = clamp01(speed / PLAYER.moveSpeed);
    const amp = lerp(0.35, 0.95, s);           // swing amplitude by speed
    const swing = Math.sin(cycle);
    const oppose = Math.sin(cycle + Math.PI);

    // legs: hip drives fore/aft, knee flexes on the recovery half
    const rKnee = 0.35 + Math.max(0, -swing) * 0.9;
    const lKnee = 0.35 + Math.max(0, -oppose) * 0.9;
    this._blendLeg(this._legs.R, swing * amp * 0.9, rKnee, -swing * 0.25, b);
    this._blendLeg(this._legs.L, oppose * amp * 0.9, lKnee, -oppose * 0.25, b);

    // arms swing opposite to legs, elbows bent ~90deg
    this._blendArm(this._arms.R, oppose * amp * 0.9, -0.14, 1.15, b);
    this._blendArm(this._arms.L, swing * amp * 0.9, 0.14, 1.15, b);

    // forward lean + vertical bob (2x cadence)
    const bob = Math.abs(Math.cos(cycle)) * lerp(0.01, 0.05, s);
    this._pelvis.position.y = PLAYER.hipHeight - lerp(0.02, 0.07, s) + bob;
    this._torso.rotation.x = lerp(this._torso.rotation.x, lerp(0.08, 0.26, s), b);
    // slight counter-rotation of shoulders vs hips
    this._torso.rotation.y = lerp(this._torso.rotation.y, swing * 0.12 * s, b);
    this._pelvis.rotation.y = lerp(this._pelvis.rotation.y, -swing * 0.10 * s, b);
    this._neck.rotation.x = lerp(this._neck.rotation.x, -lerp(0.04, 0.14, s), b);
  }

  // ---- DRIBBLE: crouch, one hand pumping down at hip/knee height ----
  _applyDribble(cycle, speed, b) {
    // legs travel like a controlled run/jog but with a crouch
    const s = clamp01(speed / PLAYER.moveSpeed);
    const amp = lerp(0.18, 0.6, s);
    const swing = Math.sin(cycle);
    const oppose = Math.sin(cycle + Math.PI);

    const rKnee = 0.55 + Math.max(0, -swing) * 0.6;
    const lKnee = 0.55 + Math.max(0, -oppose) * 0.6;
    this._blendLeg(this._legs.R, swing * amp, rKnee, 0.02, b);
    this._blendLeg(this._legs.L, oppose * amp, lKnee, 0.02, b);

    // crouch
    this._pelvis.position.y = PLAYER.hipHeight - 0.12;
    this._torso.rotation.x = lerp(this._torso.rotation.x, 0.18, b);

    // Right hand is the dribbling hand: reaches down and pumps.
    // Pump uses a faster phase so the hand meets the ball near its low point.
    const pump = Math.sin(this._t * this._dribbleRate) * 0.5 + 0.5;   // 0..1
    const handDown = lerp(0.9, 1.35, pump);   // shoulder pitch forward-down
    this._blendArm(this._arms.R, handDown, -0.28, 0.55 + pump * 0.35, b);
    // off arm guards the ball, out to the side
    this._blendArm(this._arms.L, 0.35, 0.55, 1.0, b);

    // slight lateral lean toward the ball side
    this._torso.rotation.z = lerp(this._torso.rotation.z, -0.06, b);
  }

  // ---- SHOOT: gather -> rise -> release (progress 0..1) ----
  _applyShoot(p, b) {
    p = smooth(p);
    // Three phases: gather (0..0.4), rise (0.4..0.75), release (0.75..1)
    const gather = clamp01(p / 0.4);
    const rise = clamp01((p - 0.4) / 0.35);
    const release = clamp01((p - 0.75) / 0.25);

    // Crouch during gather, extend up onto balls of feet at release.
    const crouch = gather * (1 - rise) * 0.5;                 // peaks mid-gather
    const extend = release;                                    // rise onto toes
    this._pelvis.position.y = PLAYER.hipHeight - 0.16 * crouch + 0.06 * extend;

    const kneeBend = lerp(0.7, 0.15, rise) * (1 - 0.6 * release) + 0.12;
    this._blendLeg(this._legs.R, -0.02, kneeBend, -0.15 - extend * 0.45, b);
    this._blendLeg(this._legs.L, -0.02, kneeBend, -0.15 - extend * 0.45, b);

    this._torso.rotation.x = lerp(this._torso.rotation.x, lerp(0.14, -0.06, rise), b);

    // Shooting arm (Right): from gathered at chest to fully extended up-forward.
    // shoulderPitch grows toward overhead; elbow flexes at gather then snaps.
    const shPitch = lerp(1.1, 2.55, p);          // forward/up
    const elbow = lerp(1.7, 0.12, rise) * (1 - release) + 0.06;
    // wrist snap at release: tiny extra shoulder + forward hand via ankle-like
    const snap = release * 0.18;
    this._blendArm(this._arms.R, shPitch + snap, -0.1, elbow, b);

    // Guide hand (Left): supports at gather, peels off during rise.
    const gElbow = lerp(1.6, 0.5, rise);
    const gPitch = lerp(1.0, 1.9, p) * (1 - release * 0.4);
    this._blendArm(this._arms.L, gPitch, 0.22 + release * 0.2, gElbow, b);

    // eyes up to the rim
    this._neck.rotation.x = lerp(this._neck.rotation.x, -0.18 * rise, b);
  }

  // ---- PASS: chest -> arms forward (progress 0..1) ----
  _applyPass(p, b) {
    p = smooth(p);
    const wind = clamp01(p / 0.35);        // draw ball to chest
    const push = clamp01((p - 0.35) / 0.65);

    this._pelvis.position.y = PLAYER.hipHeight - 0.05 * (1 - push);
    this._blendLeg(this._legs.R, 0.05, 0.3 - push * 0.12, 0.0, b);
    this._blendLeg(this._legs.L, -0.05 - push * 0.12, 0.28, 0.0, b);

    // Both arms: from tucked (elbows in) to extended forward horizontally.
    const shPitch = lerp(1.0 - 0.15 * wind, 1.55, push);  // toward horizontal-forward
    const elbow = lerp(1.5, 0.15, push);
    this._blendArm(this._arms.R, shPitch, -0.28 + push * 0.16, elbow, b);
    this._blendArm(this._arms.L, shPitch, 0.28 - push * 0.16, elbow, b);

    this._torso.rotation.x = lerp(this._torso.rotation.x, 0.05 + push * 0.06, b);
  }

  // ---- JUMP: crouch then both arms up (progress 0..1) ----
  _applyJump(p, b) {
    p = smooth(p);
    const crouch = clamp01(p / 0.3);
    const extend = clamp01((p - 0.3) / 0.7);

    this._pelvis.position.y = PLAYER.hipHeight - 0.22 * crouch * (1 - extend) + 0.05 * extend;
    const kneeBend = lerp(1.0, 0.06, extend) * (1 - 0) + 0.06;
    const ankle = -0.2 - extend * 0.5;
    this._blendLeg(this._legs.R, lerp(0.1, -0.05, extend), kneeBend, ankle, b);
    this._blendLeg(this._legs.L, lerp(0.1, -0.05, extend), kneeBend, ankle, b);

    // arms swing from back (loaded) to straight overhead
    const shPitch = lerp(-0.4, 2.9, p);
    this._blendArm(this._arms.R, shPitch, -0.08, lerp(0.6, 0.05, extend), b);
    this._blendArm(this._arms.L, shPitch, 0.08, lerp(0.6, 0.05, extend), b);
    this._torso.rotation.x = lerp(this._torso.rotation.x, lerp(0.2, -0.05, extend), b);
  }

  // ---- BLOCK: like jump but arms straight up/forward, contest ----
  _applyBlock(p, b) {
    p = smooth(p);
    const crouch = clamp01(p / 0.25);
    const extend = clamp01((p - 0.25) / 0.75);

    this._pelvis.position.y = PLAYER.hipHeight - 0.2 * crouch * (1 - extend) + 0.06 * extend;
    const kneeBend = lerp(0.95, 0.05, extend);
    this._blendLeg(this._legs.R, 0.05, kneeBend, -0.2 - extend * 0.5, b);
    this._blendLeg(this._legs.L, 0.05, kneeBend, -0.2 - extend * 0.5, b);

    // both arms straight up, slightly forward to contest the shot
    const shPitch = lerp(0.6, 2.75, p);
    this._blendArm(this._arms.R, shPitch, -0.06, lerp(0.4, 0.03, extend), b);
    this._blendArm(this._arms.L, shPitch, 0.06, lerp(0.4, 0.03, extend), b);
    this._torso.rotation.x = lerp(this._torso.rotation.x, -0.05 * extend, b);
    this._neck.rotation.x = lerp(this._neck.rotation.x, -0.2 * extend, b);
  }

  // ---- DEFENSE: wide low stance, arms out ----
  _applyDefense(b) {
    // slow active shuffle sway
    const sway = Math.sin(this._t * 3.0) * 0.05;
    this._pelvis.position.y = PLAYER.hipHeight - 0.22;
    // wide stance: legs splayed via hip roll
    this._blendLeg(this._legs.R, 0.02, 0.75, 0.05, b);
    this._blendLeg(this._legs.L, 0.02, 0.75, 0.05, b);
    this._legs.R.hip.rotation.z = lerp(this._legs.R.hip.rotation.z, 0.22, b);
    this._legs.L.hip.rotation.z = lerp(this._legs.L.hip.rotation.z, -0.22, b);

    // arms spread out low, ready to react
    this._blendArm(this._arms.R, 0.5 + sway, -1.05, 0.35, b);
    this._blendArm(this._arms.L, 0.5 - sway, 1.05, 0.35, b);
    this._torso.rotation.x = lerp(this._torso.rotation.x, 0.16, b);
    this._torso.rotation.y = lerp(this._torso.rotation.y, sway * 0.4, b);
  }

  // ---- CELEBRATE: arms up, cyclic fist pump ----
  _applyCelebrate(t, b) {
    const pump = Math.sin(t * 6.0) * 0.5 + 0.5;   // 0..1
    const jump = Math.abs(Math.sin(t * 3.0)) * 0.04;
    this._pelvis.position.y = PLAYER.hipHeight + jump;
    this._blendLeg(this._legs.R, -0.05, 0.2, 0.0, b);
    this._blendLeg(this._legs.L, -0.05, 0.2, 0.0, b);

    // arms overhead, elbows flexing for the pump
    const elbow = lerp(0.15, 1.1, pump);
    this._blendArm(this._arms.R, 2.7, -0.25, elbow, b);
    this._blendArm(this._arms.L, 2.7, 0.25, elbow, b);
    this._torso.rotation.x = lerp(this._torso.rotation.x, -0.08, b);
    this._neck.rotation.x = lerp(this._neck.rotation.x, -0.12, b);
  }

  // ---- TIPOFF: one arm straight up, reaching ----
  _applyTipoff(b) {
    // rise onto toes, right arm fully extended overhead
    this._pelvis.position.y = PLAYER.hipHeight + 0.05;
    this._blendLeg(this._legs.R, -0.05, 0.1, -0.5, b);
    this._blendLeg(this._legs.L, -0.05, 0.1, -0.5, b);

    this._blendArm(this._arms.R, 2.95, -0.05, 0.03, b);   // straight up
    this._blendArm(this._arms.L, 0.25, 0.4, 0.7, b);       // off arm balances
    this._torso.rotation.x = lerp(this._torso.rotation.x, -0.06, b);
    this._neck.rotation.x = lerp(this._neck.rotation.x, -0.25, b);
  }

  // ---- FALL: simple deep crouch / stumble ----
  _applyFall(b) {
    this._pelvis.position.y = PLAYER.hipHeight - 0.4;
    this._blendLeg(this._legs.R, 0.6, 1.4, 0.2, b);
    this._blendLeg(this._legs.L, 0.2, 1.2, 0.2, b);
    this._blendArm(this._arms.R, 1.1, -0.5, 0.4, b);
    this._blendArm(this._arms.L, 1.0, 0.5, 0.4, b);
    this._torso.rotation.x = lerp(this._torso.rotation.x, 0.5, b);
    this._torso.rotation.z = lerp(this._torso.rotation.z, 0.12, b);
  }

  // -------------------------------------------------------------------------
  // Blended joint setters (lerp current rotation toward target by b).
  // Shoulder convention: rotation.x pitches the arm forward (+ = forward/down
  //   in front). We instead use rotation about X to raise/lower along the
  //   sagittal plane and rotation.z to splay out to the side (roll).
  // Because arms hang along -Y, a positive X rotation swings the hand FORWARD
  //   (+X, the facing direction). Larger X (>~1.57) brings it up overhead.
  // -------------------------------------------------------------------------
  _blendArm(arm, pitchX, rollZ, elbow, b) {
    const s = arm.shoulder.rotation;
    s.x = lerp(s.x, pitchX, b);
    s.z = lerp(s.z, rollZ * arm.sign * -1, b);   // roll outward per side
    const e = arm.elbow.rotation;
    e.x = lerp(e.x, elbow, b);
  }

  _blendLeg(leg, hipX, knee, ankle, b) {
    const h = leg.hip.rotation;
    h.x = lerp(h.x, hipX, b);
    const k = leg.knee.rotation;
    k.x = lerp(k.x, knee, b);
    const a = leg.ankle.rotation;
    a.x = lerp(a.x, ankle, b);
  }

  // -------------------------------------------------------------------------
  // Anchor sync — place handAnchor at the ball-handling (right) hand and
  // releaseAnchor at the shot release point for the current pose.
  // -------------------------------------------------------------------------
  _syncAnchors() {
    const arm = this._arms.R;
    // World position of the right hand, converted into group-local space.
    arm.hand.getWorldPosition(_v);
    this.group.worldToLocal(_v);

    const a = this._anim;
    if (a === 'shoot') {
      // Release point stays overhead/forward the entire shot; the carried ball
      // (handAnchor) rises from the chest gather up to that release point.
      const p = this._progress;
      const rx = 0.20, ry = PLAYER.height + 0.24, rz = 0.16;
      this.releaseAnchor.position.set(rx, ry, rz);
      const cx = 0.24, cy = PLAYER.hipHeight + PLAYER.torsoHeight * 0.75, cz = 0.02;
      const t = clamp01(p / 0.8);
      this.handAnchor.position.set(lerp(cx, rx, t), lerp(cy, ry, t), lerp(cz, rz, t));
    } else if (a === 'pass') {
      // hand at chest moving forward; release forward at chest height.
      this.handAnchor.position.copy(_v);
      this.releaseAnchor.position.set(0.5, PLAYER.hipHeight + PLAYER.torsoHeight * 0.6, 0.0);
    } else {
      // Default: ball lives at the right hand (dribble/run/idle/carry).
      this.handAnchor.position.copy(_v);
      this.releaseAnchor.position.set(0.30, PLAYER.height + 0.20, 0.0);
    }
  }
}
