// sim.js — the match simulation: fixed-step 60 Hz, fully deterministic.
// No DOM, no three.js, no Date.now, no Math.random: every random choice
// comes from the match's seeded rng, so two matches with the same seed and
// the same inputs produce byte-identical snapshots. The browser renders
// this state; the Node tests drive it headlessly.
//
// Round flow: buy (12 s) -> live (100 s) -> post (4 s) -> next round.
// Vanguard (attackers) win a round by eliminating Sentinel, or by planting
// the spike and letting its 35 s fuse run out. Sentinel win by eliminating
// Vanguard, by running the clock out with no plant, or by defusing.
// First to 5 rounds wins the match (at most 9 rounds).

import { mulberry32, clamp, dist2, r4, angleDiff, turnToward } from './util.js';
import { SPAWNS, SITES, NAV, nearestNode, segmentBlocked, rayObstacle, collideMove, pointInSite, siteAt, PLAYER_RADIUS, FIGHTER_RADIUS } from './world.js';
import { WEAPONS, GRENADE_DEFS, ECON, weapon, shotInterval, damageAtRange } from './weapons.js';
import { makeFighter, resetForRound, applyDamage, buyItem, currentWeaponDef, EYE_STAND, EYE_CROUCH, BODY_HEIGHT, BODY_CROUCH_HEIGHT } from './fighters.js';
import { createBrain, botInput, resetBrain } from './bots.js';

export const TICK = 1 / 60;
export const BUY_SEC = 12;
export const ROUND_SEC = 100;
export const PLANT_SEC = 3.5;
export const FUSE_SEC = 35;
export const DEFUSE_SEC = 6;
export const FIRST_TO = 5;
export const MAX_ROUNDS = 9;

const VANGUARD_NAMES = ['Bara', 'Kala', 'Sena'];
const SENTINEL_NAMES = ['Raka', 'Damar', 'Gilang', 'Tara'];
const WALK_SPEED = 4.3;
const CROUCH_SPEED = 1.9;
const SLOW_SPEED = 2.3;
const AIM_SPEED = 2.6;
const ACCEL = 42;

function emptyInput() {
  return { f: false, b: false, l: false, r: false, crouch: false, walk: false, aim: false, fire: false, firePressed: false, reload: false, use: false, yawDelta: 0, pitchDelta: 0, yawAbs: null, pitchAbs: null, slot: 0, grenade: null };
}

export function createMatch(seed, opts = {}) {
  const rng = mulberry32(seed >>> 0);
  const playerIsBot = opts.playerIsBot === true;
  const fighters = [];
  const brains = new Map();
  // Vanguard: slot 0 is the human player (or a bot in bot-only matches).
  const vSpawns = SPAWNS.v;
  fighters.push(makeFighter(0, 'v', 'You', playerIsBot, vSpawns[0]));
  for (let i = 0; i < 3; i++) {
    const f = makeFighter(1 + i, 'v', VANGUARD_NAMES[i], true, vSpawns[(i + 1) % vSpawns.length]);
    fighters.push(f);
  }
  for (let i = 0; i < 4; i++) {
    const f = makeFighter(4 + i, 's', SENTINEL_NAMES[i], true, SPAWNS.s[i]);
    fighters.push(f);
  }
  for (const f of fighters) {
    if (f.bot) brains.set(f.id, createBrain(f, rng));
  }
  const m = {
    seed: seed >>> 0,
    rng,
    tick: 0,
    time: 0,
    phase: 'buy',
    phaseT: BUY_SEC,
    round: 1,
    score: { v: 0, s: 0 },
    roundWinner: null,
    matchWinner: null,
    spike: { state: 'carried', x: 0, z: 0, carrierId: fighters[0].id, siteId: null, fuseT: 0 },
    fighters,
    brains,
    grenades: [],
    smokes: [],
    tracers: [],
    noises: [],
    events: [],
    lastHit: null,
    playerId: fighters[0].id,
    playerIsBot,
    botSkill: opts.botSkill ?? 1,
  };
  fighters[0].hasSpike = true;
  startRoundBuys(m);
  pushEvent(m, 'info', 'Round 1 — buy phase. Press B to buy, E plants the spike.');
  return m;
}

