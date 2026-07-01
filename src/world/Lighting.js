/**
 * Lighting.js — Broadcast-arena lighting rig + procedural environment map.
 *
 * Provides bright, even court illumination with one crisp soft-shadow key light,
 * a cool sky / warm ground hemisphere fill, a low ambient floor (so shadows are
 * never pure black), and a few overhead spot fills for glossy hardwood specular.
 *
 * A small procedural "room" is baked into a PMREM environment map so all PBR
 * materials get plausible reflections. We set scene.environment ONLY — the main
 * engine owns scene.background / scene.fog, so we never touch those here.
 *
 * Tuned for ACES filmic tone mapping + physically-correct (r155+) light units.
 *
 * export setupLighting(scene, renderer) -> { keyLight, envTexture, update(dt) }
 */

import * as THREE from 'three';
import { COURT, VISUAL } from '../config/Constants.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// 0xRRGGBB -> "#rrggbb"
function hexToCss(hex) {
  return '#' + (hex & 0xffffff).toString(16).padStart(6, '0');
}

// ---------------------------------------------------------------------------
// Procedural environment scene -> PMREM
// ---------------------------------------------------------------------------
//
// A big inward-facing box acts as a dim arena "room": a subtly graded dark
// ceiling/wall vertical gradient with a brighter warm band near the top where
// the arena rig would live, plus a scatter of small emissive "fixture" quads on
// the ceiling that read as soft reflected highlights on glossy materials.
// Baked once into an equirect-free PMREM cubemap; the source scene is disposed.

function buildEnvScene() {
  const env = new THREE.Scene();

  // --- graded room shell ---------------------------------------------------
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Vertical gradient: dark cool floor tone -> slightly warmer, brighter "rig".
  const g = ctx.createLinearGradient(0, 0, 0, size);
  g.addColorStop(0.0, hexToCss(0x3a4358)); // ceiling band (brightest, cool-warm)
  g.addColorStop(0.28, hexToCss(0x232a3a));
  g.addColorStop(0.62, hexToCss(0x141824));
  g.addColorStop(1.0, hexToCss(0x0c0f18)); // lower walls (darkest)
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  // Soft warm glow strip near the top — the lighting truss / catwalks.
  const glow = ctx.createLinearGradient(0, 0, 0, size * 0.34);
  glow.addColorStop(0.0, 'rgba(255, 238, 205, 0.55)');
  glow.addColorStop(1.0, 'rgba(255, 238, 205, 0.0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size * 0.34);

  // Scatter of soft light pools (reflected fixtures) across the upper region.
  let seed = 0x9e3779b1;
  const rng = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 26; i++) {
    const x = rng() * size;
    const y = rng() * size * 0.5;
    const r = 10 + rng() * 40;
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0.0, 'rgba(255, 246, 224, 0.5)');
    rg.addColorStop(1.0, 'rgba(255, 246, 224, 0.0)');
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const roomTex = new THREE.CanvasTexture(canvas);
  roomTex.colorSpace = THREE.SRGBColorSpace;
  roomTex.needsUpdate = true;

  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(60, 40, 60),
    new THREE.MeshBasicMaterial({
      map: roomTex,
      side: THREE.BackSide, // inward-facing
      toneMapped: false,
    }),
  );
  env.add(shell);

  // --- a broad soft ceiling light plane, to key reflections ----------------
  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(48, 48),
    new THREE.MeshBasicMaterial({
      color: 0xfff4e0,
      toneMapped: false,
    }),
  );
  ceiling.position.set(0, 19.5, 0);
  ceiling.rotation.x = Math.PI / 2; // face down
  env.add(ceiling);

  // Two cooler side panels for gentle rim/edge reflections.
  const sideMat = new THREE.MeshBasicMaterial({
    color: 0x2a3348,
    toneMapped: false,
  });
  const sideGeo = new THREE.PlaneGeometry(50, 24);
  const sideA = new THREE.Mesh(sideGeo, sideMat);
  sideA.position.set(0, 6, -28);
  env.add(sideA);
  const sideB = new THREE.Mesh(sideGeo, sideMat);
  sideB.position.set(0, 6, 28);
  sideB.rotation.y = Math.PI;
  env.add(sideB);

  return { env, dispose: () => {
    roomTex.dispose();
    shell.geometry.dispose();
    shell.material.dispose();
    ceiling.geometry.dispose();
    ceiling.material.dispose();
    sideGeo.dispose();
    sideMat.dispose();
  } };
}

