/**
 * Arena.js — The surrounding broadcast arena (everything OUTSIDE the court apron).
 *
 * Does NOT draw the court itself (see Court.js). This module builds the "world"
 * around the court so no void is visible from any broadcast camera angle:
 *   - Tiered, raked spectator stands on all four sides, packed with a colorful
 *     InstancedMesh crowd (a head+shoulders blob per seat, varied per-instance
 *     colors).
 *   - A lower ring of courtside seating, a scorer's table, and animated emissive
 *     LED sideline advertising boards.
 *   - A dark ceiling with a lighting truss/catwalk grid and small emissive lamp
 *     housings (the actual lights live in Lighting.js).
 *   - A central hanging 4-sided JUMBOTRON above center court with emissive
 *     CanvasTexture screens ("FULL COURT").
 *   - Tunnels/entrances, arena floor beyond the stands, and a big dark shell.
 *
 * Coordinate system (right-handed, Y up), floor top surface at Y = 0:
 *   ±X = court LENGTH (baseline to baseline)
 *   ±Z = court WIDTH  (sideline to sideline)
 *
 * Export:
 *   createArena(): { group: THREE.Group, update(dt, excitement=0): void }
 */

import * as THREE from 'three';
import { COURT, VISUAL } from '../config/Constants.js';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function hexToCss(hex) {
  return '#' + (hex >>> 0).toString(16).padStart(6, '0');
}

// Mix two 0xRRGGBB colors by t in [0,1] → new 0xRRGGBB int.
function mixHex(a, b, t) {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

// Deterministic pseudo-random so the arena looks identical each load.
function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Geometry footprint of the seating bowl
// ---------------------------------------------------------------------------
// The bowl is a rectangular ring: an inner edge (front row, just outside the
// court apron) and it rakes UP and OUT as rows recede. We build 4 straight
// decks (two along X sidelines-ends, two along Z baselines) — actually decks on
// all four sides framing the court.

const APRON = COURT.outOfBoundsMargin;               // floor margin outside lines
const INNER_X = COURT.halfLength + APRON + 1.2;      // front row X (end zones)
const INNER_Z = COURT.halfWidth + APRON + 1.2;       // front row Z (sidelines)

const ROWS = 22;            // seating rows per deck
const ROW_RISE = 0.62;      // vertical rise per row (m)
const ROW_DEPTH = 0.92;     // horizontal depth per row (m) → rake
const FRONT_HEIGHT = 0.55;  // height of first row's seat plane above floor

const CROWD_HEAD_R = 0.15;  // crowd blob head radius
const SEAT_SPACING = 0.62;  // spacing between seats along a row

// Overall shell extents (well beyond the last row).
const SHELL_X = INNER_X + ROWS * ROW_DEPTH + 10;
const SHELL_Z = INNER_Z + ROWS * ROW_DEPTH + 10;
const SHELL_TOP = FRONT_HEIGHT + ROWS * ROW_RISE + 12;

// ---------------------------------------------------------------------------
// Materials (shared where possible)
// ---------------------------------------------------------------------------

function makeMaterials() {
  const stands = new THREE.MeshStandardMaterial({
    color: VISUAL.standsColor,
    roughness: 0.92,
    metalness: 0.05,
  });
  const standsDark = new THREE.MeshStandardMaterial({
    color: mixHex(VISUAL.standsColor, 0x000000, 0.45),
    roughness: 0.95,
    metalness: 0.04,
  });
  const seat = new THREE.MeshStandardMaterial({
    color: VISUAL.crowdSeatColor,
    roughness: 0.85,
    metalness: 0.08,
  });
  const shell = new THREE.MeshStandardMaterial({
    color: mixHex(VISUAL.skyTop, 0x000000, 0.25),
    roughness: 1.0,
    metalness: 0.0,
    side: THREE.BackSide,
  });
  const floorFar = new THREE.MeshStandardMaterial({
    color: VISUAL.floorApronColor,
    roughness: 0.96,
    metalness: 0.03,
  });
  const metal = new THREE.MeshStandardMaterial({
    color: 0x2a2f3a,
    roughness: 0.5,
    metalness: 0.75,
  });
  const truss = new THREE.MeshStandardMaterial({
    color: 0x1a1d24,
    roughness: 0.6,
    metalness: 0.7,
  });
  const crowd = new THREE.MeshStandardMaterial({
    color: 0xffffff, // per-instance color drives the look
    roughness: 0.9,
    metalness: 0.0,
    vertexColors: false,
  });
  return { stands, standsDark, seat, shell, floorFar, metal, truss, crowd };
}

// ---------------------------------------------------------------------------
// LED advertising board texture (animated via update)
// ---------------------------------------------------------------------------

const AD_MESSAGES = [
  'FULL COURT',
  'HARDWOOD  LIVE',
  'GAME  NIGHT',
  'VOLTAGE  vs  TIDE',
  'COURTSIDE',
  'PLAY  BALL',
];

function createAdTexture() {
  const W = 1024, H = 128;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;

  function draw(scroll, hue) {
    // Dark base with subtle vertical LED grid.
    ctx.fillStyle = '#05070d';
    ctx.fillRect(0, 0, W, H);
    // Scrolling colored bands to sell the "LED ribbon" motion.
    const bandW = 220;
    for (let x = -bandW; x < W + bandW; x += bandW) {
      const px = (x + scroll) % (W + bandW);
      const g = ctx.createLinearGradient(px, 0, px + bandW, 0);
      const c = `hsl(${hue % 360}, 80%, 52%)`;
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.5, c);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.globalAlpha = 0.55;
      ctx.fillRect(px, 0, bandW, H);
      ctx.globalAlpha = 1;
    }
    // Ad text scrolling across.
    const msg = AD_MESSAGES.join('      •      ') + '      •      ';
    ctx.font = 'bold 78px Arial, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const textW = ctx.measureText(msg).width;
    let tx = -(scroll * 2) % textW;
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = `hsl(${hue % 360}, 90%, 60%)`;
    ctx.shadowBlur = 18;
    while (tx < W) {
      ctx.fillText(msg, tx, H * 0.52);
      tx += textW;
    }
    ctx.shadowBlur = 0;
    // LED pixel darkening grid for texture.
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    for (let x = 0; x < W; x += 4) ctx.fillRect(x, 0, 1, H);
    for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);
    tex.needsUpdate = true;
  }

  draw(0, 200);
  return { tex, draw };
}