/** Bots spend their money at the start of a round (deterministic policy). */
function startRoundBuys(m) {
  for (const f of m.fighters) {
    if (!f.bot || !f.alive) continue;
    const rng = m.rng;
    if (f.money >= 2600 && m.round >= 3 && rng() < 0.3) buyItem(f, 'longshot');
    else if (f.money >= 1700) buyItem(f, 'vk47');
    else if (f.money >= 900) buyItem(f, 'mp9');
    if (f.money >= 650) buyItem(f, 'kevlar');
    if (f.money >= 300 && rng() < 0.5) buyItem(f, 'frag');
    if (f.money >= 250 && rng() < 0.4) buyItem(f, 'smoke');
  }
}

function pushEvent(m, type, text, extra = {}) {
  m.events.push({ tick: m.tick, type, text, ...extra });
  if (m.events.length > 40) m.events.shift();
}

function aliveOf(m, team) {
  return m.fighters.filter((f) => f.team === team && f.alive);
}

function fighterById(m, id) {
  return m.fighters.find((f) => f.id === id) ?? null;
}

function startRound(m) {
  m.round += 1;
  m.phase = 'buy';
  m.phaseT = BUY_SEC;
  m.roundWinner = null;
  m.spike = { state: 'carried', x: 0, z: 0, carrierId: m.playerId, siteId: null, fuseT: 0 };
  m.grenades = [];
  m.smokes = [];
  m.tracers = [];
  const vSpawns = SPAWNS.v;
  const sSpawns = SPAWNS.s;
  let vi = 0;
  let si = 0;
  for (const f of m.fighters) {
    resetForRound(f, f.team === 'v' ? vSpawns[vi++ % vSpawns.length] : sSpawns[si++ % sSpawns.length]);
    const brain = m.brains.get(f.id);
    if (brain) resetBrain(brain, m);
  }
  const carrier = fighterById(m, m.playerId);
  if (carrier && carrier.alive) {
    carrier.hasSpike = true;
    m.spike.carrierId = carrier.id;
  }
  startRoundBuys(m);
  pushEvent(m, 'info', `Round ${m.round} — buy phase.`);
}

function endRound(m, winner) {
  m.score[winner] += 1;
  m.roundWinner = winner;
  for (const f of m.fighters) {
    f.money += f.team === winner ? ECON.roundWin : ECON.roundLoss;
  }
  const name = winner === 'v' ? 'Vanguard' : 'Sentinel';
  pushEvent(m, 'round', `${name} take round ${m.round}.`, { winner });
  if (m.score[winner] >= FIRST_TO || m.round >= MAX_ROUNDS) {
    m.matchWinner = winner;
    m.phase = 'post';
    m.phaseT = 5;
  } else {
    m.phase = 'post';
    m.phaseT = 4;
  }
}

/** Buy through the match (only during the buy phase). */
export function buyItemMatch(m, fighterId, itemId) {
  if (m.phase !== 'buy') return false;
  const f = fighterById(m, fighterId);
  if (!f) return false;
  return buyItem(f, itemId);
}

/**
 * Throw a grenade from a fighter toward where they are aiming. Bots call
 * this after turning toward their target; the player throws with G.
 */
