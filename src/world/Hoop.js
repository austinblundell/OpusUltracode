/**
 * Hoop.js — One complete broadcast-quality basket assembly.
 *
 * export function createHoop(side): THREE.Group
 *   side = -1 → HOME hoop (-X baseline);  side = +1 → AWAY hoop (+X baseline).
 *
 * Builds, in WORLD space:
 *   - padded stanchion / pole behind the baseline (outside larger |x|)
 *   - cantilever support arm
 *   - glass backboard (MeshPhysicalMaterial transmission) with painted
 *     white border + red shooter square (CanvasTexture on the front face)
 *   - orange rim (TorusGeometry) with two mounts back to the backboard
 *   - a hanging net (LineSegments) with a swish()/update(dt) animation
 *
 * group.userData is set EXACTLY as the physics layer expects (see bottom).
 */

import * as THREE from 'three';
import { HOOP, COURT, rimCenterX, backboardX } from '../config/Constants.js';

// ---------------------------------------------------------------------------
// Shared / cached materials & textures (built lazily, reused across hoops)
// ---------------------------------------------------------------------------

let _backboardTexture = null;

/**
 * Procedural front-face texture for the glass backboard:
 * transparent glass field, white outer border, and the red shooter square
 * framing the rim contact point.
 */
function makeBackboardTexture() {
  if (_backboardTexture) return _backboardTexture;

  const W = 1024;
  // Match the physical aspect ratio (width : height) so markings aren't skewed.
  const H = Math.round(W * (HOOP.backboardHeight / HOOP.backboardWidth));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Clear to fully transparent — the glass shows through everywhere unpainted.
  ctx.clearRect(0, 0, W, H);

  // Outer white border (painted trim around the whole glass).
  const border = Math.round(W * 0.018);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = border;
  ctx.lineJoin = 'miter';
  ctx.strokeRect(border / 2, border / 2, W - border, H - border);

  // Red shooter square. Regulation inner box is 24" wide x 18" tall, its
  // bottom edge ~6" above the board's bottom, horizontally centered.
  const sq = '#' + new THREE.Color(HOOP.backboardSquareColor).getHexString();
  const boxW = W * (0.61 / HOOP.backboardWidth);   // 24 in
  const boxH = H * (0.45 / HOOP.backboardHeight);   // 18 in
  const boxBottomFromBottom = H * (0.15 / HOOP.backboardHeight); // ~6 in
  const boxX = (W - boxW) / 2;
  const boxY = H - boxBottomFromBottom - boxH;
  ctx.strokeStyle = sq;
  ctx.lineWidth = Math.round(W * 0.012);
  ctx.strokeRect(boxX, boxY, boxW, boxH);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  _backboardTexture = tex;
  return tex;
}

// ---------------------------------------------------------------------------
// createHoop
// ---------------------------------------------------------------------------

