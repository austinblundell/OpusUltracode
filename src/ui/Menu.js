/**
 * Menu.js — Manages all menu / overlay screens (main menu, controls help,
 * pause, final, loading). Pure DOM, no Three.js. The integrator constructs one
 * Menu with a set of callbacks and drives it via the public helpers.
 */

import { TEAMS } from '../config/Constants.js';

// Control-scheme rows shown in the controls-help grid, as [key, description].
const CONTROL_ROWS = [
  ['WASD / Arrows', 'Move'],
  ['Mouse', 'Aim / steer'],
  ['Hold Space', 'Shoot (release in the green)'],
  ['Shift', 'Sprint'],
  ['E', 'Pass'],
  ['Q', 'Steal / Swat (on defense)'],
  ['F', 'Switch player'],
  ['P / Esc', 'Pause'],
];

// Convert a 0xRRGGBB integer to a "#rrggbb" CSS color string.
function hexColor(n) {
  return '#' + ((n >>> 0) & 0xffffff).toString(16).padStart(6, '0');
}

// Darken a 0xRRGGBB integer by a factor (0..1) and return a CSS color string.
function darken(n, factor) {
  const r = Math.round(((n >> 16) & 0xff) * factor);
  const g = Math.round(((n >> 8) & 0xff) * factor);
  const b = Math.round((n & 0xff) * factor);
  return hexColor((r << 16) | (g << 8) | b);
}

export class Menu {
  /**
   * @param {Object} callbacks
   * @param {(config:Object)=>void} [callbacks.onTipoff]
   * @param {()=>void} [callbacks.onResume]
   * @param {()=>void} [callbacks.onQuit]
   * @param {()=>void} [callbacks.onRematch]
   */
  constructor(callbacks = {}) {
    this.cb = callbacks || {};

    // Currently selected team indices (must always differ).
    this.homeIndex = 0;
    this.awayIndex = TEAMS.length > 1 ? 1 : 0;

    // --- Cache elements (guard for any that may be missing) ---
    this.el = {
      menu: this._get('menu'),
      homeTeam: this._get('home-team'),
      awayTeam: this._get('away-team'),
      optQuarter: this._get('opt-quarter'),
      optDifficulty: this._get('opt-difficulty'),
      optCamera: this._get('opt-camera'),
      tipoffBtn: this._get('tipoff-btn'),
      controlsBtn: this._get('controls-btn'),
      controlsHelp: this._get('controls-help'),
      controlsGrid: this._get('controls-grid'),
      controlsClose: this._get('controls-close'),
      pause: this._get('pause'),
      resumeBtn: this._get('resume-btn'),
      quitBtn: this._get('quit-btn'),
      final: this._get('final'),
      finalScore: this._get('final-score'),
      finalWinner: this._get('final-winner'),
      rematchBtn: this._get('rematch-btn'),
      finalMenuBtn: this._get('final-menu-btn'),
      loading: this._get('loading'),
      loadingFill: this._get('loading-fill'),
      loadingStatus: this._get('loading-status'),
    };

    this._wireTeamButtons();
    this._wireSegmented(this.el.optQuarter);
    this._wireSegmented(this.el.optDifficulty);
    this._wireSegmented(this.el.optCamera);
    this._wireActions();
    this._renderTeams();
  }

  _get(id) {
    return (typeof document !== 'undefined' && document.getElementById)
      ? document.getElementById(id)
      : null;
  }

  // ---------------------------------------------------------------------------
  // Team selection
  // ---------------------------------------------------------------------------
  _wireTeamButtons() {
    if (this.el.homeTeam) {
      this.el.homeTeam.addEventListener('click', () => this._cycleTeam('home'));
    }
    if (this.el.awayTeam) {
      this.el.awayTeam.addEventListener('click', () => this._cycleTeam('away'));
    }
  }

