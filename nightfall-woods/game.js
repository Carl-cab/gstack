/* Nightfall Woods — a blocky forest survival game.
 * Vanilla Three.js (r128 global build). No build step, no network.
 * Survive from 4:00 AM until dawn at 6:00 AM while managing health,
 * hunger and thirst, chopping wood to feed the fire, and avoiding the
 * thing that hunts you in the dark.
 */
'use strict';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const CFG = {
  worldSize: 240,
  treeCount: 190,
  clearingRadius: 16,      // no trees spawn inside the camp clearing
  startHour: 4.0,          // 4:00 AM
  dawnHour: 6.0,           // survive to here = win
  nightLengthSec: 300,     // real seconds from 4:00 -> 6:00 AM (5 min)
  hungerDrain: 100 / 320,  // %/sec  (empty in ~5.3 min if ignored)
  thirstDrain: 100 / 240,  // %/sec
  starveDamage: 3.5,       // hp/sec when hunger OR thirst is empty
  walkSpeed: 7,
  sprintSpeed: 12,
  woodGoal: 5,
};

// ---------------------------------------------------------------------------
// Renderer / scene / camera
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.82;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070d);
scene.fog = new THREE.FogExp2(0x05070d, 0.021);

const camera = new THREE.PerspectiveCamera(66, window.innerWidth / window.innerHeight, 0.1, 500);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
// Lighting  (dark, moonlit night)
// ---------------------------------------------------------------------------
const moonLight = new THREE.DirectionalLight(0x8ba2c8, 0.26);
moonLight.position.set(-60, 90, -40);
moonLight.castShadow = true;
moonLight.shadow.mapSize.set(2048, 2048);
moonLight.shadow.camera.near = 1;
moonLight.shadow.camera.far = 260;
moonLight.shadow.camera.left = -90;
moonLight.shadow.camera.right = 90;
moonLight.shadow.camera.top = 90;
moonLight.shadow.camera.bottom = -90;
moonLight.shadow.bias = -0.0004;
scene.add(moonLight);
scene.add(moonLight.target);

const hemi = new THREE.HemisphereLight(0x28405f, 0x070806, 0.17);
scene.add(hemi);

// ---------------------------------------------------------------------------
// Ground
// ---------------------------------------------------------------------------
(function buildGround() {
  const seg = 64;
  const geo = new THREE.PlaneGeometry(CFG.worldSize, CFG.worldSize, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const d = Math.hypot(x, z);
    // gentle rolling hills, but keep the camp clearing flat
    let h = Math.sin(x * 0.06) * Math.cos(z * 0.05) * 1.6 + Math.sin(x * 0.13 + z * 0.1) * 0.7;
    if (d < CFG.clearingRadius) h *= d / CFG.clearingRadius;
    pos.setY(i, h);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0x1a2216, roughness: 1, metalness: 0 });
  const ground = new THREE.Mesh(geo, mat);
  ground.receiveShadow = true;
  scene.add(ground);
})();

// ---------------------------------------------------------------------------
// Moon
// ---------------------------------------------------------------------------
(function buildMoon() {
  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(9, 24, 24),
    new THREE.MeshBasicMaterial({ color: 0xdfe8ff })
  );
  moon.position.set(-120, 78, -150);
  scene.add(moon);
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(14, 24, 24),
    new THREE.MeshBasicMaterial({ color: 0x8fa6d0, transparent: true, opacity: 0.28 })
  );
  glow.position.copy(moon.position);
  scene.add(glow);

  // starfield
  const starGeo = new THREE.BufferGeometry();
  const stars = [];
  for (let i = 0; i < 900; i++) {
    const r = 300;
    const t = Math.random() * Math.PI * 2;
    const p = Math.random() * Math.PI * 0.5;
    stars.push(Math.cos(t) * Math.sin(p) * r, Math.cos(p) * r * 0.9 + 30, Math.sin(t) * Math.sin(p) * r);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(stars, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xbcc8e8, size: 0.7, sizeAttenuation: false })));
})();

// ---------------------------------------------------------------------------
// Trees  (instanced trunks + foliage; positions tracked for chopping/collision)
// ---------------------------------------------------------------------------
const trees = [];   // { x, z, chopped }
const TREE_R = 1.1; // collision radius
let trunkMesh, foliageMesh;

(function buildTrees() {
  const trunkGeo = new THREE.CylinderGeometry(0.28, 0.42, 4.4, 6);
  trunkGeo.translate(0, 2.2, 0);
  const foliageGeo = new THREE.ConeGeometry(2.1, 6.2, 7);
  foliageGeo.translate(0, 6.6, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 1 });
  const foliageMat = new THREE.MeshStandardMaterial({ color: 0x16351f, roughness: 1 });

  trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, CFG.treeCount);
  foliageMesh = new THREE.InstancedMesh(foliageGeo, foliageMat, CFG.treeCount);
  trunkMesh.castShadow = foliageMesh.castShadow = true;
  trunkMesh.receiveShadow = foliageMesh.receiveShadow = true;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  let placed = 0, guard = 0;
  while (placed < CFG.treeCount && guard++ < CFG.treeCount * 40) {
    const x = (Math.random() - 0.5) * (CFG.worldSize - 20);
    const z = (Math.random() - 0.5) * (CFG.worldSize - 20);
    if (Math.hypot(x, z) < CFG.clearingRadius + 4) continue;         // keep clearing open
    if (x > 8 && x < 34 && z > -30 && z < 30) continue;              // keep lake area open
    const sc = 0.75 + Math.random() * 0.9;
    p.set(x, 0, z);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2);
    s.set(sc, sc * (0.9 + Math.random() * 0.3), sc);
    m.compose(p, q, s);
    trunkMesh.setMatrixAt(placed, m);
    foliageMesh.setMatrixAt(placed, m);
    trees.push({ x, z, chopped: false, matrix: m.clone(), scale: sc });
    placed++;
  }
  trunkMesh.count = foliageMesh.count = placed;
  trunkMesh.instanceMatrix.needsUpdate = foliageMesh.instanceMatrix.needsUpdate = true;
  scene.add(trunkMesh, foliageMesh);
})();