export function throwGrenade(m, f, kind, tx, tz) {
  const def = GRENADE_DEFS[kind];
  if (!def || f.grenades[kind] <= 0) return false;
  f.grenades[kind] -= 1;
  const eye = f.crouched ? EYE_CROUCH : EYE_STAND;
  const dx = tx - f.x;
  const dz = tz - f.z;
  const d = Math.hypot(dx, dz) || 1;
  // Lob it so it lands on the target: pick a flight time from the range,
  // then solve the ballistic arc (the sim's gravity is 12 m/s^2).
  const T = clamp(d / 9, 0.45, 1.2);
  m.grenades.push({
    kind,
    x: f.x,
    z: f.z,
    y: eye,
    vx: dx / T,
    vy: (6 * T * T - eye) / T,
    vz: dz / T,
    fuseT: def.fuseSec,
    ownerId: f.id,
  });
  return true;
}

function explodeFrag(m, g) {
  const def = GRENADE_DEFS.frag;
  pushEvent(m, 'info', 'Frag detonates.');
  m.noises.push({ x: g.x, z: g.z, r: 34, until: m.time + 1.5 });
  for (const f of m.fighters) {
    if (!f.alive) continue;
    const d = dist2(f.x, f.z, g.x, g.z);
    if (d > def.radius) continue;
    if (segmentBlocked(f.x, f.z, g.x, g.z)) continue;
    const dmg = def.damage * (1 - (0.6 * d) / def.radius);
    const res = applyDamage(f, dmg, true);
    if (res.died) {
      const owner = fighterById(m, g.ownerId);
      if (owner && owner.id !== f.id) {
        owner.kills += 1;
        owner.money += ECON.kill;
      }
      f.deaths += 1;
      pushEvent(m, 'kill', `${owner ? owner.name : 'Frag'} 💥 ${f.name}`, { killer: owner?.id, victim: f.id, weapon: 'frag' });
      if (f.hasSpike) dropSpike(m, f);
    }
  }
}

function dropSpike(m, f) {
  f.hasSpike = false;
  m.spike.state = 'dropped';
  m.spike.x = f.x;
  m.spike.z = f.z;
  m.spike.carrierId = null;
  pushEvent(m, 'info', 'The spike is down.');
}

/** One hitscan shot. Returns the fighter hit, or null. */
function fireShot(m, f) {
  const w = currentWeaponDef(f);
  const ammo = f.ammo[w.id];
  if (!ammo || ammo.mag <= 0) return null;
  ammo.mag -= 1;
  f.fireCooldown = shotInterval(w);
  f.lastShotTick = m.tick;
  f.flashT = 0.06;
  f.spray = Math.min(f.spray + 1, 12);
  f.sprayT = 0.6;
  f.recoil = Math.min(f.recoil + (w.recoilDeg * Math.PI) / 180, 0.12);
  m.noises.push({ x: f.x, z: f.z, r: 30, until: m.time + 1.2 });

  const speedFrac = clamp(f.speed / WALK_SPEED, 0, 1);
  let spreadDeg = w.spreadDeg + speedFrac * w.moveSpreadDeg + f.spray * 0.22;
  if (w.id === 'longshot' && f.aiming) spreadDeg = w.scopedSpreadDeg;
  if (f.crouched) spreadDeg *= 0.7;
  const spread = (spreadDeg * Math.PI) / 180;
  const g1 = (m.rng() + m.rng() + m.rng() - 1.5) * 0.66;
  const g2 = (m.rng() + m.rng() + m.rng() - 1.5) * 0.66;
  const yaw = f.yaw + g1 * spread;
  const pitch = f.pitch + f.recoil + g2 * spread;
  const dx = -Math.sin(yaw);
  const dz = -Math.cos(yaw);
  const eye = f.crouched ? EYE_CROUCH : EYE_STAND;
  const wallD = rayObstacle(f.x, f.z, dx, dz, w.range);
  const maxD = wallD === null ? w.range : wallD;

  let best = null;
  let bestT = maxD;
  for (const t of m.fighters) {
    if (!t.alive || t.id === f.id || t.team === f.team) continue;
    // 2D ray vs circle.
    const ox = f.x - t.x;
    const oz = f.z - t.z;
    const b = ox * dx + oz * dz;
    const c = ox * ox + oz * oz - FIGHTER_RADIUS * FIGHTER_RADIUS;
    const disc = b * b - c;
    if (disc < 0) continue;
    const tHit = -b - Math.sqrt(disc);
    if (tHit <= 0.05 || tHit >= bestT) continue;
    const y = eye + Math.tan(pitch) * tHit;
    const bodyH = t.crouched ? BODY_CROUCH_HEIGHT : BODY_HEIGHT;
    if (y < 0 || y > bodyH) continue;
    const headBottom = t.crouched ? 0.95 : 1.42;
    best = { target: t, t: tHit, head: y >= headBottom };
    bestT = tHit;
  }
  const endX = f.x + dx * bestT;
  const endZ = f.z + dz * bestT;
  const endY = eye + Math.tan(pitch) * bestT;
  m.tracers.push({ x1: f.x, y1: eye, z1: f.z, x2: endX, y2: endY, z2: endZ, until: m.time + 0.14 });
  if (m.tracers.length > 24) m.tracers.shift();

  if (!best) return null;
  const dmg = damageAtRange(w, best.t, best.head);
  const res = applyDamage(best.target, dmg);
  m.lastHit = { shooterId: f.id, victimId: best.target.id, tick: m.tick, kill: res.died, head: best.head };
  if (res.died) {
    f.kills += 1;
    f.money += ECON.kill;
    best.target.deaths += 1;
    pushEvent(m, 'kill', `${f.name} ${best.head ? '◉' : '▸'} ${best.target.name}`, { killer: f.id, victim: best.target.id, weapon: w.id, head: best.head });
    if (best.target.hasSpike) dropSpike(m, best.target);
  }
  return best;
}