export function createHoop(side) {
  const s = side < 0 ? -1 : 1;
  const group = new THREE.Group();
  group.name = `hoop_${s < 0 ? 'home' : 'away'}`;

  const rimX = rimCenterX(s);        // rim center X in world
  const boardFrontX = backboardX(s); // front (court-facing) glass face X
  // The board's court-facing normal points toward center court, i.e. -s in X.
  // Back face of the glass is slightly outward (larger |x|) than the front.
  const boardBackX = boardFrontX + s * HOOP.backboardThickness;
  const boardCenterX = (boardFrontX + boardBackX) / 2;
  const boardCenterY = HOOP.backboardBottomHeight + HOOP.backboardHeight / 2;

  // =========================================================================
  // 1. Stanchion / pole (padded) behind the baseline, outside larger |x|.
  // =========================================================================
  const poleMat = new THREE.MeshStandardMaterial({
    color: HOOP.poleColor,
    roughness: 0.55,
    metalness: 0.6,
  });
  const padMat = new THREE.MeshStandardMaterial({
    color: 0x14171f,
    roughness: 0.9,
    metalness: 0.0,
  });

  // Place the base just outside the baseline. Baseline is at |x| = halfLength.
  const baseX = s * (COURT.halfLength + 0.55);
  const poleRadius = 0.11;
  const poleTopY = HOOP.backboardBottomHeight + 0.10; // arm attaches high

  // Base plate on the floor.
  const basePlate = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.06, 1.1),
    poleMat
  );
  basePlate.position.set(baseX, 0.03, 0);
  basePlate.castShadow = true;
  basePlate.receiveShadow = true;
  group.add(basePlate);

  // Main vertical pole.
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(poleRadius, poleRadius * 1.15, poleTopY, 24),
    poleMat
  );
  pole.position.set(baseX, poleTopY / 2, 0);
  pole.castShadow = true;
  pole.receiveShadow = true;
  group.add(pole);

  // Protective padding wrapping the lower pole (broadcast look).
  const padHeight = 2.15;
  const pad = new THREE.Mesh(
    new THREE.CylinderGeometry(poleRadius + 0.075, poleRadius + 0.085, padHeight, 24),
    padMat
  );
  pad.position.set(baseX, padHeight / 2, 0);
  pad.castShadow = true;
  pad.receiveShadow = true;
  group.add(pad);

  // Colored accent band near the top of the padding.
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(poleRadius + 0.09, poleRadius + 0.09, 0.10, 24),
    new THREE.MeshStandardMaterial({ color: HOOP.rimColor, roughness: 0.7, metalness: 0.1 })
  );
  band.position.set(baseX, padHeight - 0.15, 0);
  band.castShadow = true;
  group.add(band);

  // =========================================================================
  // 2. Cantilever support arm: from pole top forward to the backboard back.
  // =========================================================================
  const armStartX = baseX;
  const armEndX = boardBackX; // reach the back of the glass
  const armSpan = Math.abs(armEndX - armStartX);
  const armMidX = (armStartX + armEndX) / 2;
  const armY = poleTopY;

  const arm = new THREE.Mesh(
    new THREE.BoxGeometry(armSpan, 0.14, 0.16),
    poleMat
  );
  arm.position.set(armMidX, armY, 0);
  arm.castShadow = true;
  arm.receiveShadow = true;
  group.add(arm);

  // Diagonal brace from mid-pole up to under the board for a rigid look.
  // Endpoints: start on the pole (a bit below the arm), end at the board back.
  const bx0 = armStartX;
  const by0 = poleTopY - 0.75;
  const bx1 = boardBackX - s * 0.05;
  const by1 = HOOP.backboardBottomHeight + 0.10;
  const braceLen = Math.hypot(bx1 - bx0, by1 - by0);
  const brace = new THREE.Mesh(
    new THREE.BoxGeometry(braceLen, 0.09, 0.10),
    poleMat
  );
  brace.position.set((bx0 + bx1) / 2, (by0 + by1) / 2, 0);
  brace.rotation.z = Math.atan2(by1 - by0, bx1 - bx0);
  brace.castShadow = true;
  group.add(brace);

  // Back plate bracket where arm meets the board.
  const bracket = new THREE.Mesh(
    new THREE.BoxGeometry(0.10, 0.55, 0.55),
    poleMat
  );
  bracket.position.set(boardBackX + s * 0.05, boardCenterY - 0.10, 0);
  bracket.castShadow = true;
  bracket.receiveShadow = true;
  group.add(bracket);

  // =========================================================================
  // 3. Backboard (glass) with painted markings on the court-facing face.
  // =========================================================================
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xdff1ff,
    roughness: 0.06,
    metalness: 0.0,
    transmission: 0.92,
    transparent: true,
    opacity: 0.28,
    thickness: HOOP.backboardThickness,
    ior: 1.5,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
    reflectivity: 0.5,
    side: THREE.DoubleSide,
  });

  const backboardMesh = new THREE.Mesh(
    new THREE.BoxGeometry(
      HOOP.backboardThickness,
      HOOP.backboardHeight,
      HOOP.backboardWidth
    ),
    glassMat
  );
  backboardMesh.position.set(boardCenterX, boardCenterY, 0);
  backboardMesh.castShadow = true;
  backboardMesh.receiveShadow = true;
  backboardMesh.name = 'backboard';
  group.add(backboardMesh);

  // Painted markings applied as a thin decal plane on the court-facing face.
  // The board geometry has width along Z and height along Y; its court-facing
  // normal is -s in X. A plane in the local Y/Z requires rotating about Y.
  const markTex = makeBackboardTexture();
  const markMat = new THREE.MeshStandardMaterial({
    map: markTex,
    transparent: true,
    roughness: 0.5,
    metalness: 0.0,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const markPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(HOOP.backboardWidth, HOOP.backboardHeight),
    markMat
  );
  // Plane default faces +Z. Rotate so its front normal faces -s in X (toward
  // center court) and lies on the glass. rotY(+Z,+PI/2)=+X, rotY(+Z,-PI/2)=-X.
  markPlane.rotation.y = s < 0 ? Math.PI / 2 : -Math.PI / 2;
  markPlane.position.set(
    boardFrontX - s * 0.002, // a hair in front of the court-facing glass
    boardCenterY,
    0
  );
  group.add(markPlane);

  // =========================================================================
  // 4. Rim (orange torus, horizontal) + mounts to the backboard.
  // =========================================================================
  const rimMat = new THREE.MeshStandardMaterial({
    color: HOOP.rimColor,
    roughness: 0.4,
    metalness: 0.55,
  });

  const rimMesh = new THREE.Mesh(
    new THREE.TorusGeometry(HOOP.rimRadius, HOOP.rimTubeRadius, 16, 48),
    rimMat
  );
  // Torus lies in its local XY plane; rotate to horizontal (XZ plane).
  rimMesh.rotation.x = Math.PI / 2;
  rimMesh.position.set(rimX, HOOP.rimHeight, 0);
  rimMesh.castShadow = true;
  rimMesh.receiveShadow = true;
  rimMesh.name = 'rim';
  group.add(rimMesh);

  // Rim mount plate + two connector bars back to the glass.
  // The rim's rear edge sits near the board; connect from there to the glass.
  const rimRearX = rimX + s * HOOP.rimRadius; // point of rim nearest board
  const mountGapX = Math.abs(boardFrontX - rimRearX);

  const mountPlate = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.14, 0.24),
    rimMat
  );
  mountPlate.position.set(
    boardFrontX - s * 0.025,
    HOOP.rimHeight + 0.02,
    0
  );
  mountPlate.castShadow = true;
  mountPlate.receiveShadow = true;
  group.add(mountPlate);

  const barLen = mountGapX + 0.03;
  for (const dz of [-0.075, 0.075]) {
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(barLen, 0.03, 0.03),
      rimMat
    );
    bar.position.set(
      (rimRearX + boardFrontX) / 2,
      HOOP.rimHeight,
      dz
    );
    bar.castShadow = true;
    bar.receiveShadow = true;
    group.add(bar);
  }

  // =========================================================================
  // 5. Net — LineSegments hanging from the rim through several rings.
  // =========================================================================
  const net = buildNet(rimX, HOOP.rimHeight);
  group.add(net.object);

  // =========================================================================
  // userData — EXACT shape the physics/integration layer consumes.
  // =========================================================================
  group.userData = {
    side: s,
    rimCenter: new THREE.Vector3(rimX, HOOP.rimHeight, 0),
    rimRadius: HOOP.rimRadius,
    rimMesh,
    backboardMesh,
    backboardHalf: {
      w: HOOP.backboardWidth / 2,
      h: HOOP.backboardHeight / 2,
    },
    net: {
      swish(strength = 1) {
        net.swish(strength);
      },
      update(dt) {
        net.update(dt);
      },
    },
  };

  return group;
}

