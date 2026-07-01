/**
 * GameState.js — the match director.
 * Owns score, clocks, possession, quarter flow, tip-off, dead-ball resets,
 * loose-ball rebounds/steals, and which player the user controls.
 * It also owns the user PlayerController and the AI, and drives the whole sim
 * each frame via update(dt).
 */
import * as THREE from 'three';
import { COURT, RULES, PLAYER, BALL } from '../config/Constants.js';
import { PlayerController } from './PlayerController.js';
import { AI } from './AI.js';
import { computeShot, shotQuality, passVelocity } from './Shooting.js';

const DIFF = {
  rookie:  { skill: 0.34, react: 0.55, shootUrge: 0.45, steal: 0.6, stealResist: 0.65 },
  pro:     { skill: 0.55, react: 0.8,  shootUrge: 0.6,  steal: 0.9, stealResist: 0.5 },
  allstar: { skill: 0.76, react: 1.0,  shootUrge: 0.72, steal: 1.15, stealResist: 0.38 },
};

const GRAB_RADIUS = 1.15;
const REBOUND_REACH = 2.9;
const SCORE_FREEZE = 1.15;
const SETUP_TIME = 0.7;
const TIPOFF_TIME = 2.4;
const BREAK_TIME = 2.6;

export class GameState {
  constructor(world) {
    this.w = world;
    this.userCtrl = new PlayerController(world.input, world.camera3d);
    this.ai = new AI();

    this.score = { home: 0, away: 0 };
    this.quarter = 1;
    this.clock = 0;
    this.shotClock = RULES.shotClockSeconds;
    this.possession = 'home';
    this.phase = 'tipoff';           // tipoff|live|setup|freeze|break|final
    this.userPlayer = null;
    this._userLocked = null;
    this._timer = 0;
    this._excitement = 0;
    this._looseExclude = null;
    this._looseExcludeT = 0;
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();

    // physics events
    const ph = world.physics;
    ph.onScore = (side, worth, shooter) => this._onScore(side, worth, shooter);
    ph.onFloorBounce = (vol) => this.w.audio.bounce(vol);
    ph.onRimHit = () => this.w.audio.rim();
    ph.onBackboardHit = () => this.w.audio.backboard();
    ph.onOutOfBounds = (pos) => this._onOutOfBounds(pos);
  }

  start(config) {
    this.diff = DIFF[config.difficulty] || DIFF.pro;
    this.quarterLen = config.quarterSeconds;
    this.score.home = 0; this.score.away = 0;
    this.quarter = 1;
    this.clock = this.quarterLen;
    this.w.hud.setScore(0, 0);
    this.w.hud.setQuarter('Q1');
    this.w.hud.setClock(this.clock);
    this.w.audio.startAmbience();
    this._tipoff();
  }

  // ---------------- team / geometry helpers ----------------
  other(team) { return team === 'home' ? 'away' : 'home'; }
  sideOf(team) { return team === 'home' ? 1 : -1; }        // hoop the team attacks
  targetHoop(team) { return team === 'home' ? this.w.hoops.plus : this.w.hoops.minus; }
  defendHoop(team) { return team === 'home' ? this.w.hoops.minus : this.w.hoops.plus; }
  targetRim(team) { return this.targetHoop(team).userData.rimCenter; }
  ownRim(team) { return this.defendHoop(team).userData.rimCenter; }
  attackDir(team) { return team === 'home' ? { x: 1, z: 0 } : { x: -1, z: 0 }; }
  teamPlayers(team) { return this.w.players[team]; }
  teammatesOf(p) { return this.w.players[p.teamKey].filter((q) => q !== p); }
  opponentsOf(p) { return this.w.players[this.other(p.teamKey)]; }
  isOffense(p) { return p.teamKey === this.possession; }
  get ball() { return this.w.ball; }
  get ballHandler() { return this.w.ball.holder; }

