// render.js — everything the player sees, drawn with three.js 0.187.0.
// The renderer owns no game state: each frame it is handed the match and
// the camera view, and it moves the pooled meshes to match. No objects
// are created in the hot loop — meshes, materials and geometries are built
// once in createRenderer and reused.
//
// Palette: a dusk container yard — cold asphalt, rust-orange and teal
// containers, warm low sun. Vanguard read teal, Sentinel read orange,
// so a silhouette tells you whose side it is on at a glance.

import * as THREE from 'three';
import { MAP, OBSTACLES, SITES } from './world.js';

const VANGUARD_COLOR = 0x2ec4b6;
const SENTINEL_COLOR = 0xe4572e;
const CONTAINER_COLORS = [0xb65c33, 0x2e8f86, 0xc9a227];

function groundTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#3a3f45';
  g.fillRect(0, 0, 512, 512);
  // Speckled asphalt.
  for (let i = 0; i < 2600; i++) {
    const v = 52 + Math.floor(Math.random() * 26);
    g.fillStyle = `rgb(${v},${v + 3},${v + 6})`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
  }
  // Yard lane markings.
  g.strokeStyle = 'rgba(201,162,39,0.55)';
  g.lineWidth = 4;
  g.setLineDash([26, 18]);
  g.beginPath();
  g.moveTo(0, 128);
  g.lineTo(512, 128);
  g.moveTo(0, 384);
  g.lineTo(512, 384);
  g.stroke();
  g.setLineDash([]);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 6);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function textSprite(text, color) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const g = c.getContext('2d');
  g.font = 'bold 56px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 10;
  g.strokeStyle = 'rgba(0,0,0,0.85)';
  g.strokeText(text, 128, 48);
  g.fillStyle = color;
  g.fillText(text, 128, 48);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const spr = new THREE.Sprite(mat);
  spr.scale.set(2.2, 0.82, 1);
  return spr;
}