function stepFighter(m, f, input, dt) {
  if (!f.alive) return;
  // --- look ---
  if (input.yawAbs !== null && input.yawAbs !== undefined) {
    f.yaw = turnToward(f.yaw, input.yawAbs, 6 * dt);
  } else if (input.yawDelta) {
    f.yaw += input.yawDelta;
  }
  if (input.pitchAbs !== null && input.pitchAbs !== undefined) {
    f.pitch = clamp(input.pitchAbs, -1.5, 1.5);
  } else if (input.pitchDelta) {
    f.pitch = clamp(f.pitch + input.pitchDelta, -1.5, 1.5);
  }
  f.recoil = Math.max(0, f.recoil - (0.14 * dt));
  f.crouched = !!input.crouch;
  f.aiming = !!input.aim;
  f.flashT = Math.max(0, f.flashT - dt);
  f.fireCooldown = Math.max(0, f.fireCooldown - dt);
  f.sprayT -= dt;
  if (f.sprayT <= 0) f.spray = 0;

  // --- move: acceleration toward the wish velocity, then slide ---
  const w = currentWeaponDef(f);
  let speed = WALK_SPEED;
  if (f.crouched) speed = CROUCH_SPEED;
  else if (input.walk) speed = SLOW_SPEED;
  else if (f.aiming) speed = AIM_SPEED;
  let mx = 0;
  let mz = 0;
  if (input.f) { mx += -Math.sin(f.yaw); mz += -Math.cos(f.yaw); }
  if (input.b) { mx += Math.sin(f.yaw); mz += Math.cos(f.yaw); }
  if (input.r) { mx += Math.cos(f.yaw); mz += -Math.sin(f.yaw); }
  if (input.l) { mx += -Math.cos(f.yaw); mz += Math.sin(f.yaw); }
  const ml = Math.hypot(mx, mz);
  if (ml > 0) { mx = (mx / ml) * speed; mz = (mz / ml) * speed; }
  const k = 1 - Math.exp(-ACCEL * dt * 0.12);
  f.vx += (mx - f.vx) * Math.min(1, k * 8);
  f.vz += (mz - f.vz) * Math.min(1, k * 8);
  const moved = collideMove(f.x, f.z, PLAYER_RADIUS, f.vx * dt, f.vz * dt);
  f.x = moved.x;
  f.z = moved.z;
  f.speed = Math.hypot(f.vx, f.vz);
  f.moving = f.speed > 0.5;

  // --- reload ---
  if (f.reloading) {
    f.reloadT -= dt;
    if (f.reloadT <= 0) {
      f.reloading = false;
      const ammo = f.ammo[w.id];
      if (ammo) {
        const need = w.mag - ammo.mag;
        const take = Math.min(need, ammo.reserve);
        ammo.mag += take;
        ammo.reserve -= take;
      }
    }
  } else if (input.reload) {
    const ammo = f.ammo[w.id];
    if (ammo && ammo.mag < w.mag && ammo.reserve > 0) {
      f.reloading = true;
      f.reloadT = w.reloadSec;
    }
  }

  // --- weapon switch ---
  if (input.slot === 1 && f.primary) f.slot = 'primary';
  if (input.slot === 2) f.slot = 'secondary';

  // --- fire (live phase only; the buy phase is for moving and buying) ---
  if (m.phase === 'live' && !f.reloading && f.fireCooldown <= 0) {
    const ammo = f.ammo[w.id];
    if (ammo && ammo.mag > 0) {
      if (w.auto ? input.fire : input.firePressed) fireShot(m, f);
    } else if ((w.auto ? input.fire : input.firePressed) && ammo && ammo.mag === 0) {
      // Dry fire nudges an auto reload.
      if (ammo.reserve > 0) {
        f.reloading = true;
        f.reloadT = w.reloadSec;
      }
    }
  }

  // --- grenade ---
  if (m.phase === 'live' && input.grenade) {
    const kind = input.grenade;
    if (f.grenades[kind] > 0) {
      const reach = 18;
      const tx = f.x + -Math.sin(f.yaw) * reach;
      const tz = f.z + -Math.cos(f.yaw) * reach;
      throwGrenade(m, f, kind, tx, tz);
    }
  }

  // --- spike: pick up a dropped spike ---
  if (f.team === 'v' && m.spike.state === 'dropped') {
    if (dist2(f.x, f.z, m.spike.x, m.spike.z) < 1.3) {
      f.hasSpike = true;
      m.spike.state = 'carried';
      m.spike.carrierId = f.id;
      pushEvent(m, 'info', `${f.name} picks up the spike.`);
    }
  }

  // --- plant / defuse while holding E ---
  if (m.phase === 'live') {
    if (f.hasSpike && m.spike.state === 'carried') {
      const site = siteAt(f.x, f.z);
      if (site && input.use && !f.moving) {
        f.plantT += dt;
        if (f.plantT >= PLANT_SEC) {
          f.plantT = 0;
          f.hasSpike = false;
          f.plants += 1;
          f.money += ECON.plant;
          m.spike.state = 'planted';
          m.spike.siteId = site.id;
          m.spike.x = f.x;
          m.spike.z = f.z;
          m.spike.fuseT = FUSE_SEC;
          m.spike.carrierId = null;
          pushEvent(m, 'plant', `${f.name} plants the spike at ${site.name}!`, { site: site.id });
          m.noises.push({ x: f.x, z: f.z, r: 40, until: m.time + 2 });
        }
      } else {
        f.plantT = Math.max(0, f.plantT - dt * 2);
      }
    }
    if (f.team === 's' && m.spike.state === 'planted') {
      const d = dist2(f.x, f.z, m.spike.x, m.spike.z);
      if (d < 1.6 && input.use) {
        f.defuseT += dt;
        if (f.defuseT >= DEFUSE_SEC) {
          f.defuseT = 0;
          f.defuses += 1;
          pushEvent(m, 'defuse', `${f.name} defuses the spike!`);
          endRound(m, 's');
          return;
        }
      } else {
        f.defuseT = Math.max(0, f.defuseT - dt * 2);
      }
    }
  }
}

