/**
 * HUD.js — In-game broadcast HUD controller.
 *
 * Pure DOM. Drives the markup already present in index.html by ID:
 *   #hud, #sb-home-abbr, #sb-home-score, #sb-away-abbr, #sb-away-score,
 *   #sb-clock, #sb-quarter, #sb-shotclock, #announce, #shot-meter,
 *   #meter-perfect, #meter-fill, #meter-marker, #hint-bar.
 *
 * Also sets the --home / --away CSS custom properties on <html> so the
 * scorebug team panels tint to the active matchup.
 *
 * No THREE, no rendering. Every accessor is guarded so a missing element
 * degrades to a no-op instead of throwing.
 */

const STYLE_ID = 'hud-score-pulse-style';

/**
 * Convert a 24-bit integer color (0xRRGGBB) into a '#rrggbb' CSS string.
 * Falls back to already-formatted strings and to '#ffffff' for junk input.
 */
function toHex(color) {
  if (typeof color === 'string') {
    return color.charAt(0) === '#' ? color : '#' + color;
  }
  if (typeof color !== 'number' || !isFinite(color)) return '#ffffff';
  const c = (color & 0xffffff) >>> 0;
  return '#' + c.toString(16).padStart(6, '0');
}

/** Inject the score-pulse keyframes exactly once (self-contained animation). */
function ensurePulseStyle() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent =
    '@keyframes hud-score-pulse{' +
    '0%{transform:scale(1)}' +
    '35%{transform:scale(1.35);color:#fff;text-shadow:0 0 14px rgba(255,255,255,.9)}' +
    '100%{transform:scale(1)}}' +
    '.hud-pulse{animation:hud-score-pulse .45s cubic-bezier(.2,.8,.2,1)}';
  document.head.appendChild(style);
}

export class HUD {
  constructor() {
    ensurePulseStyle();

    const $ = (id) =>
      typeof document !== 'undefined' ? document.getElementById(id) : null;

    this.root = typeof document !== 'undefined' ? document.documentElement : null;

    this.el = {
      hud: $('hud'),
      homeAbbr: $('sb-home-abbr'),
      homeScore: $('sb-home-score'),
      awayAbbr: $('sb-away-abbr'),
      awayScore: $('sb-away-score'),
      clock: $('sb-clock'),
      quarter: $('sb-quarter'),
      shotclock: $('sb-shotclock'),
      announce: $('announce'),
      shotMeter: $('shot-meter'),
      meterPerfect: $('meter-perfect'),
      meterFill: $('meter-fill'),
      meterMarker: $('meter-marker'),
      hint: $('hint-bar'),
    };

    // Track last scores so setScore only pulses the number that changed.
    this._homeScore = null;
    this._awayScore = null;

    // Per-element pulse-cleanup timers.
    this._pulseTimers = new WeakMap();
  }

  // --- Teams -----------------------------------------------------------------

  /**
   * @param {{abbr:string, primary:number}} home
   * @param {{abbr:string, primary:number}} away
   */
  setTeams(home, away) {
    if (home) {
      if (this.el.homeAbbr) this.el.homeAbbr.textContent = home.abbr || 'HOME';
      if (this.root && home.primary != null) {
        this.root.style.setProperty('--home', toHex(home.primary));
      }
    }
    if (away) {
      if (this.el.awayAbbr) this.el.awayAbbr.textContent = away.abbr || 'AWAY';
      if (this.root && away.primary != null) {
        this.root.style.setProperty('--away', toHex(away.primary));
      }
    }
  }

  // --- Score -----------------------------------------------------------------

  setScore(homeScore, awayScore) {
    if (this.el.homeScore) {
      this.el.homeScore.textContent = String(homeScore);
      if (this._homeScore !== null && homeScore !== this._homeScore) {
        this._pulse(this.el.homeScore);
      }
    }
    if (this.el.awayScore) {
      this.el.awayScore.textContent = String(awayScore);
      if (this._awayScore !== null && awayScore !== this._awayScore) {
        this._pulse(this.el.awayScore);
      }
    }
    this._homeScore = homeScore;
    this._awayScore = awayScore;
  }