// ---------------------------------------------------------------------------
// Jumbotron screen texture (animated via update)
// ---------------------------------------------------------------------------

function createJumboTexture() {
  const W = 512, H = 320;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;

  function draw(t, pulse) {
    // Animated dark-blue gradient backdrop.
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, hexToCss(mixHex(VISUAL.skyBottom, 0x1d64d8, 0.15)));
    g.addColorStop(1, '#05070d');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Sweeping highlight bar.
    const sweep = (t * 0.15) % 1;
    const sg = ctx.createLinearGradient(sweep * W - 120, 0, sweep * W + 120, 0);
    sg.addColorStop(0, 'rgba(29,100,216,0)');
    sg.addColorStop(0.5, 'rgba(80,150,255,0.25)');
    sg.addColorStop(1, 'rgba(29,100,216,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, W, H);

    // Border frame.
    ctx.strokeStyle = '#ffb020';
    ctx.lineWidth = 8;
    ctx.strokeRect(10, 10, W - 20, H - 20);

    // Title.
    const glow = 0.5 + 0.5 * pulse;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 92px Arial, sans-serif';
    ctx.shadowColor = `rgba(255,176,32,${glow})`;
    ctx.shadowBlur = 24 * glow + 8;
    ctx.fillStyle = '#ffd23f';
    ctx.fillText('FULL', W / 2, H * 0.34);
    ctx.fillText('COURT', W / 2, H * 0.60);
    ctx.shadowBlur = 0;

    // Subtitle ticker.
    ctx.font = 'bold 34px Arial, sans-serif';
    ctx.fillStyle = '#8fbfff';
    ctx.fillText('• 3D BASKETBALL •', W / 2, H * 0.84);

    // Scanline overlay.
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);

    tex.needsUpdate = true;
  }

  draw(0, 1);
  return { tex, draw };
}

// ---------------------------------------------------------------------------
// Build a single raked deck (stairstep structure + seats) on one side.
// `axis`:  'x' = deck runs along the X axis (a sideline deck, faces ±Z)
//          'z' = deck runs along the Z axis (an endzone deck, faces ±X)
// `sign`:  +1 / -1  which side of the court the deck sits on.
// Returns { seatPositions:[{x,y,z}], meshes:[...] }.
// ---------------------------------------------------------------------------

