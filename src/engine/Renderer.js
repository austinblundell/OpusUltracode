/**
 * Renderer.js — WebGL renderer, scene, camera, resize.
 */
import * as THREE from 'three';
import { VISUAL } from '../config/Constants.js';

function gradientTexture(top, bottom) {
  const c = document.createElement('canvas');
  c.width = 8; c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#' + top.toString(16).padStart(6, '0'));
  g.addColorStop(1, '#' + bottom.toString(16).padStart(6, '0'));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 8, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function createEngine(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = VISUAL.exposure;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = gradientTexture(VISUAL.skyTop, VISUAL.skyBottom);
  scene.fog = new THREE.Fog(VISUAL.fogColor, VISUAL.fogNear, VISUAL.fogFar);

  const camera = new THREE.PerspectiveCamera(
    42, window.innerWidth / window.innerHeight, 0.1, 500,
  );
  camera.position.set(0, 12, 24);
  camera.lookAt(0, 1.5, 0);

  function onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  }
  window.addEventListener('resize', onResize);

  return { renderer, scene, camera, onResize };
}