function chopTreeAt(index) {
  const t = trees[index];
  if (!t || t.chopped) return;
  t.chopped = true;
  // collapse the instance to nothing (stump left behind)
  const m = new THREE.Matrix4().makeScale(0.0001, 0.0001, 0.0001);
  foliageMesh.setMatrixAt(index, m);
  foliageMesh.instanceMatrix.needsUpdate = true;
  const stumpM = new THREE.Matrix4().compose(
    new THREE.Vector3(t.x, 0, t.z),
    new THREE.Quaternion(),
    new THREE.Vector3(t.scale, t.scale * 0.12, t.scale)
  );
  trunkMesh.setMatrixAt(index, stumpM);
  trunkMesh.instanceMatrix.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Cabin
// ---------------------------------------------------------------------------
const cabinPos = new THREE.Vector3(-13, 0, -8);
(function buildCabin() {
  const g = new THREE.Group();
  const wall = new THREE.MeshStandardMaterial({ color: 0x4a3625, roughness: 1 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x2c1f16, roughness: 1 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(9, 5, 8), wall);
  body.position.y = 2.5; body.castShadow = body.receiveShadow = true; g.add(body);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(7.6, 3.4, 4), roofMat);
  roof.position.y = 6.6; roof.rotation.y = Math.PI / 4; roof.castShadow = true; g.add(roof);
  // glowing window
  const win = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.8),
    new THREE.MeshBasicMaterial({ color: 0xffb64d }));
  win.position.set(0, 2.8, 4.02); g.add(win);
  const winLight = new THREE.PointLight(0xffb04a, 0.7, 22, 2);
  winLight.position.set(0, 3, 5); g.add(winLight);
  g.position.copy(cabinPos);
  scene.add(g);
})();

// ---------------------------------------------------------------------------
// Campfire  (safe zone: warmth + light that deters the creature)
// ---------------------------------------------------------------------------
const firePos = new THREE.Vector3(4, 0, 4);
let fireLight, fireCore, fireFuel = 100;   // 0..100, drains over time; wood refuels
(function buildFire() {
  const g = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x555049, roughness: 1 });
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5), stoneMat);
    s.position.set(Math.cos(a) * 1.5, 0.2, Math.sin(a) * 1.5);
    s.castShadow = true; g.add(s);
  }
  fireCore = new THREE.Mesh(
    new THREE.ConeGeometry(0.8, 1.8, 8),
    new THREE.MeshBasicMaterial({ color: 0xff7a1a })
  );
  fireCore.position.y = 0.9; g.add(fireCore);
  fireLight = new THREE.PointLight(0xff7a2a, 2.4, 34, 2);
  fireLight.position.set(0, 1.6, 0);
  fireLight.castShadow = true;
  fireLight.shadow.mapSize.set(1024, 1024);
  g.add(fireLight);
  g.position.copy(firePos);
  scene.add(g);
})();

// ---------------------------------------------------------------------------
// Lake  +  boat (the "way out")
// ---------------------------------------------------------------------------
const boatPos = new THREE.Vector3(24, 0, 10);
(function buildLake() {
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(20, 40),
    new THREE.MeshStandardMaterial({ color: 0x0a2436, roughness: 0.15, metalness: 0.6, transparent: true, opacity: 0.9 })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(30, 0.05, 6);
  water.receiveShadow = true;
  scene.add(water);
  // dock
  const dockMat = new THREE.MeshStandardMaterial({ color: 0x3a2c1e, roughness: 1 });
  const dock = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.3, 9), dockMat);
  dock.position.set(20, 0.35, 8); dock.castShadow = dock.receiveShadow = true;
  scene.add(dock);
  // boat
  const boat = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.BoxGeometry(2, 0.8, 4.6),
    new THREE.MeshStandardMaterial({ color: 0x5a3d22, roughness: 1 }));
  hull.position.y = 0.4; hull.castShadow = true; boat.add(hull);
  boat.position.copy(boatPos); boat.position.y = 0.1;
  scene.add(boat);
})();

// ---------------------------------------------------------------------------
// Signpost (EXIT direction, matches the reference art)
// ---------------------------------------------------------------------------
(function buildSign() {
  const g = new THREE.Group();
  const postMat = new THREE.MeshStandardMaterial({ color: 0x4a3521, roughness: 1 });
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 3.4, 6), postMat);
  post.position.y = 1.7; post.castShadow = true; g.add(post);
  const labels = ['CABIN', 'LAKE', 'CAMP', 'EXIT'];
  labels.forEach((_, i) => {
    const arrow = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 0.12), postMat);
    arrow.position.set(0.9 * (i % 2 ? 1 : -1), 2.9 - i * 0.55, 0);
    arrow.castShadow = true; g.add(arrow);
  });
  g.position.set(-8, 0, 9);
  scene.add(g);
})();

// ---------------------------------------------------------------------------
// Pickups  (berries = food, water pools = drink) scattered in the woods
// ---------------------------------------------------------------------------
const pickups = [];  // { mesh, type }
(function buildPickups() {
  function scatter(type, count, color, y) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = CFG.clearingRadius + 6 + Math.random() * (CFG.worldSize / 2 - 24);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const mesh = new THREE.Mesh(
        new THREE.IcosahedronGeometry(type === 'food' ? 0.45 : 0.6, 0),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.6 })
      );
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      scene.add(mesh);
      pickups.push({ mesh, type, x, z });
    }
  }
  scatter('food', 16, 0xc0392b, 0.5);   // red berries
  scatter('water', 12, 0x2f8fd6, 0.4);  // water bottles / pools
})();

// ---------------------------------------------------------------------------
// Player avatar  (blocky Roblox-style figure)
// ---------------------------------------------------------------------------
const player = new THREE.Group();
const playerParts = {};
(function buildPlayer() {
  const skin = new THREE.MeshStandardMaterial({ color: 0xd9a679, roughness: 0.9 });
  const shirt = new THREE.MeshStandardMaterial({ color: 0x8f2b2b, roughness: 0.9 }); // red plaid vibe
  const pants = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.9 });
  const hair = new THREE.MeshStandardMaterial({ color: 0x1c140e, roughness: 1 });
  const packMat = new THREE.MeshStandardMaterial({ color: 0x6b2b2b, roughness: 1 });

  function box(w, h, d, mat, x, y, z) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    b.position.set(x, y, z); b.castShadow = true; return b;
  }
  const torso = box(1.1, 1.3, 0.6, shirt, 0, 1.5, 0); player.add(torso);
  const head = box(0.85, 0.85, 0.85, skin, 0, 2.55, 0); player.add(head);
  player.add(box(0.9, 0.35, 0.9, hair, 0, 2.95, 0)); // hair cap
  const pack = box(0.8, 1.0, 0.4, packMat, 0, 1.55, -0.45); player.add(pack);

  const armL = box(0.32, 1.2, 0.32, skin, -0.72, 1.5, 0); player.add(armL);
  const armR = box(0.32, 1.2, 0.32, skin, 0.72, 1.5, 0); player.add(armR);
  const legL = box(0.4, 1.2, 0.4, pants, -0.28, 0.6, 0); player.add(legL);
  const legR = box(0.4, 1.2, 0.4, pants, 0.28, 0.6, 0); player.add(legR);

  // held light (glove + lantern glow) on right arm, matches reference
  const glow = new THREE.PointLight(0xfff0c0, 0.0, 6, 2);
  glow.position.set(0.72, 1.0, 0.4); player.add(glow);

  playerParts.armL = armL; playerParts.armR = armR;
  playerParts.legL = legL; playerParts.legR = legR;
  playerParts.head = head; playerParts.heldGlow = glow;
})();
player.position.set(0, 0, 10);
scene.add(player);