function buildDeck(axis, sign, mats, rng) {
  const meshes = [];
  const seatPositions = [];

  const alongIsX = axis === 'x';
  // Along-length of the deck (the run direction) and its inner front position.
  const runHalf = alongIsX ? INNER_X + 2 : INNER_Z + 2;
  const front = alongIsX ? INNER_Z : INNER_X;
  const seatCountAlong = Math.floor((runHalf * 2) / SEAT_SPACING);

  // Merge the stair risers/treads into as few meshes as possible: one long
  // BoxGeometry per row, scaled — cheap and reads as concrete tiers.
  const rowGeo = new THREE.BoxGeometry(1, 1, 1);

  for (let r = 0; r < ROWS; r++) {
    const depthOut = front + r * ROW_DEPTH;              // distance from center
    const height = FRONT_HEIGHT + r * ROW_RISE;          // seat plane height
    const stepLen = runHalf * 2 + 2;

    // Riser/tread slab for this row.
    const slab = new THREE.Mesh(rowGeo, r % 2 === 0 ? mats.stands : mats.standsDark);
    slab.receiveShadow = true;
    slab.castShadow = false;
    const slabH = height + 0.4;
    if (alongIsX) {
      slab.scale.set(stepLen, slabH, ROW_DEPTH + 0.04);
      slab.position.set(0, slabH / 2 - 0.4, sign * (depthOut + ROW_DEPTH / 2));
    } else {
      slab.scale.set(ROW_DEPTH + 0.04, slabH, stepLen);
      slab.position.set(sign * (depthOut + ROW_DEPTH / 2), slabH / 2 - 0.4, 0);
    }
    meshes.push(slab);

    // Seat blocks (thin, along the tread) — every other row to keep it cheap.
    // Record crowd seat positions (one blob per seat) sitting on this tread.
    for (let s = 0; s < seatCountAlong; s++) {
      const alongPos = -runHalf + SEAT_SPACING * (s + 0.5);
      // Leave gaps for tunnels near the ends of each deck (every deck has 2).
      const nearEnd = Math.abs(alongPos) > runHalf - 1.4;
      const tunnelGap = r < 6 && Math.abs(Math.abs(alongPos) - runHalf * 0.5) < 0.9;
      if (nearEnd || tunnelGap) continue;
      // A little jitter for organic packing.
      const jA = (rng() - 0.5) * 0.12;
      const jH = (rng() - 0.5) * 0.03;
      const seatY = height + CROWD_HEAD_R + 0.28 + jH;
      if (alongIsX) {
        seatPositions.push({
          x: alongPos + jA,
          y: seatY,
          z: sign * (depthOut + ROW_DEPTH * 0.35),
        });
      } else {
        seatPositions.push({
          x: sign * (depthOut + ROW_DEPTH * 0.35),
          y: seatY,
          z: alongPos + jA,
        });
      }
    }
  }

  // Front fascia / low wall between court apron and the first row.
  const fascia = new THREE.Mesh(rowGeo, mats.standsDark);
  fascia.receiveShadow = true;
  fascia.castShadow = false;
  const fasciaH = FRONT_HEIGHT + 0.5;
  if (alongIsX) {
    fascia.scale.set(runHalf * 2 + 2, fasciaH, 0.4);
    fascia.position.set(0, fasciaH / 2 - 0.4, sign * (front - 0.5));
  } else {
    fascia.scale.set(0.4, fasciaH, runHalf * 2 + 2);
    fascia.position.set(sign * (front - 0.5), fasciaH / 2 - 0.4, 0);
  }
  meshes.push(fascia);

  return { seatPositions, meshes };
}

// ---------------------------------------------------------------------------
// Crowd InstancedMesh — a head+shoulders blob per seat, colorful & varied.
// ---------------------------------------------------------------------------

