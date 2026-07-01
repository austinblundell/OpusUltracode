/**
 * Input.js — unified keyboard / mouse / gamepad / touch input.
 *
 * Query from controllers:
 *   input.move            -> {x, y}  screen-relative (y = forward, x = right), length<=1
 *   input.sprint          -> bool (held)
 *   input.shootHeld       -> bool (held)
 *   input.pressed(action) -> edge this frame ; input.released(action) -> release edge
 *   input.isDown(action)  -> held
 * Actions: 'shoot','pass','steal','switch','pause','sprint','up','down','left','right'
 * Call input.update() once at END of each frame to clear edges & re-poll the gamepad.
 */
const KEYMAP = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  shoot: ['Space'],
  pass: ['KeyE'],
  steal: ['KeyQ'],
  switch: ['KeyF'],
  pause: ['KeyP', 'Escape'],
};
// gamepad button index -> action
const PADMAP = { 0: 'shoot', 1: 'steal', 2: 'pass', 3: 'switch', 5: 'sprint', 9: 'pause' };

export class Input {
  constructor(target = window) {
    this.down = new Set();
    this.justPressed = new Set();
    this.justReleased = new Set();
    this.mouse = { x: 0, y: 0, dx: 0, dy: 0, down: false };

    this._touchHeld = {};
    this._touchPressed = {};
    this._touchReleased = {};
    this._touchMove = { x: 0, y: 0 };

    this._padHeld = {};
    this._padPressed = {};
    this._padReleased = {};
    this._padMove = { x: 0, y: 0 };
    this._prevPad = {};

    target.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      this.down.add(e.code);
      this.justPressed.add(e.code);
    });
    target.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.justReleased.add(e.code);
    });
    window.addEventListener('blur', () => { this.down.clear(); });
    window.addEventListener('mousemove', (e) => {
      this.mouse.dx += e.movementX || 0;
      this.mouse.dy += e.movementY || 0;
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
    });
    window.addEventListener('mousedown', () => { this.mouse.down = true; });
    window.addEventListener('mouseup', () => { this.mouse.down = false; });

    this._initTouch();
  }

  _codes(action) { return KEYMAP[action] || []; }

  isDown(action) {
    if (this._touchHeld[action] || this._padHeld[action]) return true;
    return this._codes(action).some((c) => this.down.has(c));
  }
  pressed(action) {
    if (this._touchPressed[action] || this._padPressed[action]) return true;
    return this._codes(action).some((c) => this.justPressed.has(c));
  }
  released(action) {
    if (this._touchReleased[action] || this._padReleased[action]) return true;
    return this._codes(action).some((c) => this.justReleased.has(c));
  }

  get sprint() { return this.isDown('sprint'); }
  get shootHeld() { return this.isDown('shoot'); }

  get move() {
    let x = 0, y = 0;
    if (this.isDown('left')) x -= 1;
    if (this.isDown('right')) x += 1;
    if (this.isDown('up')) y += 1;
    if (this.isDown('down')) y -= 1;
    x += this._touchMove.x + this._padMove.x;
    y += this._touchMove.y + this._padMove.y;
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    return { x, y };
  }

  update() {
    this._pollGamepad();
    this.justPressed.clear();
    this.justReleased.clear();
    this._touchPressed = {};
    this._touchReleased = {};
    this.mouse.dx = 0; this.mouse.dy = 0;
  }

  _pollGamepad() {
    this._padMove = { x: 0, y: 0 };
    this._padPressed = {};
    this._padReleased = {};
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = null;
    for (const p of pads) { if (p) { pad = p; break; } }
    if (!pad) { this._padHeld = {}; this._prevPad = {}; return; }
    const dz = 0.22;
    const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
    if (Math.abs(ax) > dz) this._padMove.x = ax;
    if (Math.abs(ay) > dz) this._padMove.y = -ay;
    const held = {};
    for (const idx in PADMAP) {
      const action = PADMAP[idx];
      const btn = pad.buttons[+idx];
      const now = btn ? btn.pressed : false;
      const prev = this._prevPad[idx] || false;
      if (now) held[action] = true;
      if (now && !prev) this._padPressed[action] = true;
      if (!now && prev) this._padReleased[action] = true;
      this._prevPad[idx] = now;
    }
    this._padHeld = held;
  }

  _initTouch() {
    const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    const tc = document.getElementById('touch-controls');
    if (!isTouch || !tc) return;
    tc.classList.remove('hidden');

    const joy = document.getElementById('joystick');
    const knob = document.getElementById('joystick-knob');
    let joyId = null, cx = 0, cy = 0, R = 55;
    const setKnob = (dx, dy) => { if (knob) knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`; };
    const moveJoy = (t) => {
      let dx = t.clientX - cx, dy = t.clientY - cy;
      const len = Math.hypot(dx, dy);
      if (len > R) { dx = dx / len * R; dy = dy / len * R; }
      setKnob(dx, dy);
      this._touchMove.x = dx / R;
      this._touchMove.y = -dy / R;
    };
    const endJoy = () => { joyId = null; this._touchMove.x = 0; this._touchMove.y = 0; setKnob(0, 0); };

    if (joy) {
      joy.addEventListener('touchstart', (e) => {
        const r = joy.getBoundingClientRect();
        cx = r.left + r.width / 2; cy = r.top + r.height / 2; R = r.width / 2;
        joyId = e.changedTouches[0].identifier; moveJoy(e.changedTouches[0]); e.preventDefault();
      }, { passive: false });
      window.addEventListener('touchmove', (e) => {
        for (const t of e.changedTouches) if (t.identifier === joyId) { moveJoy(t); e.preventDefault(); }
      }, { passive: false });
      window.addEventListener('touchend', (e) => {
        for (const t of e.changedTouches) if (t.identifier === joyId) endJoy();
      });
    }
    document.querySelectorAll('.touch-btn').forEach((b) => {
      const act = b.getAttribute('data-act');
      b.addEventListener('touchstart', (e) => { this._touchHeld[act] = true; this._touchPressed[act] = true; e.preventDefault(); }, { passive: false });
      b.addEventListener('touchend', (e) => { this._touchHeld[act] = false; this._touchReleased[act] = true; e.preventDefault(); }, { passive: false });
    });
  }
}