// Flashlight spotlight (follows player facing)
const flashlight = new THREE.SpotLight(0xfff2d0, 0.0, 46, Math.PI / 7, 0.4, 1.5);
flashlight.castShadow = true;
flashlight.shadow.mapSize.set(1024, 1024);
scene.add(flashlight);
scene.add(flashlight.target);

// ---------------------------------------------------------------------------
// The Creatures  (blocky wendigo-deer that hunt in the dark).
// Stored in an array so later nights can field more than one.
// ---------------------------------------------------------------------------
const creatures = [];   // { group, hp, mode, target, stagger, eyeLight }

function buildCreatureMesh() {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 1 });
  const antlerMat = new THREE.MeshStandardMaterial({ color: 0x6b5a44, roughness: 1 });
  function box(w, h, d, mat, x, y, z) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    b.position.set(x, y, z); b.castShadow = true; return b;
  }
  group.add(box(1.1, 1.4, 2.4, bodyMat, 0, 2.3, 0));     // torso
  group.add(box(0.8, 1.4, 0.7, bodyMat, 0, 3.2, 1.2));   // neck/head base
  group.add(box(0.7, 0.7, 1.0, bodyMat, 0, 3.8, 1.6));   // head
  [[-0.4, 1.0], [0.4, 1.0], [-0.4, -0.9], [0.4, -0.9]].forEach(([x, z]) =>
    group.add(box(0.3, 2.0, 0.3, bodyMat, x, 1.0, z)));
  for (const side of [-1, 1]) {
    group.add(box(0.12, 1.0, 0.12, antlerMat, side * 0.25, 4.4, 1.7));
    group.add(box(0.12, 0.5, 0.12, antlerMat, side * 0.55, 4.7, 1.7));
    group.add(box(0.12, 0.6, 0.12, antlerMat, side * 0.15, 4.9, 1.9));
  }
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffe14d }));
    eye.position.set(side * 0.2, 3.95, 2.05); group.add(eye);
  }
  const eyeLight = new THREE.PointLight(0xffcc33, 0.0, 8, 2);
  eyeLight.position.set(0, 3.9, 2); group.add(eyeLight);
  return { group, eyeLight };
}

function spawnCreature() {
  const { group, eyeLight } = buildCreatureMesh();
  const a = Math.random() * Math.PI * 2;
  group.position.set(Math.cos(a) * 72, 0, Math.sin(a) * 72);
  scene.add(group);
  creatures.push({ group, eyeLight, hp: 100, mode: 'wander', target: new THREE.Vector3(), stagger: 0 });
}

// Rebuild the pack for the current night: `count` fresh creatures.
function resetCreatures(count) {
  for (const c of creatures) scene.remove(c.group);
  creatures.length = 0;
  for (let i = 0; i < count; i++) spawnCreature();
}