  nearestOpponent(p) {
    let best = null, bd = Infinity;
    for (const o of this.opponentsOf(p)) {
      const d = o.group.position.distanceTo(p.group.position);
      if (d < bd) { bd = d; best = o; }
    }
    return { player: best, dist: bd };
  }
  nearestOf(list, pos) {
    let best = null, bd = Infinity;
    for (const q of list) {
      const d = q.group.position.distanceTo(pos);
      if (d < bd) { bd = d; best = q; }
    }
    return { player: best, dist: bd };
  }

  // ---------------- main tick ----------------
  update(dt) {
    this._tickPhase(dt);
    if (this._looseExcludeT > 0) { this._looseExcludeT -= dt; if (this._looseExcludeT <= 0) this._looseExclude = null; }

    const canAct = this.phase === 'live' || this.phase === 'setup';
    // decide + move players
    this.ai.update(dt, this);
    if (canAct) this.userCtrl.update(dt, this);
    else if (this.userPlayer) this.userCtrl.idle(dt, this);

    // integrate free ball, then carry/roll visual
    this.w.physics.update(dt);
    this.ball.update(dt);

    if (this.phase === 'live') this._pickup(dt);

    for (const p of this.w.allPlayers) p.update(dt);

    this._assignUserControl();
    this._excitement = Math.max(0, this._excitement - dt * 0.35);
    this.w.audio.setExcitement(this._excitement);

    return this.ball.position;
  }

  // ---------------- clocks & phase timers ----------------
  _tickPhase(dt) {
    if (this.phase === 'live') {
      this.clock -= dt;
      this.shotClock -= dt;
      this.w.hud.setClock(Math.max(0, this.clock));
      this.w.hud.setShotClock(Math.max(0, Math.ceil(this.shotClock)));
      if (this.clock <= 0) { this._endQuarter(); return; }
      if (this.shotClock <= 0 && this.ball.state === 'held') {
        this.w.hud.announce('SHOT CLOCK');
        this.w.audio.whistle();
        this._setup(this.other(this.possession), null);
      }
    } else {
      this._timer -= dt;
      if (this._timer <= 0) {
        if (this.phase === 'tipoff') this._goLiveFromTip();
        else if (this.phase === 'setup') { this.phase = 'live'; }
        else if (this.phase === 'freeze') this._setup(this._freezeNext, null);
        else if (this.phase === 'break') this._startQuarter();
      }
    }
  }

  // ---------------- tip-off ----------------
  _tipoff() {
    this.phase = 'tipoff';
    this._timer = TIPOFF_TIME;
    this._placeTipoff();
    // drop the ball at center
    this.ball.setLoose(new THREE.Vector3((Math.random() - 0.5) * 0.4, 1.5, (Math.random() - 0.5) * 0.4));
    this.ball.holder = null;
    this.ball.position.set(0, 4.4, 0);
    this.ball.lastTouchTeam = null;
    this.w.physics.reset();
    this.w.hud.announce('TIP OFF');
    this.w.hud.setShotClock(RULES.shotClockSeconds);
    this.w.camera.snap(this.ball.position);
  }
  _goLiveFromTip() {
    // if nobody grabbed the tip, award to a random team at center
    if (this.ball.state !== 'held') {
      const team = Math.random() < 0.5 ? 'home' : 'away';
      this._giveBallTo(this.teamPlayers(team)[0]);
    }
    this.possession = this.ball.holder ? this.ball.holder.teamKey : 'home';
    this.shotClock = RULES.shotClockSeconds;
    this.phase = 'live';
  }

  // ---------------- scoring ----------------
  _onScore(side, worth, shooter) {
    if (this.phase !== 'live') return;
    const team = side > 0 ? 'home' : 'away';
    this.score[team] += worth;
    this.w.hud.setScore(this.score.home, this.score.away);
    this.w.audio.swish();
    this.w.audio.cheer(0.7 + 0.3 * (worth === 3 ? 1 : 0));
    this._excitement = 1;
    this.w.camera.shake(worth === 3 ? 0.7 : 0.45);
    const msgs = worth === 3 ? ['THREE!', 'FROM DOWNTOWN!', 'BANG!'] : ['BUCKET!', 'AND-ONE FEEL!', 'SCORES!'];
    this.w.hud.announce(msgs[Math.floor(Math.random() * msgs.length)]);
    // conceding team inbounds
    this.phase = 'freeze';
    this._timer = SCORE_FREEZE;
    this._freezeNext = this.other(team);
  }