// ---------------------------------------------------------------------------
// Main setup
// ---------------------------------------------------------------------------

export function setupLighting(scene, renderer) {
  const group = new THREE.Group();
  group.name = 'LightingRig';

  // --- Hemisphere fill: cool sky, warm hardwood-tinted ground --------------
  const hemi = new THREE.HemisphereLight(VISUAL.skyTop, COURT.woodColorDark, 0.6);
  hemi.color.setHex(0x8fa6cf);   // cooler, brighter than raw skyTop for lift
  hemi.groundColor.setHex(0x4a3a26); // warm bounce off the wood
  hemi.position.set(0, 30, 0);
  group.add(hemi);

  // --- Low ambient so shadow cores are never pure black --------------------
  const ambient = new THREE.AmbientLight(0x2a3346, 0.35);
  group.add(ambient);

  // --- MAIN key light (only shadow caster) ---------------------------------
  const keyLight = new THREE.DirectionalLight(0xfff3e0, 3.1);
  keyLight.position.set(-9, 22, 11);   // high, angled over the court
  keyLight.target.position.set(2, 0, -1);
  keyLight.castShadow = true;

  keyLight.shadow.mapSize.set(2048, 2048);
  const sc = keyLight.shadow.camera;
  sc.left = -16;
  sc.right = 16;
  sc.top = 9;
  sc.bottom = -9;
  sc.near = 1;
  sc.far = 60;
  sc.updateProjectionMatrix();
  keyLight.shadow.bias = -0.0004;
  keyLight.shadow.normalBias = 0.02;
  keyLight.shadow.radius = 3; // soft PCF penumbra

  group.add(keyLight);
  group.add(keyLight.target);

  // --- Overhead fills for glossy floor specular (NO shadows) ---------------
  // A couple of directional fills from opposing high angles even out the court
  // and give the hardwood broad specular sheen without extra shadow cost.
  const fillA = new THREE.DirectionalLight(0xbcd0f0, 0.9); // cool cross-fill
  fillA.position.set(13, 18, -12);
  fillA.target.position.set(-3, 0, 2);
  fillA.castShadow = false;
  group.add(fillA);
  group.add(fillA.target);

  const fillB = new THREE.DirectionalLight(0xffe8c8, 0.6); // warm back/rim fill
  fillB.position.set(4, 16, -18);
  fillB.target.position.set(-1, 0, 4);
  fillB.castShadow = false;
  group.add(fillB);
  group.add(fillB.target);

  // Two overhead spotlights create tighter moving-highlight pools on the wood.
  const spots = [];
  const spotDefs = [
    { x: -8, z: 0, intensity: 90, color: 0xfff2da },
    { x: 8, z: 0, intensity: 90, color: 0xfff2da },
  ];
  for (const d of spotDefs) {
    const spot = new THREE.SpotLight(d.color, d.intensity);
    spot.position.set(d.x, 17, d.z);
    spot.angle = 0.62;
    spot.penumbra = 0.85;
    spot.decay = 2;
    spot.distance = 40;
    spot.castShadow = false;
    spot.target.position.set(d.x, 0, d.z);
    group.add(spot);
    group.add(spot.target);
    spots.push(spot);
  }

  scene.add(group);

  // --- Environment map via PMREM -------------------------------------------
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const { env, dispose } = buildEnvScene();
  const envRT = pmrem.fromScene(env, 0.04);
  const envTexture = envRT.texture;
  scene.environment = envTexture;
  // The generator and source scene are no longer needed.
  dispose();
  pmrem.dispose();

  // --- update: extremely subtle rig "breathing" ----------------------------
  let t = 0;
  const baseKey = keyLight.intensity;
  function update(dt) {
    t += dt || 0;
    // Barely-perceptible flicker so broadcast lights feel alive, not static.
    keyLight.intensity = baseKey * (1 + Math.sin(t * 1.7) * 0.006);
  }

  return { keyLight, envTexture, update };
}