function makeFighterMesh(team) {
  const group = new THREE.Group();
  const bodyColor = team === 'v' ? VANGUARD_COLOR : SENTINEL_COLOR;
  const dark = new THREE.Color(bodyColor).multiplyScalar(0.55);
  const bodyMat = new THREE.MeshLambertMaterial({ color: bodyColor });
  const darkMat = new THREE.MeshLambertMaterial({ color: dark });
  const skinMat = new THREE.MeshLambertMaterial({ color: 0xc9a186 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.78, 0.34), bodyMat);
  torso.position.y = 0.98;
  group.add(torso);
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.38), darkMat);
  vest.position.y = 1.02;
  group.add(vest);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), skinMat);
  head.position.y = 1.56;
  group.add(head);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), darkMat);
  helmet.position.y = 1.58;
  group.add(helmet);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.62, 0.24), darkMat);
  legL.position.set(-0.15, 0.31, 0);
  group.add(legL);
  const legR = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.62, 0.24), darkMat);
  legR.position.set(0.15, 0.31, 0);
  group.add(legR);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.72), new THREE.MeshLambertMaterial({ color: 0x1c1e22 }));
  gun.position.set(0.22, 1.18, -0.32);
  group.add(gun);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.5), bodyMat);
  arm.position.set(0.22, 1.18, -0.1);
  group.add(arm);
  return group;
}

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1b2430);
  scene.fog = new THREE.Fog(0x1b2430, 30, 95);

  const camera = new THREE.PerspectiveCamera(75, 1, 0.08, 220);
  camera.rotation.order = 'YXZ';
  scene.add(camera);

  const hemi = new THREE.HemisphereLight(0x9db4cc, 0x3a2f26, 1.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffc98a, 1.8);
  sun.position.set(-18, 26, -12);
  scene.add(sun);

  // --- ground and perimeter ---
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(MAP.halfW * 2 + 8, MAP.halfD * 2 + 8),
    new THREE.MeshLambertMaterial({ map: groundTexture() }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const wallMat = new THREE.MeshLambertMaterial({ color: 0x565b63 });
  const wallH = 4.2;
  const walls = [
    { w: MAP.halfW * 2 + 1, d: 0.6, x: 0, z: -MAP.halfD - 0.3 },
    { w: MAP.halfW * 2 + 1, d: 0.6, x: 0, z: MAP.halfD + 0.3 },
    { w: 0.6, d: MAP.halfD * 2 + 1, x: -MAP.halfW - 0.3, z: 0 },
    { w: 0.6, d: MAP.halfD * 2 + 1, x: MAP.halfW + 0.3, z: 0 },
  ];
  for (const wl of walls) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(wl.w, wallH, wl.d), wallMat);
    wall.position.set(wl.x, wallH / 2, wl.z);
    scene.add(wall);
  }
  // Distant skyline silhouettes outside the walls.
  const skyMat = new THREE.MeshLambertMaterial({ color: 0x232c3a });
  const skyline = [[-40, -34, 10, 18], [10, -38, 14, 24], [38, -30, 8, 14], [-38, 34, 12, 16], [30, 36, 16, 22], [44, 8, 8, 12]];
  for (const [x, z, w, h] of skyline) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), skyMat);
    b.position.set(x, h / 2, z);
    scene.add(b);
  }

  // --- obstacles ---
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const crateMat = new THREE.MeshLambertMaterial({ color: 0x8a6b46 });
  const barrierMat = new THREE.MeshLambertMaterial({ color: 0x7d838c });
  const pillarMat = new THREE.MeshLambertMaterial({ color: 0x4d535c });
  const siloMat = new THREE.MeshLambertMaterial({ color: 0x9aa2ab });
  const containerMats = CONTAINER_COLORS.map((c) => new THREE.MeshLambertMaterial({ color: c }));
  for (const o of OBSTACLES) {
    let mesh;
    if (o.kind === 'silo') {
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.1, o.h, 14), siloMat);
      mesh.position.set(o.x, o.h / 2, o.z);
      scene.add(mesh);
      continue;
    }
    const mat = o.kind === 'container' ? containerMats[o.tint % containerMats.length]
      : o.kind === 'crate' ? crateMat
      : o.kind === 'barrier' ? barrierMat : pillarMat;
    mesh = new THREE.Mesh(boxGeo, mat);
    mesh.scale.set(o.hw * 2, o.h, o.hd * 2);
    mesh.position.set(o.x, o.h / 2, o.z);
    scene.add(mesh);
    // A darker lid line on containers so they read as stacked boxes.
    if (o.kind === 'container') {
      const lid = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0x000000, transparent: true, opacity: 0.18 }));
      lid.scale.set(o.hw * 2 + 0.04, 0.08, o.hd * 2 + 0.04);
      lid.position.set(o.x, o.h - 0.05, o.z);
      scene.add(lid);
    }
  }

  // --- spike sites: glowing ring + floating letter ---
  const siteMeshes = {};
  for (const site of Object.values(SITES)) {
    const color = site.id === 'A' ? 0xe8b13c : 0x3cc4a8;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(site.r - 0.35, site.r, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.x, 0.03, site.z);
    scene.add(ring);
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(site.r - 0.4, 32),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.1, side: THREE.DoubleSide }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(site.x, 0.025, site.z);
    scene.add(disc);
    const letter = textSprite(site.id, site.id === 'A' ? '#e8b13c' : '#3cc4a8');
    letter.position.set(site.x, 3.4, site.z);
    scene.add(letter);
    siteMeshes[site.id] = { ring, letter };
  }

  // --- fighters (pooled, 8) ---
  const fighterMeshes = new Map();
  function fighterMesh(f) {
    let entry = fighterMeshes.get(f.id);
    if (!entry) {
      const group = makeFighterMesh(f.team);
      const tag = textSprite(f.name, f.team === 'v' ? '#7fe7dc' : '#ffb199');
      tag.position.y = 2.05;
      tag.scale.set(1.7, 0.64, 1);
      group.add(tag);
      scene.add(group);
      entry = { group, tag };
      fighterMeshes.set(f.id, entry);
    }
    return entry;
  }

  // --- viewmodel gun + muzzle flash ---
  const viewGun = new THREE.Group();
  const gunMat = new THREE.MeshLambertMaterial({ color: 0x23262b });
  const gunBody = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.52), gunMat);
  viewGun.add(gunBody);
  const gunBarrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.3), gunMat);
  gunBarrel.position.set(0, 0.02, -0.38);
  viewGun.add(gunBarrel);
  const gunGrip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.09), gunMat);
  gunGrip.position.set(0, -0.13, 0.12);
  gunGrip.rotation.x = 0.3;
  viewGun.add(gunGrip);
  const flashTex = (() => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,240,200,1)');
    grad.addColorStop(0.35, 'rgba(255,200,90,0.9)');
    grad.addColorStop(1, 'rgba(255,160,40,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  })();
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.22, 0.22),
    new THREE.MeshBasicMaterial({ map: flashTex, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
  );
  flash.position.set(0, 0.02, -0.56);
  viewGun.add(flash);
  const flashLight = new THREE.PointLight(0xffc06a, 0, 9);
  flashLight.position.set(0, 0.1, -0.6);
  viewGun.add(flashLight);
  viewGun.position.set(0.26, -0.21, -0.42);
  camera.add(viewGun);

  // --- tracers (pooled lines) ---
  const tracerPool = [];
  for (let i = 0; i < 24; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0 }));
    line.frustumCulled = false;
    scene.add(line);
    tracerPool.push(line);
  }

  // --- smoke puffs (pooled spheres) ---
  const smokePool = [];
  const smokeGeo = new THREE.SphereGeometry(1, 12, 10);
  const smokeMat = new THREE.MeshLambertMaterial({ color: 0xb9bec6, transparent: true, opacity: 0.5 });
  for (let i = 0; i < 8; i++) {
    const s = new THREE.Mesh(smokeGeo, smokeMat);
    s.visible = false;
    scene.add(s);
    smokePool.push(s);
  }

  // --- spike + grenades + explosion ---
  const spikeMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.22, 0.34),
    new THREE.MeshLambertMaterial({ color: 0xd8382c, emissive: 0x881108 }),
  );
  spikeMesh.visible = false;
  scene.add(spikeMesh);
  const spikeLight = new THREE.PointLight(0xff2a1a, 0, 8);
  scene.add(spikeLight);
  const grenadeGeo = new THREE.SphereGeometry(0.09, 8, 6);
  const grenadeMat = new THREE.MeshLambertMaterial({ color: 0x2c3430 });
  const grenadePool = [];
  for (let i = 0; i < 6; i++) {
    const g = new THREE.Mesh(grenadeGeo, grenadeMat);
    g.visible = false;
    scene.add(g);
    grenadePool.push(g);
  }
  const boomMesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xff8c2e, transparent: true, opacity: 0 }),
  );
  boomMesh.visible = false;
  scene.add(boomMesh);
  const boomLight = new THREE.PointLight(0xff7a20, 0, 40);
  scene.add(boomLight);
  let boomT = 0;
  let lastExplodeTick = -1;

  function resize(w, h) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  return {
    resize,
    dispose() {
      renderer.dispose();
    },
    /** Draw one frame from the match state and the camera view. */
    render(m, view, dt) {
      // Camera: first person, recoil lifts the pitch a touch.
      camera.position.set(view.x, view.eye, view.z);
      camera.rotation.y = view.yaw;
      camera.rotation.x = view.pitch + (view.recoil ?? 0);
      const targetFov = view.scoped ? 26 : 75;
      if (Math.abs(camera.fov - targetFov) > 0.5) {
        camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 14);
        camera.updateProjectionMatrix();
      }
      viewGun.visible = !view.scoped;
      viewGun.position.z = -0.42 + (view.recoil ?? 0) * 1.4;
      const flashOn = (view.flashT ?? 0) > 0;
      flash.material.opacity = flashOn ? 0.85 : 0;
      flashLight.intensity = flashOn ? 2.4 : 0;

      // Fighters.
      const seen = new Set();
      for (const f of m.fighters) {
        seen.add(f.id);
        const { group, tag } = fighterMesh(f);
        if (!f.alive) {
          group.visible = false;
          continue;
        }
        group.visible = true;
        group.position.set(f.x, 0, f.z);
        group.rotation.y = f.yaw;
        group.scale.y = f.crouched ? 0.72 : 1;
        tag.visible = f.id !== m.playerId;
      }
      for (const [id, entry] of fighterMeshes) {
        if (!seen.has(id)) entry.group.visible = false;
      }

      // Site rings pulse gently; the planted site flashes red.
      const t = m.time;
      for (const site of Object.values(SITES)) {
        const sm = siteMeshes[site.id];
        const plantedHere = m.spike.state === 'planted' && m.spike.siteId === site.id;
        sm.ring.material.opacity = plantedHere ? 0.55 + 0.45 * Math.sin(t * 9) : 0.6 + 0.15 * Math.sin(t * 1.5);
        if (plantedHere) sm.ring.material.color.setHex(0xff2a1a);
      }

      // Spike: planted (blinking on the ground) or dropped.
      if (m.spike.state === 'planted' || m.spike.state === 'dropped') {
        spikeMesh.visible = true;
        spikeMesh.position.set(m.spike.x, 0.12, m.spike.z);
        spikeMesh.rotation.y = t * 1.2;
        const blink = m.spike.state === 'planted' ? (Math.sin(t * 9) > 0 ? 2.2 : 0.2) : 0.6;
        spikeLight.position.set(m.spike.x, 0.8, m.spike.z);
        spikeLight.intensity = blink;
      } else {
        spikeMesh.visible = false;
        spikeLight.intensity = 0;
      }

      // Grenades in flight.
      for (let i = 0; i < grenadePool.length; i++) {
        const g = m.grenades[i];
        if (g) {
          grenadePool[i].visible = true;
          grenadePool[i].position.set(g.x, Math.max(0.1, g.y), g.z);
        } else {
          grenadePool[i].visible = false;
        }
      }

      // Smoke puffs.
      for (let i = 0; i < smokePool.length; i++) {
        const s = m.smokes[i];
        if (s) {
          smokePool[i].visible = true;
          smokePool[i].position.set(s.x, 1.4, s.z);
          const sc = s.r * (0.9 + 0.08 * Math.sin(t * 0.8 + i));
          smokePool[i].scale.set(sc, sc * 0.75, sc);
        } else {
          smokePool[i].visible = false;
        }
      }

      // Tracers.
      for (let i = 0; i < tracerPool.length; i++) {
        const tr = m.tracers[i];
        const line = tracerPool[i];
        if (!tr) {
          line.material.opacity = 0;
          continue;
        }
        const pos = line.geometry.attributes.position;
        pos.setXYZ(0, tr.x1, tr.y1, tr.z1);
        pos.setXYZ(1, tr.x2, tr.y2, tr.z2);
        pos.needsUpdate = true;
        const remain = Math.max(0, tr.until - m.time);
        line.material.opacity = Math.min(0.9, remain / 0.14);
      }

      // Explosion: trigger on the first 'explode' event we have not seen.
      for (const ev of m.events) {
        if (ev.type === 'explode' && ev.tick > lastExplodeTick) {
          lastExplodeTick = ev.tick;
          boomT = 1;
          boomMesh.visible = true;
          boomMesh.position.set(m.spike.x, 0.6, m.spike.z);
        }
      }
      if (boomT > 0) {
        boomT = Math.max(0, boomT - dt * 1.4);
        const s = (1 - boomT) * 16 + 0.5;
        boomMesh.scale.set(s, s * 0.7, s);
        boomMesh.material.opacity = boomT * 0.85;
        boomLight.position.set(m.spike.x, 1.5, m.spike.z);
        boomLight.intensity = boomT * 6;
        if (boomT === 0) boomMesh.visible = false;
      }

      renderer.render(scene, camera);
    },
  };
}