function nearestCreature(maxDist) {
  let best = null, bd = maxDist * maxDist;
  for (const c of creatures) {
    const d = c.group.position.distanceToSquared(player.position);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
const G = {
  running: false,
  over: false,
  hp: 100, hunger: 100, thirst: 100,
  hour: CFG.startHour,
  wood: 0,
  yaw: 0, pitch: 0.15,
  velY: 0, onGround: true,
  flashlightOn: true,
  selected: 0,
  escaped: false,
  night: 99,            // current night number (advances when you survive)
  crafting: false,      // crafting overlay open
  spear: false,         // crafted spear upgrade (stronger, longer-reach knife)
  chasedNow: false,     // any creature currently chasing (for audio/threat)
  stepTimer: 0,         // footstep cadence
};

// Difficulty derived from the night number (Night 99 = baseline).
function diff() {
  const n = Math.max(0, G.night - 99);
  return {
    creatureCount: Math.min(5, 1 + Math.floor(n / 2)),
    speed: 6.2 + n * 0.45,
    detect: 34 + n * 2,
    drainMult: 1 + n * 0.08,
    contactDmg: 26 + n * 3,
  };
}

const ITEMS = [
  { key: 'flashlight', glyph: '🔦', name: 'Flashlight', count: null },
  { key: 'axe',        glyph: '🪓', name: 'Axe',        count: null },
  { key: 'knife',      glyph: '🔪', name: 'Knife',      count: null },
  { key: 'medkit',     glyph: '➕', name: 'First Aid',  count: 2 },
  { key: 'torch',      glyph: '🕯️', name: 'Torch',      count: 1 },
  { key: 'water',      glyph: '💧', name: 'Water',      count: 2 },
];

// Crafting recipes — all cost wood, the resource you gather with the axe.
const RECIPES = [
  { id: 'bandage', icon: '➕', name: 'Bandage',  desc: 'Restores a First Aid charge.', cost: 2,
    make: () => { itemByKey('medkit').count++; } },
  { id: 'torch',   icon: '🕯️', name: 'Torch',    desc: 'One more torch to stagger the beast.', cost: 2,
    make: () => { itemByKey('torch').count++; } },
  { id: 'fuel',    icon: '🔥', name: 'Fire Fuel', desc: 'Feed the campfire (+25 fuel) from anywhere.', cost: 1,
    make: () => { fireFuel = Math.min(100, fireFuel + 25); } },
  { id: 'spear',   icon: '🔱', name: 'Spear',     desc: 'Permanent: knife hits harder, longer reach.', cost: 4,
    once: true, made: false, make: () => { G.spear = true; } },
];
function itemByKey(k) { return ITEMS.find((i) => i.key === k); }

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
const dom = {
  hud: document.getElementById('hud'),
  night: document.getElementById('night'),
  clock: document.getElementById('clock'),
  hp: document.querySelector('#hpbar > span'),
  hunger: document.querySelector('#hungerbar > span'),
  thirst: document.querySelector('#thirstbar > span'),
  hotbar: document.getElementById('hotbar'),
  toast: document.getElementById('toast'),
  interact: document.getElementById('interact'),
  vignette: document.getElementById('vignette'),
  wood: document.getElementById('woodCount'),
  objSupplies: document.querySelector('[data-obj="supplies"]'),
  objEscape: document.querySelector('[data-obj="escape"]'),
  start: document.getElementById('start'),
  pause: document.getElementById('pause'),
  end: document.getElementById('end'),
  endTitle: document.getElementById('endTitle'),
  endText: document.getElementById('endText'),
  endStats: document.getElementById('endStats'),
  peers: document.getElementById('peers'),
  controlsCard: document.getElementById('controlsCard'),
  craft: document.getElementById('craft'),
  craftWood: document.getElementById('craftWood'),
  recipes: document.getElementById('recipes'),
  muteBtn: document.getElementById('muteBtn'),
};

function buildHotbar() {
  dom.hotbar.innerHTML = '';
  ITEMS.forEach((it, i) => {
    const s = document.createElement('div');
    s.className = 'slot' + (i === G.selected ? ' active' : '');
    s.dataset.i = i;
    s.innerHTML = `<span class="num">${i + 1}</span><span>${it.glyph}</span>` +
      (it.count !== null ? `<span class="count">x${it.count}</span>` : '');
    dom.hotbar.appendChild(s);
  });
}
function refreshHotbar() {
  [...dom.hotbar.children].forEach((s, i) => {
    s.classList.toggle('active', i === G.selected);
    const it = ITEMS[i];
    const cnt = s.querySelector('.count');
    if (it.count !== null) {
      if (cnt) cnt.textContent = 'x' + it.count;
      s.classList.toggle('empty', it.count <= 0);
    }
  });
}

let toastTimer = 0;
function toast(msg, secs = 1.8) {
  dom.toast.textContent = msg;
  dom.toast.classList.add('show');
  toastTimer = secs;
}

function updateHUD() {
  dom.hp.style.width = Math.max(0, G.hp) + '%';
  dom.hunger.style.width = Math.max(0, G.hunger) + '%';
  dom.thirst.style.width = Math.max(0, G.thirst) + '%';
  dom.wood.textContent = G.wood;
  dom.objSupplies.classList.toggle('done', G.wood >= CFG.woodGoal);
  dom.objEscape.classList.toggle('done', G.escaped);
  dom.night.textContent = 'NIGHT ' + G.night;
  // clock
  const h = Math.floor(G.hour);
  const m = Math.floor((G.hour - h) * 60);
  const hh = h === 0 ? 12 : h;
  dom.clock.textContent = `${hh}:${m.toString().padStart(2, '0')} AM`;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const keys = {};
window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'KeyM') { toggleMute(); return; }
  if (e.code === 'KeyH' && (G.running || G.crafting)) { toggleControlsCard(); return; }
  if (e.code === 'KeyC' && (G.running || G.crafting) && !G.over) { toggleCrafting(); return; }
  if (!G.running) return;
  if (e.code >= 'Digit1' && e.code <= 'Digit6') {
    G.selected = parseInt(e.code.slice(5)) - 1; refreshHotbar(); SFX.click();
  }
  if (e.code === 'KeyF') toggleFlashlight();
  if (e.code === 'KeyE') interact();
  if (e.code === 'Escape') pauseGame();
  if (e.code === 'Space' && G.onGround) { G.velY = 7.5; G.onGround = false; }
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });

// Look controls work two ways so the game is playable even where the browser
// blocks Pointer Lock (e.g. inside an embedded iframe / hosted preview):
//  - Locked mode: mouse moves the view freely (desktop, full page).
//  - Fallback mode: click-drag to look; a click that barely moves = "use item".
let lockActive = false;   // pointer lock currently held
let dragging = false, dragMoved = 0;

function applyLook(dx, dy) {
  G.yaw -= dx * 0.0024;
  G.pitch -= dy * 0.0022;
  G.pitch = Math.max(-0.55, Math.min(0.85, G.pitch));
}
renderer.domElement.addEventListener('mousemove', (e) => {
  if (!G.running) return;
  if (lockActive) applyLook(e.movementX, e.movementY);
  else if (dragging) { applyLook(e.movementX, e.movementY); dragMoved += Math.abs(e.movementX) + Math.abs(e.movementY); }
});
renderer.domElement.addEventListener('mousedown', (e) => {
  if (!G.running || e.button !== 0) return;
  if (lockActive) { useItem(); }
  else { dragging = true; dragMoved = 0; }        // start drag-look
});
window.addEventListener('mouseup', (e) => {
  if (e.button !== 0 || !dragging) return;
  dragging = false;
  if (G.running && dragMoved < 6) useItem();       // treated as a click, not a look-drag
});
document.addEventListener('pointerlockchange', () => {
  const nowLocked = document.pointerLockElement === renderer.domElement;
  // Only auto-pause when we actually HAD the lock and lost it mid-game
  // (browser Esc). Never pause just because lock was never granted.
  if (lockActive && !nowLocked && G.running && !G.over && !G.crafting) pauseGame();
  lockActive = nowLocked;
});
// If the environment refuses pointer lock, hint the fallback once.
document.addEventListener('pointerlockerror', () => {
  toast('Drag the mouse to look around', 2.5);
});
function tryPointerLock() {
  const el = renderer.domElement;
  if (el.requestPointerLock) { try { el.requestPointerLock(); } catch (_) { /* fallback drag mode */ } }
}

function toggleFlashlight() {
  G.flashlightOn = !G.flashlightOn;
  SFX.click();
  toast(G.flashlightOn ? 'Flashlight on' : 'Flashlight off', 1);
}

function toggleMute() {
  SFX.setMuted(!SFX.isMuted());
  if (dom.muteBtn) dom.muteBtn.textContent = SFX.isMuted() ? '🔇' : '🔊';
}

// In-game controls card: shown on spawn, auto-fades, toggled with H.
let controlsCardTimer = 0;
function showControlsCard(autoHideSecs) {
  dom.controlsCard.classList.remove('hidden');
  controlsCardTimer = autoHideSecs || 0;   // 0 = stay until toggled
}
function hideControlsCard() {
  dom.controlsCard.classList.add('hidden');
  controlsCardTimer = 0;
}
function toggleControlsCard() {
  if (dom.controlsCard.classList.contains('hidden')) showControlsCard(0);
  else hideControlsCard();
}