  _cycleTeam(which) {
    const n = TEAMS.length;
    if (n <= 1) return; // nothing to cycle to

    if (which === 'home') {
      let next = (this.homeIndex + 1) % n;
      if (next === this.awayIndex) next = (next + 1) % n;
      this.homeIndex = next;
    } else {
      let next = (this.awayIndex + 1) % n;
      if (next === this.homeIndex) next = (next + 1) % n;
      this.awayIndex = next;
    }
    this._renderTeams();
  }

  _renderTeams() {
    this._renderTeamButton(this.el.homeTeam, TEAMS[this.homeIndex]);
    this._renderTeamButton(this.el.awayTeam, TEAMS[this.awayIndex]);
  }

  _renderTeamButton(btn, team) {
    if (!btn || !team) return;
    const primary = hexColor(team.primary);
    const darker = darken(team.primary, 0.42);
    const trim = hexColor(team.trim);

    btn.style.background = `linear-gradient(160deg, ${primary}, ${darker})`;
    btn.style.borderColor = trim;
    btn.innerHTML =
      `<span class="tb-abbr">${team.abbr}</span>` +
      `<span class="tb-city">${team.city} ${team.name}</span>` +
      `<span class="tb-hint">Tap to change</span>`;
  }

  // ---------------------------------------------------------------------------
  // Segmented controls
  // ---------------------------------------------------------------------------
  _wireSegmented(group) {
    if (!group) return;
    group.addEventListener('click', (e) => {
      const target = e.target && e.target.closest
        ? e.target.closest('button[data-val]')
        : null;
      if (!target || !group.contains(target)) return;
      const buttons = group.querySelectorAll('button[data-val]');
      buttons.forEach((b) => b.classList.remove('active'));
      target.classList.add('active');
    });
  }

  _segValue(group) {
    if (!group) return null;
    const active = group.querySelector('button.active[data-val]')
      || group.querySelector('button[data-val]');
    return active ? active.getAttribute('data-val') : null;
  }

  // ---------------------------------------------------------------------------
  // Action wiring
  // ---------------------------------------------------------------------------
  _wireActions() {
    if (this.el.tipoffBtn) {
      this.el.tipoffBtn.addEventListener('click', () => this._onTipoff());
    }
    if (this.el.controlsBtn) {
      this.el.controlsBtn.addEventListener('click', () => this._showControls());
    }
    if (this.el.controlsClose) {
      this.el.controlsClose.addEventListener('click', () => this._hideControls());
    }
    if (this.el.resumeBtn) {
      this.el.resumeBtn.addEventListener('click', () => {
        this.hidePause();
        if (typeof this.cb.onResume === 'function') this.cb.onResume();
      });
    }
    if (this.el.quitBtn) {
      this.el.quitBtn.addEventListener('click', () => {
        if (typeof this.cb.onQuit === 'function') this.cb.onQuit();
        this.hidePause();
      });
    }
    if (this.el.rematchBtn) {
      this.el.rematchBtn.addEventListener('click', () => {
        if (typeof this.cb.onRematch === 'function') this.cb.onRematch();
      });
    }
    if (this.el.finalMenuBtn) {
      this.el.finalMenuBtn.addEventListener('click', () => {
        if (typeof this.cb.onQuit === 'function') this.cb.onQuit();
        this.showMenu();
      });
    }
  }

  _onTipoff() {
    const quarterRaw = this._segValue(this.el.optQuarter);
    const quarterSeconds = parseInt(quarterRaw, 10);
    const config = {
      homeTeamIndex: this.homeIndex,
      awayTeamIndex: this.awayIndex,
      homeTeam: TEAMS[this.homeIndex],
      awayTeam: TEAMS[this.awayIndex],
      quarterSeconds: Number.isFinite(quarterSeconds) ? quarterSeconds : 300,
      difficulty: this._segValue(this.el.optDifficulty) || 'pro',
      camera: this._segValue(this.el.optCamera) || 'broadcast',
    };
    if (typeof this.cb.onTipoff === 'function') this.cb.onTipoff(config);
    this.hideMenu();
  }