// ---------------------------------------------------------------------------
// Net construction + animation
// ---------------------------------------------------------------------------
//
// The net is a grid of vertices: netSegments points around the rim, dropping
// through netRings horizontal rings, tapering inward toward the bottom. We
// draw it as LineSegments (verticals + a diamond mesh between rings) so it
// reads like a real basketball net. swish() pushes the lower rings downward
// and inward; update(dt) relaxes them back to rest with damping.

function buildNet(rimX, rimTopY) {
  const segments = HOOP.netSegments;
  const rings = HOOP.netRings;
  const topRadius = HOOP.rimRadius * 0.94;   // hangs just inside the rim
  const bottomRadius = HOOP.rimRadius * 0.42; // tapers in
  const length = HOOP.netLength;

  // Rest positions: rest[ring][seg] = THREE.Vector3 (world space).
  const rest = [];
  for (let r = 0; r < rings; r++) {
    const t = r / (rings - 1);                 // 0 at rim, 1 at bottom
    const radius = topRadius + (bottomRadius - topRadius) * t;
    // Slight non-linear droop so the taper looks natural.
    const y = rimTopY - length * (t * t * 0.4 + t * 0.6);
    // Rotate alternate rings by half a step for the classic diamond weave.
    const phase = (r % 2) * (Math.PI / segments);
    const arr = [];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2 + phase;
      arr.push(new THREE.Vector3(
        rimX + Math.cos(a) * radius,
        y,
        Math.sin(a) * radius
      ));
    }
    rest.push(arr);
  }

  // Current (animated) positions start at rest.
  const cur = rest.map((ring) => ring.map((v) => v.clone()));
  // Per-ring vertical displacement offset used by the swish animation.
  const ringOffset = new Float32Array(rings); // negative = pushed down

  // Build the line segment index pairs once. We connect:
  //   - vertical-ish strands between consecutive rings (diamond weave)
  //   - the bottom ring as a closed hoop
  // Each segment references two (ring,seg) vertices; we regenerate the flat
  // position buffer from `cur` each frame.
  const pairs = []; // [ [r0,i0], [r1,i1] ]
  for (let r = 0; r < rings - 1; r++) {
    for (let i = 0; i < segments; i++) {
      // Diamond weave: each point connects to two points on the next ring.
      const a = i;
      const b = (r % 2 === 0) ? i : (i + 1) % segments;
      const c = (r % 2 === 0) ? (i - 1 + segments) % segments : i;
      pairs.push([[r, a], [r + 1, b]]);
      pairs.push([[r, a], [r + 1, c]]);
    }
  }
  // Closed bottom hoop.
  const rLast = rings - 1;
  for (let i = 0; i < segments; i++) {
    pairs.push([[rLast, i], [rLast, (i + 1) % segments]]);
  }

  const vertexCount = pairs.length * 2;
  const positions = new Float32Array(vertexCount * 3);

  const geometry = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', posAttr);

  const material = new THREE.LineBasicMaterial({
    color: 0xf2f4f8,
    transparent: true,
    opacity: 0.85,
  });

  const object = new THREE.LineSegments(geometry, material);
  object.name = 'net';
  object.castShadow = false;
  object.receiveShadow = false;
  object.frustumCulled = false;

  // Write current positions into the flat buffer.
  function writePositions() {
    let p = 0;
    for (let k = 0; k < pairs.length; k++) {
      const [[r0, i0], [r1, i1]] = pairs[k];
      const v0 = cur[r0][i0];
      const v1 = cur[r1][i1];
      positions[p++] = v0.x; positions[p++] = v0.y; positions[p++] = v0.z;
      positions[p++] = v1.x; positions[p++] = v1.y; positions[p++] = v1.z;
    }
    posAttr.needsUpdate = true;
    geometry.computeBoundingSphere();
  }

  writePositions(); // initial rest pose

  // Animation state. A swish drives ring offsets downward; they relax back.
  const swishState = {
    active: false,
    time: 0,
    strength: 0,
  };

  function swish(strength = 1) {
    swishState.active = true;
    swishState.time = 0;
    swishState.strength = Math.max(swishState.strength, Math.min(1.5, strength));
  }

  function update(dt) {
    // Advance the impulse envelope: a quick down-push then relaxation.
    if (swishState.active) {
      swishState.time += dt;
      // Envelope: rises fast, decays over ~0.6s.
      const t = swishState.time;
      const env = swishState.strength * Math.exp(-t * 4.5) * Math.sin(Math.min(t * 11, Math.PI));
      // Target push per ring — lower rings move more.
      for (let r = 0; r < rings; r++) {
        const depth = r / (rings - 1);
        const target = -env * length * 0.6 * depth;
        // Critically-ish damped approach to the target offset.
        ringOffset[r] += (target - ringOffset[r]) * Math.min(1, dt * 18);
      }
      if (t > 0.9 && Math.abs(env) < 0.001) {
        swishState.active = false;
        swishState.strength = 0;
      }
    }

    // Always relax offsets back toward zero (rest).
    let moved = false;
    for (let r = 0; r < rings; r++) {
      if (Math.abs(ringOffset[r]) > 1e-5) {
        ringOffset[r] *= Math.max(0, 1 - dt * 6.0);
        if (Math.abs(ringOffset[r]) < 1e-5) ringOffset[r] = 0;
        moved = true;
      }
    }

    if (!moved && !swishState.active) {
      // Nothing to do; ensure we're exactly at rest once.
      return;
    }

    // Apply offsets: displace each ring vertically (and slightly inward as it
    // drops, so the net cinches on a swish) from its rest position.
    for (let r = 0; r < rings; r++) {
      const off = ringOffset[r];
      // Inward pull proportional to downward push.
      const cinch = 1 + (off / length) * 0.18; // off is negative → radius shrinks
      for (let i = 0; i < segments; i++) {
        const rv = rest[r][i];
        const cv = cur[r][i];
        cv.x = rimX + (rv.x - rimX) * cinch;
        cv.z = rv.z * cinch;
        cv.y = rv.y + off;
      }
    }
    writePositions();
  }

  return { object, swish, update };
}