  /** Retrigger the pulse animation on a single element. */
  _pulse(node) {
    if (!node) return;
    node.classList.remove('hud-pulse');
    // Force reflow so re-adding the class restarts the animation.
    void node.offsetWidth;
    node.classList.add('hud-pulse');

    const prev = this._pulseTimers.get(node);
    if (prev) clearTimeout(prev);
    const t = setTimeout(() => {
      node.classList.remove('hud-pulse');
      this._pulseTimers.delete(node);
    }, 500);
    this._pulseTimers.set(node, t);
  }

  // --- Clock -----------------------------------------------------------------

  /** Format seconds as M:SS, or SS.s when under a minute for a broadcast feel. */
  setClock(seconds) {
    if (!this.el.clock) return;
    let s = Math.max(0, Number(seconds) || 0);
    let text;
    if (s < 60) {
      // Tenths under a minute (e.g. "9.4").
      text = s.toFixed(1);
    } else {
      const total = Math.ceil(s);
      const m = Math.floor(total / 60);
      const sec = total % 60;
      text = m + ':' + String(sec).padStart(2, '0');
    }
    this.el.clock.textContent = text;
  }

  // --- Shot clock ------------------------------------------------------------

  setShotClock(seconds) {
    const node = this.el.shotclock;
    if (!node) return;
    if (seconds == null) {
      node.textContent = '';
      node.classList.remove('warn');
      return;
    }
    const val = Math.max(0, Math.ceil(Number(seconds) || 0));
    node.textContent = String(val);
    node.classList.toggle('warn', val <= 5);
  }

  // --- Quarter ---------------------------------------------------------------

  setQuarter(text) {
    if (this.el.quarter) this.el.quarter.textContent = text == null ? '' : String(text);
  }

  // --- Announcement ----------------------------------------------------------

  announce(text) {
    const node = this.el.announce;
    if (!node) return;
    node.textContent = text == null ? '' : String(text);
    // Restart the .show animation: remove, force reflow, re-add.
    node.classList.remove('show');
    void node.offsetWidth;
    node.classList.add('show');
  }

  // --- Shot meter ------------------------------------------------------------

  /**
   * Reveal the meter and place the "perfect" band.
   * @param {number} perfectStart 0..1
   * @param {number} perfectEnd   0..1
   */
  showMeter(perfectStart, perfectEnd) {
    if (this.el.meterPerfect) {
      let a = Math.min(perfectStart, perfectEnd);
      let b = Math.max(perfectStart, perfectEnd);
      a = Math.max(0, Math.min(1, a));
      b = Math.max(0, Math.min(1, b));
      this.el.meterPerfect.style.left = (a * 100).toFixed(2) + '%';
      this.el.meterPerfect.style.width = ((b - a) * 100).toFixed(2) + '%';
    }
    // Reset the fill/marker to the start for a clean sweep.
    if (this.el.meterFill) this.el.meterFill.style.width = '0%';
    if (this.el.meterMarker) this.el.meterMarker.style.left = '0%';
    if (this.el.shotMeter) this.el.shotMeter.classList.remove('hidden');
  }

  /** @param {number} pos 0..1 travel of the sweeping marker/fill. */
  updateMeter(pos) {
    const p = Math.max(0, Math.min(1, Number(pos) || 0));
    const pct = (p * 100).toFixed(2) + '%';
    if (this.el.meterFill) this.el.meterFill.style.width = pct;
    if (this.el.meterMarker) this.el.meterMarker.style.left = pct;
  }

  hideMeter() {
    if (this.el.shotMeter) this.el.shotMeter.classList.add('hidden');
  }

  // --- Hint bar --------------------------------------------------------------

  setHint(text) {
    if (this.el.hint) this.el.hint.textContent = text == null ? '' : String(text);
  }

  // --- Visibility ------------------------------------------------------------

  show() {
    if (this.el.hud) this.el.hud.classList.remove('hidden');
  }

  hide() {
    if (this.el.hud) this.el.hud.classList.add('hidden');
  }
}
