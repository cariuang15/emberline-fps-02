// world.js — the Kestrel Yard map: bounds, cover, spike sites, spawns,
// the bot navigation graph, and every geometric query the sim needs
// (circle collision, line of sight, hitscan rays). Pure math, no DOM,
// no three.js: the Node sim tests import this file directly.
//
// Layout (metres, x east, z south; the yard is 64 x 48):
//   Vanguard spawns west, Sentinel east. Three lanes run west-east at
//   z = -18 (top), z = 0 (mid) and z = +18 (bottom). Site A "Foundry"
//   sits north-west, site B "Silo" south-east, so each site is reached
//   fast down one lane and slowly down the other two.

export const MAP = { halfW: 32, halfD: 24 };

// One obstacle: an axis-aligned box. x/z is the centre, hw/hd the half
// extents, h the height, kind drives the renderer's colour.
export const OBSTACLES = [
  // --- top lane cover ---
  { x: -22, z: -15, hw: 3, hd: 1.2, h: 2.6, kind: 'container', tint: 0 },
  { x: -10, z: -19.5, hw: 3, hd: 1.2, h: 2.6, kind: 'container', tint: 1 },
  { x: 2, z: -16, hw: 3, hd: 1.2, h: 2.6, kind: 'container', tint: 2 },
  { x: 14, z: -19, hw: 3, hd: 1.2, h: 2.6, kind: 'container', tint: 0 },
  { x: 22, z: -14, hw: 3, hd: 1.2, h: 2.6, kind: 'container', tint: 1 },
  // --- mid lane cover ---
  { x: -24, z: 2, hw: 3, hd: 1.2, h: 2.6, kind: 'container', tint: 2 },
  { x: -6, z: 3, hw: 3, hd: 1.2, h: 2.6, kind: 'container', tint: 0 },
  { x: 6, z: -3, hw: 3, hd: 1.2, h: 2.6, kind: 'container', tint: 1 },
  { x: 20, z: 1, hw: 3, hd: 1.2, h: 2.6, kind: 'container', tint: 2 },
  // --- bottom lane cover ---
  { x: -22, z: 15, hw: 3, hd: 1.2, h: 2.6, kind: 'container', tint: 1 },
  { x: -8, z: 19.5, hw: 3, hd: 1.2, h: 2.6, kind: 'container', tint: 0 },
  { x: 4, z: 16, hw: 3, hd: 1.2, h: 2.6, kind: 'container', tint: 2 },
  { x: 16, z: 19, hw: 3, hd: 1.2, h: 2.6, kind: 'container', tint: 1 },
  { x: 24, z: 14, hw: 3, hd: 1.2, h: 2.6, kind: 'container', tint: 0 },
  // --- crates: low cover you can shoot over when crouched behind nothing ---
  { x: -14, z: -8, hw: 0.7, hd: 0.7, h: 1.2, kind: 'crate', tint: 0 },
  { x: -2, z: -8, hw: 0.7, hd: 0.7, h: 1.2, kind: 'crate', tint: 0 },
  { x: 10, z: -10, hw: 0.7, hd: 0.7, h: 1.2, kind: 'crate', tint: 0 },
  { x: -16, z: 8, hw: 0.7, hd: 0.7, h: 1.2, kind: 'crate', tint: 0 },
  { x: 0, z: 10, hw: 0.7, hd: 0.7, h: 1.2, kind: 'crate', tint: 0 },
  { x: 12, z: 8, hw: 0.7, hd: 0.7, h: 1.2, kind: 'crate', tint: 0 },
  { x: -26, z: -10, hw: 0.7, hd: 0.7, h: 1.2, kind: 'crate', tint: 0 },
  { x: 26, z: 10, hw: 0.7, hd: 0.7, h: 1.2, kind: 'crate', tint: 0 },
  // --- site furniture: low barriers at the sites, silo towers in corners ---
  { x: -12, z: -16.5, hw: 2, hd: 0.5, h: 1.1, kind: 'barrier', tint: 0 },
  { x: -20, z: -9, hw: 0.5, hd: 2, h: 1.1, kind: 'barrier', tint: 0 },
  { x: 12, z: 16.5, hw: 2, hd: 0.5, h: 1.1, kind: 'barrier', tint: 0 },
  { x: 20, z: 9, hw: 0.5, hd: 2, h: 1.1, kind: 'barrier', tint: 0 },
  { x: -24, z: -20, hw: 1.8, hd: 1.8, h: 7, kind: 'silo', tint: 0 },
  { x: 24, z: 20, hw: 1.8, hd: 1.8, h: 7, kind: 'silo', tint: 0 },
  // --- mid-yard pillars break the long sightline down the middle ---
  { x: -2, z: -4, hw: 0.9, hd: 0.9, h: 4.5, kind: 'pillar', tint: 0 },
  { x: 3, z: 5, hw: 0.9, hd: 0.9, h: 4.5, kind: 'pillar', tint: 0 },
];