function buildCrowd(seatPositions, mat, rng) {
  const count = seatPositions.length;

  // A capsule reads nicely as a rounded "head+shoulders" silhouette.
  const geo = new THREE.CapsuleGeometry(CROWD_HEAD_R, CROWD_HEAD_R * 1.3, 4, 8);
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.castShadow = false;      // crowd must NOT cast shadows
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;   // bowl surrounds camera; keep it simple

  // A vibrant palette so the crowd reads as packed and colorful.
  const palette = [
    0xd94f4f, 0xe08a2f, 0xe6c53d, 0x4faf5a, 0x3f8fd9, 0x6a54c9,
    0xc94fb0, 0xf0f0f0, 0x2f6fb0, 0xb03a3a, 0x3aa0a0, 0xd0d0d0,
    0x8e2de2, 0x0e9d78, 0x1d64d8, 0xf5c518,
  ];

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  // Store base data for the update() shimmer.
  const baseY = new Float32Array(count);
  const phase = new Float32Array(count);
  const active = new Uint8Array(count); // which instances bob (subset)

  for (let i = 0; i < count; i++) {
    const p = seatPositions[i];
    baseY[i] = p.y;
    phase[i] = rng() * Math.PI * 2;
    active[i] = rng() < 0.22 ? 1 : 0; // ~22% of crowd can shimmer

    dummy.position.set(p.x, p.y, p.z);
    // Slight lean/rotation variety.
    dummy.rotation.set((rng() - 0.5) * 0.18, rng() * Math.PI * 2, (rng() - 0.5) * 0.18);
    const sc = 0.85 + rng() * 0.4;
    dummy.scale.set(sc, sc * (0.9 + rng() * 0.35), sc);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);

    // Varied per-instance color, occasionally toward skin/neutral so it isn't
    // uniformly saturated.
    let base = palette[(rng() * palette.length) | 0];
    if (rng() < 0.18) base = mixHex(base, 0xc68642, 0.6); // some skin/neutral
    color.setHex(mixHex(base, 0x101018, rng() * 0.25));   // subtle darken variance
    mesh.setColorAt(i, color);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  return { mesh, dummy, baseY, phase, active, seatPositions, count };
}

// ---------------------------------------------------------------------------
// Courtside seating ring + scorer's table
// ---------------------------------------------------------------------------

function buildCourtside(mats) {
  const g = new THREE.Group();

  const chairMat = new THREE.MeshStandardMaterial({
    color: 0x0b0d13, roughness: 0.7, metalness: 0.2,
  });
  const chairGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);

  // A single ring of courtside chairs just outside the apron on both sidelines.
  const seatZ = COURT.halfWidth + APRON - 0.2;
  const chairsPerSide = 34;
  const chairInst = new THREE.InstancedMesh(chairGeo, chairMat, chairsPerSide * 2);
  chairInst.castShadow = true;
  chairInst.receiveShadow = true;
  const d = new THREE.Object3D();
  let ci = 0;
  for (const s of [-1, 1]) {
    for (let i = 0; i < chairsPerSide; i++) {
      const x = -COURT.halfLength + (i + 0.5) * ((COURT.halfLength * 2) / chairsPerSide);
      d.position.set(x, 0.28, s * seatZ);
      d.scale.set(1, 1, 1);
      d.rotation.set(0, 0, 0);
      d.updateMatrix();
      chairInst.setMatrixAt(ci++, d.matrix);
    }
  }
  chairInst.instanceMatrix.needsUpdate = true;
  g.add(chairInst);

  // Scorer's table along one sideline at center.
  const tableMat = new THREE.MeshStandardMaterial({
    color: 0x14171f, roughness: 0.55, metalness: 0.25,
  });
  const table = new THREE.Mesh(new THREE.BoxGeometry(6.0, 0.9, 0.7), tableMat);
  table.position.set(0, 0.45, (COURT.halfWidth + APRON - 0.55));
  table.castShadow = true;
  table.receiveShadow = true;
  g.add(table);

  return g;
}

// ---------------------------------------------------------------------------
// LED advertising boards along both sidelines (emissive).
// ---------------------------------------------------------------------------

function buildAdBoards(adTex) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    map: adTex,
    emissiveMap: adTex,
    emissive: 0xffffff,
    emissiveIntensity: 1.15,
    roughness: 0.4,
    metalness: 0.0,
    color: 0x000000,
  });
  const boardLen = COURT.halfLength * 2 + APRON;
  const boardH = 0.9;
  const boardZ = COURT.halfWidth + APRON - 0.05;

  for (const s of [-1, 1]) {
    const geo = new THREE.PlaneGeometry(boardLen, boardH);
    const board = new THREE.Mesh(geo, mat);
    board.position.set(0, boardH / 2 + 0.05, s * boardZ);
    // Face the court.
    board.rotation.y = s < 0 ? 0 : Math.PI;
    board.receiveShadow = false;
    board.castShadow = false;
    // Fit the texture across the long strip.
    if (s < 0) {
      // shared texture; repeat handled globally
    }
    g.add(board);
  }
  // End-zone shorter boards.
  const endLen = COURT.halfWidth * 2;
  const endX = COURT.halfLength + APRON - 0.05;
  for (const s of [-1, 1]) {
    const geo = new THREE.PlaneGeometry(endLen, boardH);
    const board = new THREE.Mesh(geo, mat);
    board.position.set(s * endX, boardH / 2 + 0.05, 0);
    board.rotation.y = s < 0 ? Math.PI / 2 : -Math.PI / 2;
    g.add(board);
  }

  adTex.repeat.set(4, 1);
  return g;
}