  _onOutOfBounds(pos) {
    if (this.phase !== 'live') return;
    const award = this.other(this.ball.lastTouchTeam || this.possession);
    this.w.hud.announce('OUT OF BOUNDS');
    this._setup(award, pos.clone());
  }

  // ---------------- possession / setup ----------------
  _giveBallTo(player, dribble = true) {
    this.ball.attachTo(player, dribble);
    this.possession = player.teamKey;
  }

  _setup(offenseTeam, spot) {
    this.possession = offenseTeam;
    this.shotClock = RULES.shotClockSeconds;
    this.w.hud.setShotClock(RULES.shotClockSeconds);
    this._userLocked = null;
    this._placeHalfcourt(offenseTeam, spot);
    this.w.physics.reset();
    this.phase = 'setup';
    this._timer = SETUP_TIME;
    this.w.camera.snap(this.ball.position);
  }

  // ---------------- quarters ----------------
  _endQuarter() {
    this.w.audio.buzzer();
    this.w.camera.shake(0.4);
    if (this.quarter >= RULES.quarters && this.score.home !== this.score.away) {
      this._final();
      return;
    }
    if (this.quarter >= RULES.quarters) {
      this.w.hud.announce('OVERTIME');
    } else {
      this.w.hud.announce('END OF Q' + this.quarter);
    }
    this.phase = 'break';
    this._timer = BREAK_TIME;
  }
  _startQuarter() {
    this.quarter += 1;
    this.clock = this.quarter > RULES.quarters ? 300 : this.quarterLen; // OT = 5:00
    const label = this.quarter > RULES.quarters ? 'OT' + (this.quarter - RULES.quarters) : 'Q' + this.quarter;
    this.w.hud.setQuarter(label);
    this.w.hud.setClock(this.clock);
    // alternate possession to start each quarter
    this._setup(this.quarter % 2 === 0 ? 'away' : 'home', null);
  }
  _final() {
    this.phase = 'final';
    this.ball.state = 'loose';
    this.w.audio.stopAmbience();
    this.w.audio.cheer(1);
    if (this.onFinal) this.onFinal({
      homeTeam: this.w.teams.home, awayTeam: this.w.teams.away,
      homeScore: this.score.home, awayScore: this.score.away,
    });
  }

  // ---------------- loose-ball pickup ----------------
  _pickup(dt) {
    const ball = this.ball;
    if (ball.state === 'held') return;
    if (ball.position.y > REBOUND_REACH) return;
    // no goaltending: a live shot can't be plucked out of the air up high
    // (defenders contest via the block system); only grab it once it's low.
    if (ball.state === 'flight' && !ball._pass && ball.position.y > 1.7) return;
    let best = null, bd = GRAB_RADIUS;
    for (const p of this.w.allPlayers) {
      if (p === this._looseExclude) continue;
      const dp = p.group.position;
      const d = Math.hypot(dp.x - ball.position.x, dp.z - ball.position.z);
      const reachOk = ball.position.y < PLAYER.height * 0.98 + (p._reachBonus || 0);
      if (d < bd && reachOk) { bd = d; best = p; }
    }
    if (best) {
      const wasPass = ball._pass;
      const changed = best.teamKey !== this.possession;
      this._giveBallTo(best);
      if (changed) {
        this.shotClock = RULES.shotClockSeconds;
        if (!wasPass) { this.w.audio.cheer(0.35); this._excitement = Math.max(this._excitement, 0.5); }
      } else if (!wasPass) {
        this.shotClock = Math.max(this.shotClock, 14); // offensive rebound
      }
      this.w.audio.bounce(0.3);
    }
  }