// ---------------------------------------------------------------------------
// Item use / interaction
// ---------------------------------------------------------------------------
let swingT = 0; // arm swing animation timer for tool use

function nearestTree(maxDist) {
  let best = -1, bd = maxDist * maxDist;
  for (let i = 0; i < trees.length; i++) {
    const t = trees[i];
    if (t.chopped) continue;
    const dx = t.x - player.position.x, dz = t.z - player.position.z;
    const d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

function useItem() {
  const it = ITEMS[G.selected];
  swingT = 0.32;
  switch (it.key) {
    case 'flashlight': toggleFlashlight(); break;
    case 'axe': {
      const i = nearestTree(3.2);
      if (i >= 0) {
        chopTreeAt(i);
        G.wood++;
        fireFuel = Math.min(100, fireFuel + 6);
        SFX.chop();
        toast('Chopped wood (+1)  🪵', 1.2);
      } else toast('No tree in range — get closer', 1);
      break;
    }
    case 'knife': attackCreature(); break;
    case 'medkit':
      if (it.count > 0 && G.hp < 100) { it.count--; G.hp = Math.min(100, G.hp + 40); SFX.heal(); toast('Bandaged (+40 HP)', 1.4); refreshHotbar(); }
      else if (it.count <= 0) toast('No first aid left — craft one (C)', 1.4);
      else toast('Health already full', 1);
      break;
    case 'torch':
      if (it.count > 0) {
        it.count--; refreshHotbar(); SFX.roar();
        toast('Torch waved — the dark recoils', 1.2);
        for (const c of creatures) {
          if (c.group.position.distanceTo(player.position) < 14) c.stagger = Math.max(c.stagger, 1.0);
        }
      } else toast('No torches left — craft one (C)', 1.4);
      break;
    case 'water':
      if (it.count > 0) { it.count--; G.thirst = Math.min(100, G.thirst + 45); SFX.drink(); toast('Drank water (+45 thirst)', 1.4); refreshHotbar(); }
      else toast('Water bottles empty — find more', 1.2);
      break;
  }
}

function attackCreature() {
  const reach = G.spear ? 6.0 : 4.5;
  const dmg = G.spear ? 45 : 25;
  const c = nearestCreature(reach);
  if (c) {
    c.hp -= dmg;
    c.stagger = 1.0;
    SFX.hurt();
    toast(G.spear ? 'You skewer it! 🔱' : 'You strike it! 🔪', 1);
    if (c.hp <= 0) {
      toast('It flees into the dark...', 2);
      const a = Math.random() * Math.PI * 2;
      c.group.position.set(Math.cos(a) * 90, 0, Math.sin(a) * 90);
      c.hp = 100; c.mode = 'wander';
    }
  } else {
    toast('Nothing in reach', 0.8);
  }
}

function interact() {
  // pick up nearby berries/water
  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i];
    if (player.position.distanceTo(p.mesh.position) < 2.4) {
      if (p.type === 'food') { G.hunger = Math.min(100, G.hunger + 30); SFX.drink(); toast('Ate berries (+30 hunger) 🍒', 1.4); }
      else {
        const w = ITEMS.find((x) => x.key === 'water'); w.count++; refreshHotbar(); SFX.drink();
        toast('Refilled water bottle (+1) 💧', 1.4);
      }
      scene.remove(p.mesh);
      pickups.splice(i, 1);
      return;
    }
  }
  // board the boat to escape (only after gathering supplies)
  if (player.position.distanceTo(boatPos) < 3.5) {
    if (G.wood >= CFG.woodGoal) { win('escape'); }
    else { toast(`The boat is stuck. Gather ${CFG.woodGoal} wood first to lever it free.`, 2.5); }
    return;
  }
  toast('Nothing to interact with here', 1);
}

// ---------------------------------------------------------------------------
// Player movement + collision
// ---------------------------------------------------------------------------
const tmp = new THREE.Vector3();
function movePlayer(dt) {
  const sprint = keys['ShiftLeft'] || keys['ShiftRight'];
  const speed = (sprint ? CFG.sprintSpeed : CFG.walkSpeed);
  let mx = 0, mz = 0;
  if (keys['KeyW']) mz -= 1;
  if (keys['KeyS']) mz += 1;
  if (keys['KeyA']) mx -= 1;
  if (keys['KeyD']) mx += 1;

  const moving = mx !== 0 || mz !== 0;
  if (moving) {
    const len = Math.hypot(mx, mz); mx /= len; mz /= len;
    // rotate by yaw
    const sin = Math.sin(G.yaw), cos = Math.cos(G.yaw);
    const wx = mx * cos - mz * sin;
    const wz = mx * sin + mz * cos;
    const nextX = player.position.x + wx * speed * dt;
    const nextZ = player.position.z + wz * speed * dt;
    // tree collision
    if (!collides(nextX, player.position.z)) player.position.x = nextX;
    if (!collides(player.position.x, nextZ)) player.position.z = nextZ;
    // face movement direction
    const targetRot = Math.atan2(wx, wz);
    let diff = targetRot - player.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    player.rotation.y += diff * Math.min(1, dt * 12);
  }
  // world bounds
  const lim = CFG.worldSize / 2 - 4;
  player.position.x = Math.max(-lim, Math.min(lim, player.position.x));
  player.position.z = Math.max(-lim, Math.min(lim, player.position.z));

  // gravity / jump
  G.velY -= 22 * dt;
  player.position.y += G.velY * dt;
  if (player.position.y <= 0) { player.position.y = 0; G.velY = 0; G.onGround = true; }

  // limb swing animation
  const t = performance.now() * 0.012;
  const swing = moving ? Math.sin(t * (sprint ? 1.5 : 1)) * (sprint ? 0.9 : 0.6) : 0;
  playerParts.legL.rotation.x = swing;
  playerParts.legR.rotation.x = -swing;
  playerParts.armL.rotation.x = -swing;
  if (swingT > 0) { playerParts.armR.rotation.x = -1.6 * (swingT / 0.32); swingT -= dt; }
  else playerParts.armR.rotation.x = swing;

  // footsteps
  if (moving && G.onGround) {
    G.stepTimer -= dt;
    if (G.stepTimer <= 0) { SFX.step(); G.stepTimer = sprint ? 0.28 : 0.42; }
  } else G.stepTimer = 0;

  return moving;
}