// ---------------------------------------------------------------------------
// Ceiling: dark roof + truss/catwalk grid + emissive lamp housings.
// ---------------------------------------------------------------------------

function buildCeiling(mats) {
  const g = new THREE.Group();
  const ceilY = SHELL_TOP - 0.5;

  // Big dark ceiling plane (double-safe: a box lid).
  const lid = new THREE.Mesh(
    new THREE.BoxGeometry(SHELL_X * 2, 1.0, SHELL_Z * 2),
    new THREE.MeshStandardMaterial({
      color: mixHex(VISUAL.skyTop, 0x000000, 0.35),
      roughness: 1.0, metalness: 0.0,
    })
  );
  lid.position.set(0, ceilY + 0.5, 0);
  lid.receiveShadow = false;
  g.add(lid);

  // Truss grid — instanced beams spanning both directions below the lid.
  const trussY = ceilY - 0.8;
  const beamGeoX = new THREE.BoxGeometry(SHELL_X * 1.6, 0.22, 0.22);
  const beamGeoZ = new THREE.BoxGeometry(0.22, 0.22, SHELL_Z * 1.6);
  const nX = 9, nZ = 9;
  const beamsX = new THREE.InstancedMesh(beamGeoX, mats.truss, nZ);
  const beamsZ = new THREE.InstancedMesh(beamGeoZ, mats.truss, nX);
  beamsX.castShadow = false; beamsX.receiveShadow = false;
  beamsZ.castShadow = false; beamsZ.receiveShadow = false;
  const d = new THREE.Object3D();
  for (let i = 0; i < nZ; i++) {
    const z = -SHELL_Z * 0.7 + (i / (nZ - 1)) * SHELL_Z * 1.4;
    d.position.set(0, trussY, z); d.updateMatrix();
    beamsX.setMatrixAt(i, d.matrix);
  }
  for (let i = 0; i < nX; i++) {
    const x = -SHELL_X * 0.7 + (i / (nX - 1)) * SHELL_X * 1.4;
    d.position.set(x, trussY - 0.05, 0); d.updateMatrix();
    beamsZ.setMatrixAt(i, d.matrix);
  }
  beamsX.instanceMatrix.needsUpdate = true;
  beamsZ.instanceMatrix.needsUpdate = true;
  g.add(beamsX, beamsZ);

  // Emissive lamp housings above the court (visual only; real lights elsewhere).
  const lampGeo = new THREE.BoxGeometry(0.9, 0.28, 0.9);
  const lampMat = new THREE.MeshStandardMaterial({
    color: 0x1a1d24,
    emissive: 0xfff4d6,
    emissiveIntensity: 1.4,
    roughness: 0.4,
    metalness: 0.3,
  });
  const lampsX = 4, lampsZ = 3;
  const lamps = new THREE.InstancedMesh(lampGeo, lampMat, lampsX * lampsZ);
  lamps.castShadow = false; lamps.receiveShadow = false;
  let li = 0;
  for (let ix = 0; ix < lampsX; ix++) {
    for (let iz = 0; iz < lampsZ; iz++) {
      const x = -COURT.halfLength * 0.7 + (ix / (lampsX - 1)) * COURT.halfLength * 1.4;
      const z = -COURT.halfWidth * 0.6 + (iz / (lampsZ - 1)) * COURT.halfWidth * 1.2;
      d.position.set(x, trussY - 0.35, z); d.updateMatrix();
      lamps.setMatrixAt(li++, d.matrix);
    }
  }
  lamps.instanceMatrix.needsUpdate = true;
  g.add(lamps);

  return { group: g, ceilY };
}

// ---------------------------------------------------------------------------
// Central hanging Jumbotron (4-sided emissive box).
// ---------------------------------------------------------------------------