function stepGrenades(m, dt) {
  for (let i = m.grenades.length - 1; i >= 0; i--) {
    const g = m.grenades[i];
    g.fuseT -= dt;
    g.vy -= 12 * dt;
    let nx = g.x + g.vx * dt;
    let nz = g.z + g.vz * dt;
    let ny = g.y + g.vy * dt;
    if (Math.abs(nx) > 31.5 || Math.abs(nz) > 23.5) {
      nx = g.x;
      nz = g.z;
      g.vx *= -0.4;
      g.vz *= -0.4;
    }
    if (ny < 0) {
      ny = 0;
      g.vy = Math.abs(g.vy) > 2 ? -g.vy * 0.25 : 0;
      g.vx *= 0.35;
      g.vz *= 0.35;
    }
    g.x = nx;
    g.z = nz;
    g.y = ny;
    if (g.fuseT <= 0) {
      m.grenades.splice(i, 1);
      if (g.kind === 'frag') explodeFrag(m, g);
      else {
        m.smokes.push({ x: g.x, z: g.z, r: GRENADE_DEFS.smoke.radius, until: m.time + GRENADE_DEFS.smoke.durationSec });
        pushEvent(m, 'info', 'Smoke covers the yard.');
      }
    }
  }
}

/** Advance the match one fixed tick. `playerInput` drives the human. */
export function stepMatch(m, playerInput) {
  if (m.phase === 'over') return;
  const dt = TICK;
  m.tick += 1;
  m.time += dt;

  // --- phase timers ---
  if (m.phase === 'buy') {
    m.phaseT -= dt;
    if (m.phaseT <= 0) {
      m.phase = 'live';
      m.phaseT = ROUND_SEC;
      pushEvent(m, 'info', `Round ${m.round} is live.`);
    }
  } else if (m.phase === 'live') {
    if (m.spike.state === 'planted') {
      m.spike.fuseT -= dt;
      if (m.spike.fuseT <= 0) {
        pushEvent(m, 'explode', 'The spike detonates!');
        endRound(m, 'v');
        return;
      }
    } else {
      m.phaseT -= dt;
      if (m.phaseT <= 0) {
        pushEvent(m, 'info', 'Time expires — Sentinel hold the yard.');
        endRound(m, 's');
        return;
      }
    }
  } else if (m.phase === 'post') {
    m.phaseT -= dt;
    if (m.phaseT <= 0) {
      if (m.matchWinner) {
        m.phase = 'over';
      } else {
        startRound(m);
      }
      return;
    }
  }

  // --- fighters ---
  const inputs = new Map();
  for (const f of m.fighters) {
    if (f.bot) {
      const brain = m.brains.get(f.id);
      inputs.set(f.id, brain ? botInput(m, f, brain, dt) : emptyInput());
    } else {
      inputs.set(f.id, playerInput ?? emptyInput());
    }
  }
  for (const f of m.fighters) {
    stepFighter(m, f, inputs.get(f.id), dt);
    if (m.phase !== 'live' && m.phase !== 'buy') return;
  }

  stepGrenades(m, dt);

  // --- expiry ---
  m.smokes = m.smokes.filter((s) => s.until > m.time);
  m.tracers = m.tracers.filter((t) => t.until > m.time);
  m.noises = m.noises.filter((n) => n.until > m.time);

  // --- round end by elimination ---
  if (m.phase === 'live') {
    const vAlive = aliveOf(m, 'v').length;
    const sAlive = aliveOf(m, 's').length;
    if (m.spike.state === 'planted') {
      if (sAlive === 0) endRound(m, 'v');
      // Vanguard all dead with a planted spike: the round plays on until
      // the fuse blows or Sentinel defuse it.
    } else {
      if (vAlive === 0 && sAlive > 0) endRound(m, 's');
      else if (sAlive === 0 && vAlive > 0) endRound(m, 'v');
    }
  }
}