export const SITES = {
  A: { id: 'A', name: 'Foundry', x: -16, z: -13, r: 4.5 },
  B: { id: 'B', name: 'Silo', x: 16, z: 13, r: 4.5 },
};

// Spawn points, west for Vanguard (attackers), east for Sentinel.
export const SPAWNS = {
  v: [
    { x: -28, z: -6, yaw: -Math.PI / 2 },
    { x: -28, z: 0, yaw: -Math.PI / 2 },
    { x: -28, z: 6, yaw: -Math.PI / 2 },
    { x: -26, z: -2, yaw: -Math.PI / 2 },
  ],
  s: [
    { x: 28, z: -6, yaw: Math.PI / 2 },
    { x: 28, z: 0, yaw: Math.PI / 2 },
    { x: 28, z: 6, yaw: Math.PI / 2 },
    { x: 26, z: 2, yaw: Math.PI / 2 },
  ],
};

export const PLAYER_RADIUS = 0.42;
export const FIGHTER_RADIUS = 0.45;

// ---------------------------------------------------------------------------
// Navigation graph
// ---------------------------------------------------------------------------
// Nodes on a 7 x 3 lane grid plus one node per site and one per spawn
// area. Edges join nodes whose straight segment is clear of obstacles
// and shorter than 13 m, so bots can always walk a lane and cut between
// lanes at the three cross streets (x = -20, 0, 20).

function nodeClear(x, z, margin) {
  if (Math.abs(x) > MAP.halfW - margin || Math.abs(z) > MAP.halfD - margin) return false;
  for (const o of OBSTACLES) {
    if (Math.abs(x - o.x) < o.hw + margin && Math.abs(z - o.z) < o.hd + margin) return false;
  }
  return true;
}

function buildNav() {
  const nodes = [];
  const xs = [-28, -20, -10, 0, 10, 20, 28];
  // Five rows: three lanes plus a cross street between each pair, so bots
  // can cut between lanes instead of being trapped in one row.
  const zs = [-18, -9, 0, 9, 18];
  for (const z of zs) {
    for (const x of xs) {
      if (nodeClear(x, z, 0.9)) nodes.push({ x, z, lane: z === -18 ? 'top' : z === 0 ? 'mid' : 'bottom' });
    }
  }
  nodes.push({ x: SITES.A.x, z: SITES.A.z, lane: 'siteA' });
  nodes.push({ x: SITES.B.x, z: SITES.B.z, lane: 'siteB' });
  nodes.push({ x: -28, z: 0, lane: 'spawnV' });
  nodes.push({ x: 28, z: 0, lane: 'spawnS' });
  // Keep node order stable: sort by lane row then x, sites last.
  const edges = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d > 13.5) continue;
      if (segmentBlocked(a.x, a.z, b.x, b.z)) continue;
      edges.push([i, j]);
    }
  }
  return { nodes, edges };
}

export const NAV = buildNav();

/** Index of the nav node nearest to (x, z). */
export function nearestNode(x, z) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < NAV.nodes.length; i++) {
    const n = NAV.nodes[i];
    const d = (n.x - x) * (n.x - x) + (n.z - z) * (n.z - z);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** A* over the nav graph. Returns an array of node indices, start to goal. */
export function findPath(fromIdx, toIdx) {
  if (fromIdx === toIdx) return [fromIdx];
  const adj = new Map();
  for (const [a, b] of NAV.edges) {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(b);
    adj.get(b).push(a);
  }
  const open = [{ idx: fromIdx, f: 0 }];
  const came = new Map();
  const gScore = new Map([[fromIdx, 0]]);
  const closed = new Set();
  const h = (i) => {
    const n = NAV.nodes[i];
    const t = NAV.nodes[toIdx];
    return Math.hypot(n.x - t.x, n.z - t.z);
  };
  while (open.length > 0) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0].idx;
    if (cur === toIdx) {
      const path = [cur];
      let c = cur;
      while (came.has(c)) {
        c = came.get(c);
        path.unshift(c);
      }
      return path;
    }
    if (closed.has(cur)) continue;
    closed.add(cur);
    for (const nb of adj.get(cur) ?? []) {
      if (closed.has(nb)) continue;
      const a = NAV.nodes[cur];
      const b = NAV.nodes[nb];
      const ng = (gScore.get(cur) ?? Infinity) + Math.hypot(a.x - b.x, a.z - b.z);
      if (ng < (gScore.get(nb) ?? Infinity)) {
        gScore.set(nb, ng);
        came.set(nb, cur);
        open.push({ idx: nb, f: ng + h(nb) });
      }
    }
  }
  return [fromIdx, toIdx];
}