function buildJumbotron(jumboTex, ceilY) {
  const pivot = new THREE.Group();
  const hangY = ceilY - 4.2;
  pivot.position.set(0, hangY, 0);

  // Support cables from ceiling to the rig.
  const cableMat = new THREE.MeshStandardMaterial({
    color: 0x0a0c12, roughness: 0.6, metalness: 0.6,
  });
  const cableLen = ceilY - hangY;
  for (const [cx, cz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) {
    const cable = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, cableLen, 6),
      cableMat
    );
    cable.position.set(cx, cableLen / 2 + 1.4, cz);
    pivot.add(cable);
  }

  // Rig housing.
  const rigMat = new THREE.MeshStandardMaterial({
    color: 0x0b0d13, roughness: 0.5, metalness: 0.4,
  });
  const rig = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.5, 4.2), rigMat);
  rig.position.y = 1.55;
  rig.castShadow = true;
  pivot.add(rig);

  // 4 screens (emissive planes) around a box body.
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(4.0, 2.4, 4.0),
    new THREE.MeshStandardMaterial({ color: 0x05070d, roughness: 0.6, metalness: 0.3 })
  );
  body.castShadow = true;
  pivot.add(body);

  const screenMat = new THREE.MeshStandardMaterial({
    map: jumboTex,
    emissiveMap: jumboTex,
    emissive: 0xffffff,
    emissiveIntensity: 1.25,
    roughness: 0.3,
    metalness: 0.0,
    color: 0x000000,
  });
  const sw = 3.7, sh = 2.1;
  const half = 2.02;
  const screenDefs = [
    { pos: [0, 0, half], rotY: 0 },
    { pos: [0, 0, -half], rotY: Math.PI },
    { pos: [half, 0, 0], rotY: Math.PI / 2 },
    { pos: [-half, 0, 0], rotY: -Math.PI / 2 },
  ];
  for (const sd of screenDefs) {
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), screenMat);
    screen.position.set(sd.pos[0], sd.pos[1], sd.pos[2]);
    screen.rotation.y = sd.rotY;
    pivot.add(screen);
  }

  // Bottom ring of small emissive marquee lights.
  const dotGeo = new THREE.SphereGeometry(0.06, 6, 6);
  const dotMat = new THREE.MeshStandardMaterial({
    color: 0xffd23f, emissive: 0xffb020, emissiveIntensity: 1.6, roughness: 0.4,
  });
  const dotCount = 40;
  const dots = new THREE.InstancedMesh(dotGeo, dotMat, dotCount);
  const dd = new THREE.Object3D();
  for (let i = 0; i < dotCount; i++) {
    const a = (i / dotCount) * Math.PI * 2;
    dd.position.set(Math.cos(a) * 2.1, -1.3, Math.sin(a) * 2.1);
    dd.updateMatrix();
    dots.setMatrixAt(i, dd.matrix);
  }
  dots.instanceMatrix.needsUpdate = true;
  pivot.add(dots);

  return pivot;
}

// ---------------------------------------------------------------------------
// Dark surrounding shell + arena floor beyond stands + tunnels.
// ---------------------------------------------------------------------------

function buildShell(mats) {
  const g = new THREE.Group();

  // Big inverted box shell (BackSide) so we never see the void.
  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(SHELL_X * 2, SHELL_TOP + 30, SHELL_Z * 2),
    mats.shell
  );
  shell.position.set(0, (SHELL_TOP + 30) / 2 - 2, 0);
  shell.receiveShadow = false;
  g.add(shell);

  // Arena floor beyond the stands (concourse level), tucked under the bowl.
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(SHELL_X * 2, SHELL_Z * 2),
    mats.floorFar
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.4;
  floor.receiveShadow = true;
  g.add(floor);

  // Tunnel mouths (dark openings) at deck mid-points on the sidelines.
  const tunnelMat = new THREE.MeshStandardMaterial({
    color: 0x000000, roughness: 1.0, metalness: 0.0,
  });
  const tunnelGeo = new THREE.BoxGeometry(1.6, 2.4, 1.2);
  for (const s of [-1, 1]) {
    for (const along of [-INNER_X * 0.5, INNER_X * 0.5]) {
      const t = new THREE.Mesh(tunnelGeo, tunnelMat);
      t.position.set(along, 1.2, s * (INNER_Z + 0.9));
      g.add(t);
    }
  }
  for (const s of [-1, 1]) {
    const t = new THREE.Mesh(tunnelGeo, tunnelMat);
    t.position.set(s * (INNER_X + 0.9), 1.2, 0);
    t.rotation.y = Math.PI / 2;
    g.add(t);
  }

  return g;
}