/** Deterministic snapshot string: two identical runs match byte for byte. */
export function snapshot(m) {
  const parts = [
    `tick=${m.tick}`,
    `phase=${m.phase}`,
    `phaseT=${r4(m.phaseT)}`,
    `round=${m.round}`,
    `score=${m.score.v}-${m.score.s}`,
    `spike=${m.spike.state}:${m.spike.siteId ?? '-'}:${r4(m.spike.x)},${r4(m.spike.z)}:${r4(m.spike.fuseT)}`,
  ];
  for (const f of m.fighters) {
    const ammo = Object.entries(f.ammo).map(([k, a]) => `${k}:${a.mag}/${a.reserve}`).join(',');
    parts.push(
      `f${f.id}=${f.team}:${r4(f.x)},${r4(f.z)}:${r4(f.yaw)}:hp${Math.round(f.hp)}:a${Math.round(f.armor)}:${f.alive ? 1 : 0}:$${f.money}:k${f.kills}:d${f.deaths}:${f.primary ?? '-'}:${f.slot}:${ammo}:g${f.grenades.frag}/${f.grenades.smoke}:sp${f.hasSpike ? 1 : 0}`,
    );
  }
  parts.push(`gren=${m.grenades.map((g) => `${g.kind}:${r4(g.x)},${r4(g.z)},${r4(g.y)}`).join(';')}`);
  parts.push(`smoke=${m.smokes.length}`);
  return parts.join('|');
}

