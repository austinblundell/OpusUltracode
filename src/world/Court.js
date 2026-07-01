/**
 * Court.js — Full basketball court as a static THREE.Group.
 *
 * Centered at world origin, floor TOP surface at Y = 0.
 * Everything is procedural: a warm maple hardwood via CanvasTexture, and all
 * NBA-proportioned markings on a separate high-res transparent overlay.
 *
 * Coordinate system (right-handed, Y up):
 *   ±X = court LENGTH (baseline to baseline)
 *   ±Z = court WIDTH  (sideline to sideline)
 *   side = -1 → -X basket (HOME);  side = +1 → +X basket (AWAY)
 */

import * as THREE from 'three';
import { COURT, VISUAL, rimCenterX } from '../config/Constants.js';

// ---------------------------------------------------------------------------
// Small color helpers
// ---------------------------------------------------------------------------

function hexToCss(hex) {
  return '#' + hex.toString(16).padStart(6, '0');
}

// Mix two 0xRRGGBB colors by t in [0,1], return a css rgb() string.
function mixCss(a, b, t) {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `rgb(${r},${g},${bl})`;
}

// Deterministic pseudo-random so the court looks identical each load.
function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Wood floor texture (warm maple planks running along X)
// ---------------------------------------------------------------------------

function createWoodTexture() {
  const W = 2048;
  const H = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const rng = makeRng(0x9e3779b1);

  // Base warm fill.
  ctx.fillStyle = hexToCss(COURT.woodColor);
  ctx.fillRect(0, 0, W, H);

  // Planks run along the X (court length) axis → horizontal bands in the
  // texture (V maps to court width). Give each plank a slightly different tone.
  const plankCount = 26;
  const plankH = H / plankCount;

  for (let i = 0; i < plankCount; i++) {
    const y0 = Math.floor(i * plankH);
    const y1 = Math.floor((i + 1) * plankH);
    const tone = 0.5 + rng() * 0.5; // 0.5..1 toward dark
    const base = mixCss(COURT.woodColor, COURT.woodColorDark, tone * 0.55);

    // Subtle vertical gradient inside the plank for a rounded, waxed feel.
    const grad = ctx.createLinearGradient(0, y0, 0, y1);
    grad.addColorStop(0, mixCss(COURT.woodColor, COURT.woodColorDark, tone * 0.35));
    grad.addColorStop(0.5, base);
    grad.addColorStop(1, mixCss(COURT.woodColor, COURT.woodColorDark, tone * 0.65));
    ctx.fillStyle = grad;
    ctx.fillRect(0, y0, W, y1 - y0);

    // Grain streaks — long, faint horizontal strokes along the plank.
    const streaks = 34 + Math.floor(rng() * 22);
    for (let s = 0; s < streaks; s++) {
      const gy = y0 + rng() * (y1 - y0);
      const gx = rng() * W;
      const len = 120 + rng() * 620;
      const dark = rng() > 0.5;
      ctx.strokeStyle = dark
        ? `rgba(70,48,26,${0.04 + rng() * 0.08})`
        : `rgba(255,228,180,${0.03 + rng() * 0.06})`;
      ctx.lineWidth = 0.6 + rng() * 1.4;
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      // Gently wavering grain.
      const midx = gx + len * 0.5;
      ctx.quadraticCurveTo(midx, gy + (rng() - 0.5) * 4, gx + len, gy + (rng() - 0.5) * 3);
      ctx.stroke();
    }

    // A few knots for character.
    if (rng() > 0.72) {
      const kx = rng() * W;
      const ky = y0 + plankH * (0.3 + rng() * 0.4);
      const kr = 3 + rng() * 6;
      const kg = ctx.createRadialGradient(kx, ky, 0, kx, ky, kr * 2.4);
      kg.addColorStop(0, 'rgba(60,38,18,0.5)');
      kg.addColorStop(0.5, 'rgba(90,60,30,0.22)');
      kg.addColorStop(1, 'rgba(90,60,30,0)');
      ctx.fillStyle = kg;
      ctx.beginPath();
      ctx.arc(kx, ky, kr * 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Plank seams — dark grooves between rows.
  ctx.lineWidth = 1.5;
  for (let i = 0; i <= plankCount; i++) {
    const y = Math.round(i * plankH) + 0.5;
    ctx.strokeStyle = 'rgba(48,30,14,0.55)';
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
    // Faint highlight just below the seam.
    ctx.strokeStyle = 'rgba(255,235,200,0.10)';
    ctx.beginPath();
    ctx.moveTo(0, y + 1.5);
    ctx.lineTo(W, y + 1.5);
    ctx.stroke();
  }

  // Occasional butt-joints (end seams) staggered across planks so it doesn't
  // read as continuous strips.
  ctx.strokeStyle = 'rgba(48,30,14,0.4)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < plankCount; i++) {
    const y0 = i * plankH;
    const joints = 2 + Math.floor(rng() * 3);
    for (let j = 0; j < joints; j++) {
      const x = rng() * W;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, y0);
      ctx.lineTo(x + 0.5, y0 + plankH);
      ctx.stroke();
    }
  }

  // Broad, low-frequency tonal variation across the whole floor.
  const blotches = 40;
  for (let b = 0; b < blotches; b++) {
    const bx = rng() * W;
    const by = rng() * H;
    const br = 120 + rng() * 320;
    const warm = rng() > 0.5;
    const bg = ctx.createRadialGradient(bx, by, 0, bx, by, br);
    const col = warm ? '255,220,160' : '90,62,32';
    bg.addColorStop(0, `rgba(${col},${0.05 + rng() * 0.05})`);
    bg.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  // Repeat a couple of times along the length so plank tone doesn't tile
  // too obviously; keep 1:1 across width to preserve plank count/scale.
  tex.repeat.set(2, 1);
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// Markings overlay texture (all painted lines / paint / logo)
// ---------------------------------------------------------------------------

function createMarkingsTexture() {
  // High-res overlay. Aspect matches the drawn area (court + apron) so lines
  // do not stretch. We draw over the FULL slab area (court length x width).
  const W = 4096;
  const H = 2048;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Meters -> pixels. The overlay plane spans exactly COURT.length x COURT.width,
  // so map that range across the full canvas.
  const pxPerMX = W / COURT.length;
  const pxPerMZ = H / COURT.width;
  // Uniform scale for radii (court px density is essentially isotropic here).
  const pxPerM = (pxPerMX + pxPerMZ) / 2;

  // World (x,z) -> canvas (px,py). World origin at canvas center.
  // Canvas +y points down; world +z points to one sideline. Keep +z at bottom.
  const cx = (x) => (x + COURT.halfLength) * pxPerMX;
  const cz = (z) => (z + COURT.halfWidth) * pxPerMZ;

  const line = hexToCss(COURT.lineColor);
  const lineW = COURT.lineWidth * pxPerM;

  ctx.clearRect(0, 0, W, H);
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = line;
  ctx.fillStyle = line;

  // ---- Painted keys / lanes (draw fills first, so lines sit on top) --------
  const paintCss = hexToCss(COURT.paintColor);
  for (const side of [-1, 1]) {
    const baselineX = side * COURT.halfLength;
    const ftX = baselineX - side * COURT.keyLength; // free-throw line X
    const x0 = Math.min(cx(baselineX), cx(ftX));
    const x1 = Math.max(cx(baselineX), cx(ftX));
    const z0 = cz(-COURT.keyWidth / 2);
    const z1 = cz(COURT.keyWidth / 2);
    ctx.save();
    ctx.globalAlpha = 0.82;
    ctx.fillStyle = paintCss;
    ctx.fillRect(x0, z0, x1 - x0, z1 - z0);
    ctx.restore();
  }

  ctx.strokeStyle = line;
  ctx.fillStyle = line;

  // ---- Boundary rectangle --------------------------------------------------
  ctx.lineWidth = lineW;
  ctx.strokeRect(
    cx(-COURT.halfLength),
    cz(-COURT.halfWidth),
    COURT.length * pxPerMX,
    COURT.width * pxPerMZ,
  );

  // ---- Center line ---------------------------------------------------------
  ctx.beginPath();
  ctx.moveTo(cx(0), cz(-COURT.halfWidth));
  ctx.lineTo(cx(0), cz(COURT.halfWidth));
  ctx.stroke();

  // ---- Center circle -------------------------------------------------------
  ctx.beginPath();
  ctx.arc(cx(0), cz(0), COURT.centerCircleRadius * pxPerM, 0, Math.PI * 2);
  ctx.stroke();

  // ---- Per-end markings ----------------------------------------------------
  for (const side of [-1, 1]) {
    const baselineX = side * COURT.halfLength;
    const ftX = baselineX - side * COURT.keyLength;
    const basketX = rimCenterX(side);

    // Key outline.
    ctx.beginPath();
    ctx.rect(
      Math.min(cx(baselineX), cx(ftX)),
      cz(-COURT.keyWidth / 2),
      Math.abs(cx(ftX) - cx(baselineX)),
      COURT.keyWidth * pxPerMZ,
    );
    ctx.stroke();

    // Free-throw circle (top half solid; bottom half dashed by convention).
    const ftCx = cx(ftX);
    const ftCy = cz(0);
    const ftR = COURT.freeThrowRadius * pxPerM;
    // Half facing away from baseline = solid; toward baseline = dashed.
    // side=-1 baseline at -X: solid half opens toward +X (center).
    const solidStart = side < 0 ? -Math.PI / 2 : Math.PI / 2;
    ctx.beginPath();
    ctx.arc(ftCx, ftCy, ftR, solidStart, solidStart + Math.PI);
    ctx.stroke();
    // Dashed half.
    ctx.save();
    ctx.setLineDash([ftR * 0.32, ftR * 0.22]);
    ctx.beginPath();
    ctx.arc(ftCx, ftCy, ftR, solidStart + Math.PI, solidStart + Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Restricted-area arc under the rim (semicircle opening toward center).
    const rCx = cx(basketX);
    const rCy = cz(0);
    const rR = COURT.restrictedRadius * pxPerM;
    const restStart = side < 0 ? -Math.PI / 2 : Math.PI / 2;
    ctx.beginPath();
    ctx.arc(rCx, rCy, rR, restStart, restStart + Math.PI);
    ctx.stroke();
    // Short backboard-side connectors of the restricted arc down to baseline.
    const bx = cx(basketX);
    const conX = bx; // arc endpoints sit on z=±rR at basket X
    ctx.beginPath();
    ctx.moveTo(conX, cz(-COURT.restrictedRadius));
    ctx.lineTo(cx(baselineX), cz(-COURT.restrictedRadius));
    ctx.moveTo(conX, cz(COURT.restrictedRadius));
    ctx.lineTo(cx(baselineX), cz(COURT.restrictedRadius));
    ctx.stroke();

    // ---- Three-point line ------------------------------------------------
    // Corner straights parallel to sidelines at z = ±(halfWidth - cornerFromSideline).
    const cornerZ = COURT.halfWidth - COURT.cornerThreeFromSideline;
    const R3 = COURT.threePointRadius;
    // Arc meets straight where circle (center basketX,0) crosses z = ±cornerZ.
    // dx from basket center along X toward center court:
    const dx = Math.sqrt(Math.max(0, R3 * R3 - cornerZ * cornerZ));
    const arcEndX = basketX - side * dx; // toward center

    // Corner straight lines from baseline to the arc-intersection X.
    ctx.beginPath();
    ctx.moveTo(cx(baselineX), cz(-cornerZ));
    ctx.lineTo(cx(arcEndX), cz(-cornerZ));
    ctx.moveTo(cx(baselineX), cz(cornerZ));
    ctx.lineTo(cx(arcEndX), cz(cornerZ));
    ctx.stroke();

    // Arc between the two intersection points, passing over the top (center side).
    // Angle measured in canvas space from basket center.
    // Intersection points: (arcEndX, ±cornerZ). Compute their canvas angles.
    const bcx = cx(basketX);
    const bcy = cz(0);
    const a1 = Math.atan2(cz(cornerZ) - bcy, cx(arcEndX) - bcx);
    const a2 = Math.atan2(cz(-cornerZ) - bcy, cx(arcEndX) - bcx);
    ctx.beginPath();
    // Draw the arc through the center-court-facing side (the "top" of the arc).
    if (side < 0) {
      // basket at -X, arc bulges toward +X. Canvas +x is toward +X.
      ctx.arc(bcx, bcy, R3 * pxPerM, a2, a1, false);
    } else {
      // basket at +X, arc bulges toward -X.
      ctx.arc(bcx, bcy, R3 * pxPerM, a1, a2, false);
    }
    ctx.stroke();

    // Free-throw lane hash marks (short ticks along the key sides).
    const hashLen = 0.18 * pxPerM;
    const hashPositions = [0.28, 0.42, 0.56, 0.70];
    for (const t of hashPositions) {
      const hx = cx(baselineX - side * COURT.keyLength * t);
      for (const zside of [-1, 1]) {
        const zEdge = cz(zside * COURT.keyWidth / 2);
        const zOut = cz(zside * (COURT.keyWidth / 2 + 0.18));
        ctx.beginPath();
        ctx.moveTo(hx, zEdge);
        ctx.lineTo(hx, zOut);
        ctx.stroke();
      }
    }
  }

  // ---- Center-court logo ---------------------------------------------------
  drawCenterLogo(ctx, cx(0), cz(0), pxPerM);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

// Tasteful center-court emblem + "FULL COURT" wordmark.
function drawCenterLogo(ctx, px, py, pxPerM) {
  const logo = hexToCss(COURT.logoColor);
  const R = COURT.centerCircleRadius * pxPerM;

  ctx.save();
  ctx.translate(px, py);

  // Faint filled disc under the emblem for legibility.
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = logo;
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.78, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Emblem: a stylized ball with seam lines inside a ring.
  ctx.strokeStyle = logo;
  ctx.fillStyle = logo;
  const er = R * 0.42;

  // Outer emblem ring.
  ctx.lineWidth = R * 0.05;
  ctx.beginPath();
  ctx.arc(0, 0, er, 0, Math.PI * 2);
  ctx.stroke();

  // Ball seams.
  ctx.lineWidth = R * 0.035;
  ctx.beginPath();
  ctx.moveTo(0, -er);
  ctx.lineTo(0, er);
  ctx.moveTo(-er, 0);
  ctx.lineTo(er, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(0, 0, er * 0.55, er, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(0, 0, er, er * 0.55, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Wordmark, curved along the top and bottom of the emblem ring.
  ctx.fillStyle = logo;
  const fontPx = R * 0.16;
  ctx.font = `700 ${fontPx}px Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  drawCurvedText(ctx, 'FULL COURT', er + fontPx * 0.9, -Math.PI / 2, true);
  drawCurvedText(ctx, 'BASKETBALL', er + fontPx * 0.9, Math.PI / 2, false);

  ctx.restore();
}

// Draw text on a circle. centerAngle in radians (canvas space, 0 = +x, cw+).
// topArc=true renders text upright along the top; false along the bottom.
function drawCurvedText(ctx, text, radius, centerAngle, topArc) {
  const chars = text.split('');
  // Approx angular width per char.
  const perChar = 0.14;
  const total = chars.length * perChar;
  const dir = topArc ? 1 : -1;
  let angle = centerAngle - dir * (total / 2) + dir * (perChar / 2);
  for (const ch of chars) {
    ctx.save();
    ctx.rotate(angle);
    ctx.translate(0, topArc ? -radius : radius);
    if (!topArc) ctx.rotate(Math.PI);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
    angle += dir * perChar;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the full basketball court.
 * @returns {THREE.Group} static group centered at origin, floor top at Y=0.
 */
export function createCourt() {
  const group = new THREE.Group();
  group.name = 'Court';

  // ---- Large dark base plane under everything -----------------------------
  const baseSize = Math.max(COURT.length, COURT.width) * 3.2;
  const baseGeo = new THREE.PlaneGeometry(baseSize, baseSize);
  const baseMat = new THREE.MeshStandardMaterial({
    color: VISUAL.skyTop,
    roughness: 1.0,
    metalness: 0.0,
  });
  const base = new THREE.Mesh(baseGeo, baseMat);
  base.rotation.x = -Math.PI / 2;
  base.position.y = -COURT.thickness - 0.02;
  base.receiveShadow = true;
  base.name = 'CourtBase';
  group.add(base);

  // ---- Apron (darker floor extending beyond the court) --------------------
  const m = COURT.outOfBoundsMargin;
  const apronGeo = new THREE.BoxGeometry(
    COURT.length + m * 2,
    COURT.thickness * 0.9,
    COURT.width + m * 2,
  );
  const apronMat = new THREE.MeshStandardMaterial({
    color: VISUAL.floorApronColor,
    roughness: 0.85,
    metalness: 0.0,
  });
  const apron = new THREE.Mesh(apronGeo, apronMat);
  // Top slightly below Y=0 so the hardwood slab reads as sitting proud on it.
  apron.position.y = -COURT.thickness * 0.9 / 2 - 0.006;
  apron.receiveShadow = true;
  apron.name = 'CourtApron';
  group.add(apron);

  // ---- Hardwood slab (top at Y=0, thickness downward) ---------------------
  const woodTex = createWoodTexture();
  const slabGeo = new THREE.BoxGeometry(COURT.length, COURT.thickness, COURT.width);
  const woodMat = new THREE.MeshPhysicalMaterial({
    map: woodTex,
    roughness: 0.34,
    metalness: 0.0,
    clearcoat: 0.4,
    clearcoatRoughness: 0.3,
    color: 0xffffff,
  });
  // Sides/bottom of the slab a plain dark wood; only the top uses the texture.
  const edgeMat = new THREE.MeshStandardMaterial({
    color: COURT.woodColorDark,
    roughness: 0.6,
    metalness: 0.0,
  });
  // BoxGeometry material order: +X, -X, +Y(top), -Y, +Z, -Z
  const slabMats = [edgeMat, edgeMat, woodMat, edgeMat, edgeMat, edgeMat];
  const slab = new THREE.Mesh(slabGeo, slabMats);
  slab.position.y = -COURT.thickness / 2;
  slab.castShadow = true;
  slab.receiveShadow = true;
  slab.name = 'CourtWood';
  group.add(slab);

  // ---- Markings overlay (thin transparent plane just above the wood) ------
  const markTex = createMarkingsTexture();
  const markGeo = new THREE.PlaneGeometry(COURT.length, COURT.width);
  const markMat = new THREE.MeshStandardMaterial({
    map: markTex,
    transparent: true,
    roughness: 0.35,
    metalness: 0.0,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    depthWrite: false,
  });
  const markings = new THREE.Mesh(markGeo, markMat);
  markings.rotation.x = -Math.PI / 2;
  markings.position.y = 0.002;
  markings.receiveShadow = true;
  markings.name = 'CourtMarkings';
  group.add(markings);

  return group;
}