  // ---------------- actions (called by controller & AI) ----------------
  shootBall(shooter, releaseQuality) {
    if (this.ball.holder !== shooter) return;
    const rim = this.targetRim(shooter.teamKey);
    shooter.releaseAnchor.getWorldPosition(this._tmp);
    const from = this._tmp;
    const dist = Math.hypot(rim.x - shooter.group.position.x, rim.z - shooter.group.position.z);
    const opp = this.nearestOpponent(shooter);
    const openness = THREE.MathUtils.clamp((opp.dist - 0.5) / 2.4, 0, 1);
    const q = shotQuality(dist, openness, releaseQuality, shooter.skill);
    const worth = this._isThree(shooter.group.position, rim) ? 3 : 2;
    const vel = computeShot(from, rim, q);
    this.ball.position.copy(from);          // launch from the release point
    this.ball.release(vel, worth, shooter);
    this.w.audio.dribbleTick(0.3);
    this._excitement = Math.max(this._excitement, 0.3);
  }

  passBall(passer, receiver) {
    if (this.ball.holder !== passer || !receiver) return;
    passer.handAnchor.getWorldPosition(this._tmp);
    this.ball.position.copy(this._tmp);     // launch from the passer's hand
    // lead the receiver
    const rp = receiver.group.position;
    const rv = receiver._vel || { x: 0, z: 0 };
    this._tmp2.set(rp.x + rv.x * 0.25, 1.2, rp.z + rv.z * 0.25);
    const vel = passVelocity(this._tmp, this._tmp2, 14);
    this.ball.pass(vel, passer);
    this._looseExclude = passer;
    this._looseExcludeT = 0.28;
    this.w.audio.pass();
  }

  attemptSteal(defender) {
    if (this.phase !== 'live') return false;
    if (defender._stealCd > 0) return false;
    defender._stealCd = 0.5;
    const handler = this.ball.holder;
    if (handler && handler.teamKey !== defender.teamKey) {
      const d = defender.group.position.distanceTo(handler.group.position);
      if (d < PLAYER.reach + 0.4) {
        const chance = 0.14 * this.diff.steal * (defender.skill + 0.3) - 0.1 * handler.skill;
        if (Math.random() < chance) {
          // knock loose toward the defender
          const dir = this._tmp.subVectors(defender.group.position, handler.group.position).setY(0).normalize();
          this.ball.setLoose(new THREE.Vector3(dir.x * 2.4, 1.1, dir.z * 2.4));
          this.ball.lastTouchTeam = defender.teamKey;
          this.ball.position.set(handler.group.position.x + dir.x * 0.4, 0.9, handler.group.position.z + dir.z * 0.4);
          this._looseExclude = handler; this._looseExcludeT = 0.25;
          this.w.hud.announce('STEAL!');
          this._excitement = Math.max(this._excitement, 0.6);
          return true;
        }
      }
    }
    return false;
  }

  attemptBlock(defender) {
    const ball = this.ball;
    if (ball.state !== 'flight' || ball._pass) return false;
    if (ball.lastShooter && ball.lastShooter.teamKey === defender.teamKey) return false;
    defender.releaseAnchor.getWorldPosition(this._tmp);
    const d = this._tmp.distanceTo(ball.position);
    if (d < PLAYER.reach + 0.5 && ball.position.y < 3.35 && ball.velocity.y > -1.5) {
      const chance = 0.16 * this.diff.steal * (defender.skill + 0.25);
      if (Math.random() < chance) {
        const dir = this._tmp2.subVectors(ball.position, this._tmp).setY(0.2).normalize();
        ball.velocity.set(dir.x * 5, -1.5, dir.z * 5);
        ball._pass = false; ball.lastShooter = null;
        ball.lastTouchTeam = defender.teamKey;
        this.w.audio.backboard();
        this.w.hud.announce('BLOCKED!');
        this._excitement = Math.max(this._excitement, 0.7);
        return true;
      }
    }
    return false;
  }

