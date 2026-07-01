/**
 * main.js — bootstrap, world assembly, menu flow, and the game loop.
 */
import * as THREE from 'three';
import { createEngine } from './engine/Renderer.js';
import { Input } from './engine/Input.js';
import { AudioManager } from './engine/Audio.js';
import { createCourt } from './world/Court.js';
import { createHoop } from './world/Hoop.js';
import { createArena } from './world/Arena.js';
import { setupLighting } from './world/Lighting.js';
import { Ball } from './entities/Ball.js';
import { Player } from './entities/Player.js';
import { Physics } from './systems/Physics.js';
import { CameraRig } from './systems/CameraRig.js';
import { GameState } from './systems/GameState.js';
import { HUD } from './ui/HUD.js';
import { Menu } from './ui/Menu.js';
import { TEAMS, SKIN_TONES } from './config/Constants.js';

const NAMES = ['Reyes', 'Okafor', 'Petrov', 'Chen', 'Silva', 'Novak', 'Diallo', 'Hayes',
  'Ford', 'Mensah', 'Kane', 'Ruiz', 'Adebayo', 'Larsen', 'Cole', 'Vidic'];

class Game {
  constructor() {
    const canvas = document.getElementById('game-canvas');
    const { renderer, scene, camera } = createEngine(canvas);
    this.renderer = renderer; this.scene = scene; this.camera = camera;

    this.lighting = setupLighting(scene, renderer);
    scene.add(createCourt());
    this.hoopPlus = createHoop(1);
    this.hoopMinus = createHoop(-1);
    scene.add(this.hoopPlus, this.hoopMinus);
    this.arena = createArena();
    scene.add(this.arena.group);

    this.ball = new Ball();
    scene.add(this.ball.mesh);

    this.input = new Input();
    this.audio = new AudioManager();
    this.ball.onBounce = (v) => this.audio.bounce(v);
    this.hud = new HUD();
    this.cameraRig = new CameraRig(camera);
    this.physics = new Physics(this.ball, [this.hoopMinus, this.hoopPlus]);

    // selection ring for the user-controlled player
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.6, 40),
      new THREE.MeshBasicMaterial({ color: 0xffcc33, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.03;
    this.ring.visible = false;
    scene.add(this.ring);

    this.playerGroup = new THREE.Group();
    scene.add(this.playerGroup);

    this.running = false;
    this.paused = false;
    this.gs = null;
    this.lastConfig = null;

    this.menu = new Menu({
      onTipoff: (cfg) => { this.audio.resume(); this.startGame(cfg); },
      onResume: () => { this.paused = false; },
      onQuit: () => this.quitToMenu(),
      onRematch: () => { if (this.lastConfig) { this.audio.resume(); this.startGame(this.lastConfig); } },
    });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyC' && this.running) {
        this.cameraRig.setMode(this.cameraRig.mode === 'follow' ? 'broadcast' : 'follow');
      }
    });
    window.addEventListener('pointerdown', () => this.audio.resume(), { once: true });

    this._clock = performance.now();
    this._acc = 0;
    this._loop = this._loop.bind(this);
  }

  async boot() {
    const steps = [
      [12, 'Polishing the hardwood…'],
      [34, 'Raising the arena…'],
      [58, 'Rigging the lights…'],
      [78, 'Filling the seats…'],
      [92, 'Lacing up…'],
      [100, 'Ready'],
    ];
    for (const [pct, txt] of steps) {
      this.menu.setLoading(pct, txt);
      await new Promise((r) => setTimeout(r, 90));
    }
    this.menu.hideLoading();
    this.menu.showMenu();
    requestAnimationFrame(this._loop);
  }

  _buildTeam(teamData, teamKey, isUserTeam) {
    const players = [];
    const nums = new Set();
    for (let i = 0; i < 5; i++) {
      let n; do { n = Math.floor(Math.random() * 55); } while (nums.has(n)); nums.add(n);
      const p = new Player({
        team: teamData,
        skin: SKIN_TONES[Math.floor(Math.random() * SKIN_TONES.length)],
        number: n,
        name: NAMES[Math.floor(Math.random() * NAMES.length)],
        isUser: isUserTeam && i === 0,
      });
      p.teamKey = teamKey;
      p.roleIndex = i;
      p.skill = 0.44 + Math.random() * 0.26 + (i < 3 ? 0.05 : 0);
      p._stealCd = 0;
      players.push(p);
      this.playerGroup.add(p.group);
    }
    return players;
  }

  startGame(config) {
    this.lastConfig = config;
    // clear previous players
    while (this.playerGroup.children.length) this.playerGroup.remove(this.playerGroup.children[0]);

    const home = this._buildTeam(config.homeTeam, 'home', true);
    const away = this._buildTeam(config.awayTeam, 'away', false);
    const world = {
      config,
      teams: { home: config.homeTeam, away: config.awayTeam },
      players: { home, away },
      allPlayers: home.concat(away),
      ball: this.ball,
      hoops: { plus: this.hoopPlus, minus: this.hoopMinus },
      physics: this.physics,
      hud: this.hud, audio: this.audio,
      camera: this.cameraRig, camera3d: this.camera,
      input: this.input,
    };
    this.gs = new GameState(world);
    this.gs.onFinal = (result) => { this.running = false; this.hud.hide(); this.menu.showFinal(result); };

    this.cameraRig.setMode(config.camera || 'broadcast');
    this.hud.setTeams(config.homeTeam, config.awayTeam);
    this.hud.setHint('WASD move · hold SPACE to shoot · E pass · SHIFT sprint · Q steal · F switch · P pause');
    this.hud.show();
    this.menu.hideAll();

    this.ring.material.color.setHex(config.homeTeam.primary);
    this.paused = false;
    this.running = true;
    this.gs.start(config);
  }

  quitToMenu() {
    this.running = false;
    this.paused = false;
    this.gs = null;
    this.hud.hide();
    this.ring.visible = false;
    this.audio.stopAmbience();
    this.menu.hideAll();
    this.menu.showMenu();
  }

  _updateRing() {
    const gs = this.gs;
    const show = gs && gs.userPlayer && (gs.phase === 'live' || gs.phase === 'setup');
    this.ring.visible = !!show;
    if (show) {
      const p = gs.userPlayer.group.position;
      this.ring.position.set(p.x, 0.03, p.z);
      this.ring.material.opacity = 0.55 + 0.35 * (0.5 + 0.5 * Math.sin(performance.now() * 0.006));
    }
  }

  _loop(now) {
    requestAnimationFrame(this._loop);
    let dt = (now - this._clock) / 1000;
    this._clock = now;
    if (dt > 0.2) dt = 0.2;

    // pause toggle
    if (this.running && this.input.pressed('pause')) {
      this.paused = !this.paused;
      if (this.paused) this.menu.showPause(); else this.menu.hidePause();
    }

    if (this.running && !this.paused && this.gs) {
      this._acc += dt;
      const STEP = 1 / 60;
      let n = 0;
      while (this._acc >= STEP && n < 5) { this.gs.update(STEP); this._acc -= STEP; n++; }
      if (this._acc > STEP) this._acc = 0;
    }

    // per-frame visuals
    this.lighting.update && this.lighting.update(dt);
    this.arena.update(dt, this.gs ? this.gs._excitement : 0);
    this.hoopPlus.userData.net.update(dt);
    this.hoopMinus.userData.net.update(dt);

    if (this.running && this.gs) {
      const atk = this.gs.attackDir('home');
      this.cameraRig.update(dt, this.ball.position, this.gs.userPlayer, atk);
      this._updateRing();
    } else {
      // slow showcase orbit behind the menu
      const a = now * 0.00013;
      this.camera.position.set(Math.cos(a) * 27, 13, Math.sin(a) * 27);
      this.camera.lookAt(0, 2.2, 0);
      this.ring.visible = false;
    }

    this.input.update();
    this.renderer.render(this.scene, this.camera);
  }
}

const game = new Game();
game.boot();
window.__game = game;   // debug/introspection handle