// ---------------------------------------------------------------------------
// Collision and sight
// ---------------------------------------------------------------------------

function circleHitsObstacle(x, z, r) {
  for (const o of OBSTACLES) {
    const cx = Math.max(o.x - o.hw, Math.min(x, o.x + o.hw));
    const cz = Math.max(o.z - o.hd, Math.min(z, o.z + o.hd));
    const dx = x - cx;
    const dz = z - cz;
    if (dx * dx + dz * dz < r * r) return o;
  }
  return null;
}

/**
 * Move a circle of radius `r` from (x, z) by (dx, dz), sliding along
 * obstacles axis by axis. Returns the new position.
 */
export function collideMove(x, z, r, dx, dz) {
  let nx = x + dx;
  if (Math.abs(nx) > MAP.halfW - r) nx = Math.sign(nx) * (MAP.halfW - r);
  if (circleHitsObstacle(nx, z, r)) nx = x;
  let nz = z + dz;
  if (Math.abs(nz) > MAP.halfD - r) nz = Math.sign(nz) * (MAP.halfD - r);
  if (circleHitsObstacle(nx, nz, r)) nz = z;
  return { x: nx, z: nz };
}

/** True when the point is inside any obstacle (with a margin). */
export function pointBlocked(x, z, margin = 0) {
  for (const o of OBSTACLES) {
    if (Math.abs(x - o.x) < o.hw + margin && Math.abs(z - o.z) < o.hd + margin) return true;
  }
  return false;
}

// 2D slab test: does segment (x1,z1)-(x2,z2) cross an obstacle box?
function segmentHitsBox(x1, z1, x2, z2, o) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  let tmin = 0;
  let tmax = 1;
  for (const [p, d, lo, hi] of [
    [x1, dx, o.x - o.hw, o.x + o.hw],
    [z1, dz, o.z - o.hd, o.z + o.hd],
  ]) {
    if (Math.abs(d) < 1e-9) {
      if (p < lo || p > hi) return false;
    } else {
      let t1 = (lo - p) / d;
      let t2 = (hi - p) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return false;
    }
  }
  return true;
}

/** True when any obstacle blocks the straight segment. */
export function segmentBlocked(x1, z1, x2, z2) {
  for (const o of OBSTACLES) {
    if (segmentHitsBox(x1, z1, x2, z2, o)) return true;
  }
  return false;
}

/**
 * Ray from (x, z) along unit (dx, dz). Returns the distance to the nearest
 * obstacle face, or null when nothing is hit within maxD.
 */
export function rayObstacle(x, z, dx, dz, maxD) {
  let best = null;
  for (const o of OBSTACLES) {
    const hit = rayBox(x, z, dx, dz, o);
    if (hit !== null && hit <= maxD && (best === null || hit < best)) best = hit;
  }
  return best;
}

function rayBox(x, z, dx, dz, o) {
  let tmin = 0;
  let tmax = Infinity;
  for (const [p, d, lo, hi] of [
    [x, dx, o.x - o.hw, o.x + o.hw],
    [z, dz, o.z - o.hd, o.z + o.hd],
  ]) {
    if (Math.abs(d) < 1e-9) {
      if (p < lo || p > hi) return null;
    } else {
      let t1 = (lo - p) / d;
      let t2 = (hi - p) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}

/** Does the segment cross a circle (used for smoke blocking sight)? */
export function segmentHitsCircle(x1, z1, x2, z2, cx, cz, r) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const len2 = dx * dx + dz * dz;
  let t = len2 === 0 ? 0 : ((cx - x1) * dx + (cz - z1) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  const px = x1 + dx * t;
  const pz = z1 + dz * t;
  const ddx = px - cx;
  const ddz = pz - cz;
  return ddx * ddx + ddz * ddz < r * r;
}

export function siteById(id) {
  return SITES[id] ?? null;
}

export function pointInSite(x, z, site) {
  const dx = x - site.x;
  const dz = z - site.z;
  return dx * dx + dz * dz <= site.r * site.r;
}

/** Which site (if any) contains the point. */
export function siteAt(x, z) {
  for (const s of Object.values(SITES)) {
    if (pointInSite(x, z, s)) return s;
  }
  return null;
}