  _isThree(pos, rim) {
    const dz = Math.abs(pos.z);
    const d = Math.hypot(pos.x - rim.x, pos.z - rim.z);
    const cornerZ = COURT.halfWidth - COURT.cornerThreeFromSideline;
    if (dz >= cornerZ - 0.05) return d >= 6.60;
    return d >= (7.24 - 0.12);
  }

  // ---------------- user control assignment ----------------
  _assignUserControl() {
    const home = this.w.players.home;
    const ball = this.ball;
    if (ball.holder && ball.holder.teamKey === 'home') {
      this.userPlayer = ball.holder;
      this._userLocked = null;
      return;
    }
    if (this._userLocked && this._userLocked.teamKey === 'home') {
      this.userPlayer = this._userLocked;
      return;
    }
    // default: nearest home player to the ball
    const n = this.nearestOf(home, ball.position);
    this.userPlayer = n.player || home[0];
  }
  switchUserPlayer() {
    const home = this.w.players.home;
    const cur = this.userPlayer;
    const sorted = home.filter((p) => p !== cur)
      .sort((a, b) => a.group.position.distanceTo(this.ball.position) - b.group.position.distanceTo(this.ball.position));
    if (sorted.length) { this.userPlayer = sorted[0]; this._userLocked = sorted[0]; }
  }

  // ---------------- placement ----------------
  _placeTipoff() {
    const place = (p, x, z) => { p.group.position.set(x, 0, z); p._vel && p._vel.set(0, 0, 0); p.setAnimation('idle'); };
    const h = this.w.players.home, a = this.w.players.away;
    place(h[0], -0.9, 0); h[0].setAnimation('tipoff');
    place(a[0], 0.9, 0); a[0].setAnimation('tipoff');
    place(h[1], -4, 4); place(h[2], -4, -4); place(h[3], -8, 2.5); place(h[4], -8, -2.5);
    place(a[1], 4, 4); place(a[2], 4, -4); place(a[3], 8, 2.5); place(a[4], 8, -2.5);
    for (const p of this.w.allPlayers) { const d = this.attackDir(p.teamKey); p.group.rotation.y = Math.atan2(-d.z, d.x); }
  }

  offenseSpots(team) {
    const dir = this.sideOf(team);                  // +1 home attacks +X
    return [
      { x: 2.5 * dir, z: 0 },
      { x: 6.5 * dir, z: 5.5 },
      { x: 6.5 * dir, z: -5.5 },
      { x: 10 * dir, z: 3 },
      { x: 10 * dir, z: -3 },
    ];
  }

  _placeHalfcourt(offenseTeam, spot) {
    const dir = this.sideOf(offenseTeam);           // +1 home attacks +X
    const off = this.teamPlayers(offenseTeam);
    const def = this.teamPlayers(this.other(offenseTeam));
    const spots = this.offenseSpots(offenseTeam);
    for (let i = 0; i < 5; i++) {
      off[i].group.position.set(spots[i].x, 0, spots[i].z);
      off[i]._vel && off[i]._vel.set(0, 0, 0);
      off[i].setAnimation('idle');
      const d = this.attackDir(offenseTeam); off[i].group.rotation.y = Math.atan2(-d.z, d.x);
      // defender guards the man, positioned toward own basket
      def[i].group.position.set(spots[i].x - dir * 1.6, 0, spots[i].z * 0.85);
      def[i]._vel && def[i]._vel.set(0, 0, 0);
      def[i].setAnimation('defense');
      const dd = this.attackDir(this.other(offenseTeam)); def[i].group.rotation.y = Math.atan2(-dd.z, dd.x);
    }
    // ball to the point guard (or nearest to spot if provided)
    let handler = off[0];
    if (spot) {
      const near = this.nearestOf(off, new THREE.Vector3(THREE.MathUtils.clamp(spot.x, -COURT.halfLength + 1, COURT.halfLength - 1), 0, THREE.MathUtils.clamp(spot.z, -COURT.halfWidth + 1, COURT.halfWidth - 1)));
      handler = near.player || off[0];
    }
    this._giveBallTo(handler);
    this.ball.position.copy(handler.handAnchor.getWorldPosition(this._tmp));
  }
}