  // ---------------------------------------------------------------------------
  // Controls help
  // ---------------------------------------------------------------------------
  _showControls() {
    this._populateControls();
    this._show(this.el.controlsHelp);
  }

  _hideControls() {
    this._hide(this.el.controlsHelp);
  }

  _populateControls() {
    const grid = this.el.controlsGrid;
    if (!grid) return;
    grid.innerHTML = '';
    for (const [key, desc] of CONTROL_ROWS) {
      const k = document.createElement('div');
      k.className = 'key';
      k.textContent = key;
      const d = document.createElement('div');
      d.className = 'desc';
      d.textContent = desc;
      grid.appendChild(k);
      grid.appendChild(d);
    }
  }

  // ---------------------------------------------------------------------------
  // Final screen
  // ---------------------------------------------------------------------------
  /**
   * @param {Object} result
   * @param {Object} result.homeTeam - team object (needs .abbr)
   * @param {Object} result.awayTeam - team object (needs .abbr)
   * @param {number} result.homeScore
   * @param {number} result.awayScore
   */
  showFinal(result = {}) {
    const { homeTeam, awayTeam, homeScore = 0, awayScore = 0 } = result;
    const homeAbbr = (homeTeam && homeTeam.abbr) ? homeTeam.abbr : 'HOME';
    const awayAbbr = (awayTeam && awayTeam.abbr) ? awayTeam.abbr : 'AWAY';

    if (this.el.finalScore) {
      this.el.finalScore.innerHTML =
        `<span class="fs-abbr">${homeAbbr}</span> ${homeScore} ` +
        `<span class="fs-dash">–</span> ${awayScore} ` +
        `<span class="fs-abbr">${awayAbbr}</span>`;
    }
    if (this.el.finalWinner) {
      let text;
      if (homeScore === awayScore) {
        text = 'TIE GAME';
      } else {
        const winner = homeScore > awayScore ? homeTeam : awayTeam;
        const city = (winner && winner.city) ? winner.city : '';
        text = (city.trim().toUpperCase() || 'HOME') + ' WINS';
      }
      this.el.finalWinner.textContent = text;
    }
    this._show(this.el.final);
  }

  hideFinal() {
    this._hide(this.el.final);
  }

  // ---------------------------------------------------------------------------
  // Pause
  // ---------------------------------------------------------------------------
  showPause() {
    this._show(this.el.pause);
  }

  hidePause() {
    this._hide(this.el.pause);
  }

  // ---------------------------------------------------------------------------
  // Main menu
  // ---------------------------------------------------------------------------
  showMenu() {
    this._renderTeams();
    this._show(this.el.menu);
  }

  hideMenu() {
    this._hide(this.el.menu);
  }

  // ---------------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------------
  /**
   * @param {number} pct - 0..100 completion percentage
   * @param {string} [statusText]
   */
  setLoading(pct, statusText) {
    if (this.el.loadingFill) {
      const clamped = Math.max(0, Math.min(100, Number(pct) || 0));
      this.el.loadingFill.style.width = clamped + '%';
    }
    if (this.el.loadingStatus && typeof statusText === 'string') {
      this.el.loadingStatus.textContent = statusText;
    }
  }

  hideLoading() {
    if (this.el.loading) this.el.loading.classList.add('hidden');
  }

  // ---------------------------------------------------------------------------
  // Hide everything (all overlays)
  // ---------------------------------------------------------------------------
  hideAll() {
    this._hide(this.el.menu);
    this._hide(this.el.controlsHelp);
    this._hide(this.el.pause);
    this._hide(this.el.final);
    this.hideLoading();
  }

  // ---------------------------------------------------------------------------
  // Low-level show/hide
  // ---------------------------------------------------------------------------
  _show(el) {
    if (el) el.classList.remove('hidden');
  }

  _hide(el) {
    if (el) el.classList.add('hidden');
  }
}