// ---------------------------------------------------------------------------
// Main factory
// ---------------------------------------------------------------------------

export function createArena() {
  const group = new THREE.Group();
  group.name = 'Arena';

  const rng = makeRng(0x51ed2c7f);
  const mats = makeMaterials();

  // --- Stands on all four sides + gather crowd seat positions ---
  const allSeats = [];
  for (const s of [-1, 1]) {
    const dx = buildDeck('x', s, mats, rng); // sideline decks (along X)
    const dz = buildDeck('z', s, mats, rng); // endzone decks (along Z)
    for (const m of dx.meshes) group.add(m);
    for (const m of dz.meshes) group.add(m);
    for (const p of dx.seatPositions) allSeats.push(p);
    for (const p of dz.seatPositions) allSeats.push(p);
  }

  // --- Crowd (colorful InstancedMesh) ---
  const crowd = buildCrowd(allSeats, mats.crowd, rng);
  group.add(crowd.mesh);

  // --- Courtside seating + scorer's table ---
  group.add(buildCourtside(mats));

  // --- LED advertising boards ---
  const ad = createAdTexture();
  group.add(buildAdBoards(ad.tex));

  // --- Ceiling / truss / lamps ---
  const ceiling = buildCeiling(mats);
  group.add(ceiling.group);

  // --- Jumbotron ---
  const jumbo = createJumboTexture();
  const jumbotron = buildJumbotron(jumbo.tex, ceiling.ceilY);
  group.add(jumbotron);

  // --- Shell + far floor + tunnels ---
  group.add(buildShell(mats));

  // --- Animation state ---
  let adScroll = 0;
  let adHue = 200;
  let jumboT = 0;
  let crowdT = 0;
  let crowdBobbed = false; // whether active instances are currently offset

  // Reusable objects for the crowd shimmer to avoid per-frame allocations.
  const shimDummy = new THREE.Object3D();
  const shimMat = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();

  function update(dt, excitement = 0) {
    if (!Number.isFinite(dt)) dt = 0.016;
    const ex = Math.max(0, Math.min(1, excitement));

    // Ad boards: scroll + slow hue drift.
    adScroll += dt * (120 + ex * 220);
    adHue = (adHue + dt * (18 + ex * 40)) % 360;
    ad.draw(adScroll, adHue);

    // Jumbotron: slow rotation + pulse, faster when excited.
    jumboT += dt;
    jumbotron.rotation.y += dt * (0.12 + ex * 0.4);
    const pulse = 0.5 + 0.5 * Math.sin(jumboT * (1.6 + ex * 3.0));
    jumbo.draw(jumboT, pulse);

    // Crowd shimmer: bob a fraction of instances, scaled by excitement. Cheap:
    // we only touch the "active" subset, and only when there is excitement.
    crowdT += dt;
    if (ex > 0.02) {
      const amp = 0.06 + ex * 0.22;
      const mesh = crowd.mesh;
      const n = crowd.count;
      for (let i = 0; i < n; i++) {
        if (!crowd.active[i]) continue;
        mesh.getMatrixAt(i, shimMat);
        shimMat.decompose(pos, quat, scl);
        const bob = Math.sin(crowdT * 6.0 + crowd.phase[i]) * amp;
        pos.y = crowd.baseY[i] + Math.max(0, bob);
        shimDummy.position.copy(pos);
        shimDummy.quaternion.copy(quat);
        shimDummy.scale.copy(scl);
        shimDummy.updateMatrix();
        mesh.setMatrixAt(i, shimDummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      crowdBobbed = true;
    } else if (crowdBobbed) {
      // Excitement stopped: settle bobbed instances back to their base Y once
      // so no fraction of the crowd stays frozen mid-hop.
      const mesh = crowd.mesh;
      const n = crowd.count;
      for (let i = 0; i < n; i++) {
        if (!crowd.active[i]) continue;
        mesh.getMatrixAt(i, shimMat);
        shimMat.decompose(pos, quat, scl);
        pos.y = crowd.baseY[i];
        shimDummy.position.copy(pos);
        shimDummy.quaternion.copy(quat);
        shimDummy.scale.copy(scl);
        shimDummy.updateMatrix();
        mesh.setMatrixAt(i, shimDummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      crowdBobbed = false;
    }
  }

  return { group, update };
}