function collides(x, z) {
  for (let i = 0; i < trees.length; i++) {
    const t = trees[i];
    if (t.chopped) continue;
    const dx = t.x - x, dz = t.z - z;
    if (dx * dx + dz * dz < TREE_R * TREE_R) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Camera follow (third person)
// ---------------------------------------------------------------------------
function updateCamera() {
  const dist = 6.5, height = 3.2;
  const cx = player.position.x - Math.sin(G.yaw) * dist * Math.cos(G.pitch);
  const cz = player.position.z - Math.cos(G.yaw) * dist * Math.cos(G.pitch);
  const cy = player.position.y + height + Math.sin(G.pitch) * dist;
  camera.position.set(cx, cy, cz);
  camera.lookAt(player.position.x, player.position.y + 2.2, player.position.z);
}

// ---------------------------------------------------------------------------
// Creature AI
// ---------------------------------------------------------------------------
function updateCreatures(dt) {
  const d = diff();
  const distToFire = player.position.distanceTo(firePos);
  const inFireLight = distToFire < 9 && fireFuel > 5;
  let anyChasing = false;
  let closestChase = Infinity;

  for (const c of creatures) {
    const toPlayer = tmp.copy(player.position).sub(c.group.position);
    toPlayer.y = 0;
    const dist = toPlayer.length();
    if (c.stagger > 0) c.stagger -= dt;

    // detection: harder on later nights, blocked when you're by the fire
    const detectRange = inFireLight ? 6 : d.detect;
    if (dist < detectRange && c.stagger <= 0) c.mode = 'chase';
    else if (dist > d.detect + 14) c.mode = 'wander';

    if (c.mode === 'chase' && c.stagger <= 0) {
      anyChasing = true;
      closestChase = Math.min(closestChase, dist);
      toPlayer.normalize();
      c.group.position.x += toPlayer.x * d.speed * dt;
      c.group.position.z += toPlayer.z * d.speed * dt;
      c.group.rotation.y = Math.atan2(toPlayer.x, toPlayer.z);
      c.eyeLight.intensity = 1.4;
      if (dist < 3.0 && !inFireLight) damagePlayer(d.contactDmg * dt, true);
    } else {
      if (c.group.position.distanceTo(c.target) < 4) {
        const a = Math.random() * Math.PI * 2, r = 30 + Math.random() * 60;
        c.target.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      }
      const dir = tmp.copy(c.target).sub(c.group.position); dir.y = 0; dir.normalize();
      c.group.position.x += dir.x * 2.4 * dt;
      c.group.position.z += dir.z * 2.4 * dt;
      c.group.rotation.y = Math.atan2(dir.x, dir.z);
      c.eyeLight.intensity = 0.5;
    }
    // stagger recoil (pushed back when hit / torch)
    if (c.stagger > 0 && dist < 12) {
      const away = tmp.copy(c.group.position).sub(player.position).setY(0).normalize();
      c.group.position.x += away.x * 4 * dt;
      c.group.position.z += away.z * 4 * dt;
    }
    c.group.position.y = 0;
  }

  // audio: threat drone swells with the nearest chaser; stinger on first chase
  if (anyChasing && !G.chasedNow) SFX.stinger();
  G.chasedNow = anyChasing;
  SFX.setThreat(anyChasing ? Math.max(0.2, 1 - closestChase / 34) : 0);
}

// ---------------------------------------------------------------------------
// Damage / stats
// ---------------------------------------------------------------------------
let hurtFlash = 0;
function damagePlayer(amount, fromCreature) {
  if (G.over) return;
  if (fromCreature && hurtFlash <= 0) SFX.hurt();  // grunt, throttled by the flash window
  G.hp -= amount;
  if (fromCreature) hurtFlash = 0.35;
  if (G.hp <= 0) { G.hp = 0; lose(); }
}

function updateStats(dt) {
  const m = diff().drainMult;
  G.hunger = Math.max(0, G.hunger - CFG.hungerDrain * m * dt);
  G.thirst = Math.max(0, G.thirst - CFG.thirstDrain * m * dt);
  if (G.hunger <= 0) damagePlayer(CFG.starveDamage * dt, false);
  if (G.thirst <= 0) damagePlayer(CFG.starveDamage * dt, false);
  // slow regen when fed, hydrated and warm by the fire
  const warm = player.position.distanceTo(firePos) < 9 && fireFuel > 5;
  if (G.hunger > 40 && G.thirst > 40 && warm && G.hp < 100) G.hp = Math.min(100, G.hp + 4 * dt);

  // fire burns down; feed it with wood via the axe (handled on chop)
  fireFuel = Math.max(0, fireFuel - dt * (100 / 90)); // empties in ~90s if unfed
}

// ---------------------------------------------------------------------------
// Time of day
// ---------------------------------------------------------------------------
function updateTime(dt) {
  G.hour += (CFG.dawnHour - CFG.startHour) / CFG.nightLengthSec * dt;
  const t = (G.hour - CFG.startHour) / (CFG.dawnHour - CFG.startHour); // 0..1
  // brighten toward dawn (starts near-black, greys up as 6 AM approaches)
  hemi.intensity = 0.15 + t * 0.55;
  moonLight.intensity = 0.24 + t * 0.40;
  const dawn = new THREE.Color(0x05070d).lerp(new THREE.Color(0x28405c), t);
  scene.background.copy(dawn);
  scene.fog.color.copy(dawn);
  scene.fog.density = 0.024 - t * 0.013;
  if (G.hour >= CFG.dawnHour) advanceNight();
}

// Surviving to dawn doesn't end the run — it pushes you into a harder night.
function advanceNight() {
  G.night++;
  G.hour = CFG.startHour;
  // small reward for making it: top up hunger/thirst, keep whatever HP you have
  G.hunger = Math.min(100, G.hunger + 30);
  G.thirst = Math.min(100, G.thirst + 30);
  fireFuel = 100;
  const d = diff();
  resetCreatures(d.creatureCount);
  SFX.win();
  const extra = d.creatureCount > 1 ? ` ${d.creatureCount} of them stalk the trees now.` : '';
  toast(`You survived. NIGHT ${G.night} begins —${extra || ' the forest grows hungrier.'}`, 3.2);
  updateHUD();
}

// ---------------------------------------------------------------------------
// Fire / light updates + flicker
// ---------------------------------------------------------------------------
function updateLights(dt) {
  const flick = 0.85 + Math.sin(performance.now() * 0.02) * 0.1 + Math.random() * 0.12;
  const fuelScale = Math.max(0.06, fireFuel / 100);
  fireLight.intensity = 2.4 * flick * fuelScale;
  fireCore.scale.setScalar(0.5 + fuelScale * 0.8 + Math.random() * 0.1);
  fireCore.material.color.setHSL(0.07, 1, 0.35 + fuelScale * 0.15);

  // fire audio: louder the closer you are, scaled by remaining fuel
  const fireDist = player.position.distanceTo(firePos);
  const prox = Math.max(0, 1 - fireDist / 16);
  SFX.setFire(prox * fuelScale);

  // flashlight follows camera-forward from player head
  const on = G.flashlightOn ? 1 : 0;
  flashlight.intensity = 3.0 * on;
  playerParts.heldGlow.intensity = 0.5 * on;
  const hp = player.position;
  flashlight.position.set(hp.x, hp.y + 2.3, hp.z);
  flashlight.target.position.set(
    hp.x + Math.sin(G.yaw) * 10,
    hp.y + 1.6 - G.pitch * 6,
    hp.z + Math.cos(G.yaw) * 10
  );
}

// ---------------------------------------------------------------------------
// Interact prompt (context hint)
// ---------------------------------------------------------------------------
function updateInteractPrompt() {
  let msg = '';
  for (const p of pickups) {
    if (player.position.distanceTo(p.mesh.position) < 2.4) {
      msg = p.type === 'food' ? 'Press E to eat berries' : 'Press E to fill water'; break;
    }
  }
  if (!msg && player.position.distanceTo(boatPos) < 3.5) {
    msg = G.wood >= CFG.woodGoal ? 'Press E to escape by boat' : `Need ${CFG.woodGoal} wood to free the boat`;
  }
  if (!msg && nearestTree(3.2) >= 0 && ITEMS[G.selected].key === 'axe') msg = 'Left-click to chop';
  dom.interact.textContent = msg;
  dom.interact.classList.toggle('show', !!msg);
}

// ---------------------------------------------------------------------------
// Pickup bob animation
// ---------------------------------------------------------------------------
function animatePickups() {
  const t = performance.now() * 0.003;
  for (const p of pickups) {
    p.mesh.position.y = (p.type === 'food' ? 0.5 : 0.4) + Math.sin(t + p.x) * 0.15;
    p.mesh.rotation.y += 0.02;
  }
}

// ---------------------------------------------------------------------------
// Win / Lose
// ---------------------------------------------------------------------------
function survivedSeconds() {
  return ((G.hour - CFG.startHour) / (CFG.dawnHour - CFG.startHour)) * CFG.nightLengthSec;
}
function endGame(title, cls, text) {
  G.running = false; G.over = true;
  document.exitPointerLock();
  dom.hud.classList.add('hidden');
  dom.endTitle.textContent = title;
  dom.endTitle.className = cls;
  dom.endText.textContent = text;
  const h = Math.floor(G.hour), m = Math.floor((G.hour - h) * 60);
  dom.endStats.textContent = `Reached ${h === 0 ? 12 : h}:${m.toString().padStart(2, '0')} AM · ` +
    `${G.wood} wood gathered · ${Math.round(survivedSeconds())}s survived`;
  dom.end.classList.remove('hidden');
}
function win(kind) {
  if (G.over) return;
  SFX.win(); SFX.setThreat(0);
  if (kind === 'escape') { G.escaped = true; endGame('YOU ESCAPED', 'win', `You levered the boat free and rowed out across the black water. The forest keeps its nights. You are not one of them. (Made it off on Night ${G.night}.)`); }
  else endGame('DAWN BREAKS', 'win', `The sky greys and the treeline softens. Whatever hunted you slips back into the dark. You survived Night ${G.night}.`);
}
function lose() {
  SFX.lose(); SFX.setThreat(0);
  endGame('YOU DIDN’T MAKE IT', 'lose', `The woods close over you. Night ${G.night} claims another. Try again — feed the fire, watch your bars, keep the light on it.`);
}

// ---------------------------------------------------------------------------
// Crafting
// ---------------------------------------------------------------------------
function renderRecipes() {
  dom.craftWood.textContent = G.wood;
  dom.recipes.innerHTML = '';
  for (const r of RECIPES) {
    const done = r.once && r.made;
    const afford = G.wood >= r.cost && !done;
    const card = document.createElement('div');
    card.className = 'recipe';
    card.innerHTML =
      `<div class="ricon">${r.icon}</div><div class="rname">${r.name}</div>` +
      `<div class="rdesc">${r.desc}</div>` +
      `<div class="rcost">${done ? 'crafted' : r.cost + ' 🪵'}</div>` +
      `<button ${afford ? '' : 'disabled'}>${done ? 'Owned' : 'Craft'}</button>`;
    card.querySelector('button').addEventListener('click', () => craftRecipe(r.id));
    dom.recipes.appendChild(card);
  }
}
function craftRecipe(id) {
  const r = RECIPES.find((x) => x.id === id);
  if (!r || G.wood < r.cost || (r.once && r.made)) return;
  G.wood -= r.cost;
  r.make();
  if (r.once) r.made = true;
  SFX.craft();
  refreshHotbar();
  renderRecipes();
  toast(`Crafted ${r.name}`, 1.4);
}
function toggleCrafting() {
  if (G.crafting) {
    G.crafting = false;
    dom.craft.classList.add('hidden');
    if (!G.over) { G.running = true; tryPointerLock(); }
  } else {
    if (G.over) return;
    G.crafting = true;
    G.running = false;               // pause the sim while the menu is open
    document.exitPointerLock();
    renderRecipes();
    dom.craft.classList.remove('hidden');
  }
}
document.getElementById('craftClose').addEventListener('click', toggleCrafting);
// clicking the CRAFTING menu icon opens it too
document.querySelectorAll('#menu .menu-item')[1].style.pointerEvents = 'auto';
document.querySelectorAll('#menu .menu-item')[1].addEventListener('click', () => { if (G.running || G.crafting) toggleCrafting(); });

// ---------------------------------------------------------------------------
// Multiplayer — remote players rendered as ghost avatars with nametags
// ---------------------------------------------------------------------------
const remotePlayers = new Map(); // id -> { group, tag, target:{x,z,ry} }

function makeRemoteAvatar(name) {
  const g = new THREE.Group();
  const shirt = new THREE.MeshStandardMaterial({ color: 0x2f6fb0, roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xd9a679, roughness: 0.9 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.9 });
  const hair = new THREE.MeshStandardMaterial({ color: 0x1c140e, roughness: 1 });
  function box(w, h, d, mat, y, z = 0) { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); b.position.set(0, y, z); b.castShadow = true; return b; }
  g.add(box(1.1, 1.3, 0.6, shirt, 1.5));
  g.add(box(0.85, 0.85, 0.85, skin, 2.55));
  g.add(box(0.9, 0.35, 0.9, hair, 2.95));
  g.add(box(0.4, 1.2, 0.4, pants, 0.6));
  const tag = document.createElement('div');
  tag.className = 'nametag';
  tag.textContent = name;
  document.body.appendChild(tag);
  scene.add(g);
  return { group: g, tag };
}
function addRemote(id, name) {
  if (remotePlayers.has(id)) return;
  const { group, tag } = makeRemoteAvatar(name || 'Wanderer');
  remotePlayers.set(id, { group, tag, target: { x: 0, z: 10, ry: 0 } });
  updatePeerCount();
}
function updateRemote(m) {
  let rp = remotePlayers.get(m.id);
  if (!rp) { addRemote(m.id, m.name); rp = remotePlayers.get(m.id); }
  rp.target.x = m.x; rp.target.z = m.z; rp.target.ry = m.ry;
}
function removeRemote(id) {
  const rp = remotePlayers.get(id);
  if (!rp) return;
  scene.remove(rp.group);
  rp.tag.remove();
  remotePlayers.delete(id);
  updatePeerCount();
}
function updatePeerCount() {
  if (!Net.connected) { dom.peers.textContent = ''; return; }
  const n = remotePlayers.size;
  dom.peers.textContent = `🟢 online · ${n + 1} in the woods`;
}
function animateRemotes(dt) {
  for (const rp of remotePlayers.values()) {
    // smooth toward last known state
    rp.group.position.x += (rp.target.x - rp.group.position.x) * Math.min(1, dt * 10);
    rp.group.position.z += (rp.target.z - rp.group.position.z) * Math.min(1, dt * 10);
    rp.group.rotation.y += (rp.target.ry - rp.group.rotation.y) * Math.min(1, dt * 10);
    // project nametag to screen
    const v = new THREE.Vector3(rp.group.position.x, 3.6, rp.group.position.z).project(camera);
    if (v.z > 1 || v.z < -1) { rp.tag.style.display = 'none'; continue; }
    rp.tag.style.display = 'block';
    rp.tag.style.left = (v.x * 0.5 + 0.5) * window.innerWidth + 'px';
    rp.tag.style.top = (-v.y * 0.5 + 0.5) * window.innerHeight + 'px';
  }
}
function connectMultiplayer() {
  const name = (document.getElementById('mpName').value || 'Wanderer').slice(0, 18);
  const url = document.getElementById('mpUrl').value.trim();
  if (!url) return;
  Net.connect(url, name,
    () => ({ x: player.position.x, z: player.position.z, ry: player.rotation.y, night: G.night }),
    {
      onWelcome: (m) => { m.peers.forEach((p) => addRemote(p.id, p.name)); updatePeerCount(); toast('Connected to the woods', 2); },
      onJoin: (m) => { addRemote(m.id, m.name); toast(`${m.name} entered the forest`, 2); },
      onState: (m) => updateRemote(m),
      onLeave: (m) => removeRemote(m.id),
      onClose: () => { for (const id of [...remotePlayers.keys()]) removeRemote(id); dom.peers.textContent = ''; },
      onError: () => toast('Multiplayer: could not reach server (playing solo)', 3),
    });
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------
function startGame() {
  // reset state
  G.running = true; G.over = false; G.crafting = false;
  G.hp = 100; G.hunger = 100; G.thirst = 100;
  G.hour = CFG.startHour; G.wood = 0; G.escaped = false;
  G.night = 99; G.spear = false; G.chasedNow = false; G.stepTimer = 0;
  G.yaw = 0; G.pitch = 0.15; G.velY = 0; G.onGround = true;
  G.flashlightOn = true; G.selected = 0;
  player.position.set(0, 0, 10); player.rotation.y = 0;
  // restore items + crafting one-shots
  itemByKey('medkit').count = 2;
  itemByKey('water').count = 2;
  itemByKey('torch').count = 1;
  RECIPES.forEach((r) => { if (r.once) r.made = false; });
  fireFuel = 100;
  resetCreatures(diff().creatureCount);
  buildHotbar();
  SFX.init();                        // audio needs this user gesture
  dom.start.classList.add('hidden');
  dom.pause.classList.add('hidden');
  dom.end.classList.add('hidden');
  dom.hud.classList.remove('hidden');
  // optional multiplayer
  if (document.getElementById('mpEnable').checked && !Net.connected) connectMultiplayer();
  updatePeerCount();
  showControlsCard(10);              // greet with the controls, fade after 10s
  tryPointerLock();
}
function pauseGame() {
  if (!G.running || G.over) return;
  G.running = false;
  SFX.suspend();
  document.exitPointerLock();
  dom.pause.classList.remove('hidden');
}
function resumeGame() {
  if (G.over) return;
  G.running = true;
  SFX.resume();
  dom.pause.classList.add('hidden');
  tryPointerLock();
}

document.getElementById('playBtn').addEventListener('click', startGame);
document.getElementById('resumeBtn').addEventListener('click', resumeGame);
document.getElementById('restartBtn').addEventListener('click', () => location.reload());
dom.muteBtn.addEventListener('click', toggleMute);
// multiplayer fields show/hide
const mpEnable = document.getElementById('mpEnable');
mpEnable.addEventListener('change', () => {
  document.getElementById('mpFields').classList.toggle('hidden', !mpEnable.checked);
});

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, clock.getDelta());

  animatePickups();
  updateLights(dt);

  if (G.running && !G.over) {
    movePlayer(dt);
    updateCreatures(dt);
    updateStats(dt);
    updateTime(dt);
    updateInteractPrompt();

    // toast timeout
    if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) dom.toast.classList.remove('show'); }
    // controls card auto-fade
    if (controlsCardTimer > 0) { controlsCardTimer -= dt; if (controlsCardTimer <= 0) hideControlsCard(); }
    // hurt vignette
    if (hurtFlash > 0) hurtFlash -= dt;
    dom.vignette.style.boxShadow = `inset 0 0 220px 40px rgba(150,0,0,${Math.max(0, hurtFlash) * 0.9})`;

    updateHUD();
  } else {
    SFX.setThreat(0);
  }

  updateCamera();
  if (Net.connected) animateRemotes(dt);
  renderer.render(scene, camera);
}
animate();

// start with the menu open, pointer free
console.log('%cNightfall Woods loaded. Click to play.', 'color:#8fa');