/** Small public summary for the HUD and the tests. */
export function matchSummary(m) {
  return {
    phase: m.phase,
    phaseT: m.phaseT,
    round: m.round,
    score: { ...m.score },
    matchWinner: m.matchWinner,
    roundWinner: m.roundWinner,
    spike: { ...m.spike },
    tick: m.tick,
    fighters: m.fighters.map((f) => ({
      id: f.id, team: f.team, name: f.name, bot: f.bot,
      x: f.x, z: f.z, yaw: f.yaw, hp: f.hp, armor: f.armor, alive: f.alive,
      money: f.money, kills: f.kills, deaths: f.deaths,
      weapon: currentWeaponDef(f).name, mag: f.ammo[currentWeaponDef(f).id]?.mag ?? 0,
      reserve: f.ammo[currentWeaponDef(f).id]?.reserve ?? 0,
      grenades: { ...f.grenades }, hasSpike: f.hasSpike, reloading: f.reloading,
      plantT: f.plantT, defuseT: f.defuseT, crouched: f.crouched, aiming: f.aiming,
      speed: f.speed, spray: f.spray,
    })),
  };
}

// --- debug hooks used by the Node tests (and by staged screenshots) ---
export function debugTeleport(m, id, x, z) {
  const f = fighterById(m, id);
  if (f) {
    f.x = x;
    f.z = z;
    f.vx = 0;
    f.vz = 0;
  }
  return f;
}

export function debugKill(m, id) {
  const f = fighterById(m, id);
  if (f && f.alive) {
    const res = applyDamage(f, 10000);
    if (res.died && f.hasSpike) dropSpike(m, f);
    f.deaths += 1;
  }
  return f;
}

export function debugSetScore(m, v, s) {
  m.score.v = v;
  m.score.s = s;
}

export function debugSetMoney(m, id, amount) {
  const f = fighterById(m, id);
  if (f) f.money = amount;
}

export function debugPlantSpike(m, siteId) {
  const site = SITES[siteId];
  if (!site) return false;
  m.spike.state = 'planted';
  m.spike.siteId = siteId;
  m.spike.x = site.x;
  m.spike.z = site.z;
  m.spike.fuseT = FUSE_SEC;
  m.spike.carrierId = null;
  for (const f of m.fighters) f.hasSpike = false;
  return true;
}

export function debugSetPhase(m, phase, phaseT) {
  m.phase = phase;
  m.phaseT = phaseT;
}
