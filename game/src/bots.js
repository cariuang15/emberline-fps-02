// bots.js — the AI for the seven bot fighters. A bot thinks in roles, not
// in scripted paths: it picks a lane, walks the nav graph with A*, watches
// a vision cone, hears gunfire, and only pulls the trigger when its line
// of fire is clear of teammates. All choices come from the match rng, so
// bot behaviour is part of the deterministic simulation.
//
// Balance note: both teams share the same aim error, reaction time and
// burst discipline. Vanguard get a small edge while their carrier pushes
// (the push is the fun part of the round); Sentinel get a small edge while
// holding a site. Neither side should feel like it is cheating.

import { clamp, dist2, randRange, pick, angleDiff, turnToward } from './util.js';
import { NAV, nearestNode, findPath, segmentBlocked, segmentHitsCircle, rayObstacle, SITES, siteAt, FIGHTER_RADIUS } from './world.js';
import { WEAPONS } from './weapons.js';

const VISION_RANGE = 38;
const VISION_HALF_ANGLE = 1.05; // ~60 degrees each side
const HEAR_RANGE = 30;
const TURN_RATE = 6.5; // rad/s, how fast a bot can swing its aim

function emptyInput() {
  return { f: false, b: false, l: false, r: false, crouch: false, walk: false, aim: false, fire: false, firePressed: false, reload: false, use: false, yawDelta: 0, pitchDelta: 0, yawAbs: null, pitchAbs: null, slot: 0, grenade: null };
}

export function createBrain(f, rng) {
  return {
    fighterId: f.id,
    team: f.team,
    // Aim and trigger discipline, rolled once per bot so bots feel different.
    aimErrDeg: randRange(rng, 1.9, 2.6),
    reactionSec: randRange(rng, 0.35, 0.6),
    burstMin: 3,
    burstMax: 5,
    role: f.team === 'v' ? 'push' : 'hold',
    siteId: f.team === 's' ? (rng() < 0.5 ? 'A' : 'B') : null,
    lane: pick(rng, ['top', 'mid', 'bottom']),
    path: [],
    pathIdx: 0,
    pathTarget: null,
    decideT: 0,
    reactT: 0,
    visibleEnemy: null,
    burstLeft: 0,
    burstPause: 0,
    strafeDir: 1,
    strafeT: 0,
    holdPos: null,
    smokedSite: false,
    grenadeT: 0,
    stuckT: 0,
    lastX: f.x,
    lastZ: f.z,
    investigate: null,
  };
}

export function resetBrain(brain, m) {
  const f = m.fighters.find((x) => x.id === brain.fighterId);
  brain.role = brain.team === 'v' ? 'push' : 'hold';
  brain.siteId = brain.team === 's' ? (m.rng() < 0.5 ? 'A' : 'B') : null;
  brain.lane = pick(m.rng, ['top', 'mid', 'bottom']);
  brain.path = [];
  brain.pathIdx = 0;
  brain.pathTarget = null;
  brain.decideT = 0;
  brain.reactT = 0;
  brain.visibleEnemy = null;
  brain.burstLeft = 0;
  brain.burstPause = 0;
  brain.holdPos = null;
  brain.smokedSite = false;
  brain.grenadeT = 0;
  brain.stuckT = 0;
  brain.investigate = null;
  brain.stage = 'toLane';
  if (f) {
    brain.lastX = f.x;
    brain.lastZ = f.z;
  }
}

// --- sight -----------------------------------------------------------------

/** Can `f` see `e` right now? Cone + range + line of sight + smoke. */
function canSee(m, f, e) {
  if (!e.alive) return false;
  const d = dist2(f.x, f.z, e.x, e.z);
  if (d > VISION_RANGE) return false;
  const toEnemy = Math.atan2(-(e.x - f.x), -(e.z - f.z));
  if (Math.abs(angleDiff(toEnemy, f.yaw)) > VISION_HALF_ANGLE && d > 4) return false;
  if (segmentBlocked(f.x, f.z, e.x, e.z)) return false;
  for (const s of m.smokes) {
    if (segmentHitsCircle(f.x, f.z, e.x, e.z, s.x, s.z, s.r)) return false;
  }
  return true;
}

function nearestVisibleEnemy(m, f) {
  let best = null;
  let bestD = Infinity;
  for (const e of m.fighters) {
    if (e.team === f.team || !e.alive) continue;
    if (!canSee(m, f, e)) continue;
    const d = dist2(f.x, f.z, e.x, e.z);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

/** Would a shot at `target` pass within a metre of a teammate? Hold fire. */
function teammateInLine(m, f, target) {
  for (const t of m.fighters) {
    if (t.team !== f.team || t.id === f.id || !t.alive) continue;
    const dx = target.x - f.x;
    const dz = target.z - f.z;
    const len2 = dx * dx + dz * dz;
    if (len2 < 0.01) continue;
    let tt = ((t.x - f.x) * dx + (t.z - f.z) * dz) / len2;
    tt = clamp(tt, 0, 1);
    const px = f.x + dx * tt;
    const pz = f.z + dz * tt;
    const ddx = t.x - px;
    const ddz = t.z - pz;
    if (ddx * ddx + ddz * ddz < 1.1 * 1.1) return true;
  }
  return false;
}

// --- movement ---------------------------------------------------------------

function setPathTo(m, brain, f, tx, tz) {
  const from = nearestNode(f.x, f.z);
  const to = nearestNode(tx, tz);
  let raw = findPath(from, to);
  // Skip the start node when we are already standing on it and the next
  // leg is a straight clear walk from where we stand: otherwise the bot
  // walks back to a node it just left every time it re-plans.
  if (raw.length > 1) {
    const first = NAV.nodes[raw[0]];
    const second = NAV.nodes[raw[1]];
    if (dist2(f.x, f.z, first.x, first.z) < 2.5 && !segmentBlocked(f.x, f.z, second.x, second.z)) {
      raw = raw.slice(1);
    }
  }
  brain.path = raw;
  brain.path.push('end');
  brain.pathIdx = 0;
  brain.pathTarget = { x: tx, z: tz };
}

/**
 * Re-plan only when the goal moved or the old path ran out. Rebuilding
 * every decision tick makes a bot walk back to the node it just left.
 */
function ensurePath(m, brain, f, tx, tz) {
  const t = brain.pathTarget;
  const sameTarget = t && dist2(t.x, t.z, tx, tz) < 2.5;
  const hasPath = brain.path.length > 0 && brain.pathIdx < brain.path.length;
  if (sameTarget && hasPath) return;
  setPathTo(m, brain, f, tx, tz);
}

/** Walk the current path; returns true while there is somewhere to walk to. */
function followPath(m, brain, f, input, speedKey = 'f') {
  let target = null;
  if (brain.pathIdx < brain.path.length) {
    const step = brain.path[brain.pathIdx];
    target = step === 'end' ? brain.pathTarget : NAV.nodes[step];
  }
  if (!target) return false; // arrived: nothing left to walk to
  const d = dist2(f.x, f.z, target.x, target.z);
  if (d < 1.1) {
    brain.pathIdx += 1;
    return followPath(m, brain, f, input, speedKey);
  }
  const wantYaw = Math.atan2(-(target.x - f.x), -(target.z - f.z));
  const diff = angleDiff(wantYaw, f.yaw);
  input.yawAbs = wantYaw;
  if (Math.abs(diff) < 1.2) input[speedKey] = true;
  else if (Math.abs(diff) > 2.4) input.b = true; // turned around: back up
  return true;
}

/** Pick a lane node as a waypoint toward a site, so routes vary. */
function laneWaypoint(m, brain, siteId) {
  const site = SITES[siteId];
  const laneNodes = NAV.nodes.filter((n) => n.lane === brain.lane);
  let best = null;
  let bestD = Infinity;
  for (const n of laneNodes) {
    const d = dist2(n.x, n.z, site.x, site.z);
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return best ?? site;
}

// --- decisions ---------------------------------------------------------------

function decide(m, f, brain) {
  const rng = m.rng;
  const spike = m.spike;
  brain.decideT = 0.25;

  if (f.team === 'v') {
    if (spike.state === 'planted') {
      // Plant is down: guard it from a distance, hunt the defusers.
      brain.role = 'guard';
      const site = SITES[spike.siteId];
      brain.holdPos = { x: site.x + randRange(rng, -6, 6), z: site.z + randRange(rng, -6, 6) };
      ensurePath(m, brain, f, brain.holdPos.x, brain.holdPos.z);
      return;
    }
    if (f.hasSpike) {
      // Carrier: pick a site (the one with fewer defenders is tempting),
      // walk down the chosen lane first, then cut in to the site itself.
      brain.role = 'carry';
      if (!brain.siteId || rng() < 0.15) {
        const defA = m.fighters.filter((e) => e.team === 's' && e.alive && dist2(e.x, e.z, SITES.A.x, SITES.A.z) < 12).length;
        const defB = m.fighters.filter((e) => e.team === 's' && e.alive && dist2(e.x, e.z, SITES.B.x, SITES.B.z) < 12).length;
        brain.siteId = defA <= defB ? (rng() < 0.6 ? 'A' : 'B') : (rng() < 0.6 ? 'B' : 'A');
        brain.stage = 'toLane';
      }
      if (brain.stage === 'toLane') {
        const wp = laneWaypoint(m, brain, brain.siteId);
        ensurePath(m, brain, f, wp.x, wp.z);
      }
      brain.smokedSite = false;
      return;
    }
    if (spike.state === 'dropped') {
      brain.role = 'recover';
      ensurePath(m, brain, f, spike.x, spike.z);
      return;
    }
    // Escort: stay near the carrier, a few metres behind, same lane.
    const carrier = m.fighters.find((e) => e.hasSpike);
    if (carrier) {
      brain.role = 'escort';
      brain.escortId = carrier.id;
      ensurePath(m, brain, f, carrier.x, carrier.z);
      return;
    }
    brain.role = 'push';
    ensurePath(m, brain, f, SITES[brain.siteId ?? 'A'].x, SITES[brain.siteId ?? 'A'].z);
    return;
  }

  // Sentinel.
  if (spike.state === 'planted') {
    brain.role = 'retake';
    ensurePath(m, brain, f, spike.x, spike.z);
    return;
  }
  // Hold the assigned site. Stand off the site centre so the site itself
  // stays open, facing the lane the attackers will come down.
  brain.role = 'hold';
  const site = SITES[brain.siteId ?? 'A'];
  if (!brain.holdPos || dist2(f.x, f.z, brain.holdPos.x, brain.holdPos.z) < 1) {
    brain.holdPos = {
      x: site.x + randRange(rng, -7, 7),
      z: site.z + randRange(rng, -7, 7),
    };
    if (siteAt(brain.holdPos.x, brain.holdPos.z)) {
      brain.holdPos.x = site.x + 7;
    }
  }
  ensurePath(m, brain, f, brain.holdPos.x, brain.holdPos.z);
}

// --- per-tick brain -----------------------------------------------------------

export function botInput(m, f, brain, dt) {
  const input = emptyInput();
  if (!f.alive || m.phase === 'post' || m.phase === 'over') return input;

  brain.decideT -= dt;
  brain.grenadeT -= dt;
  brain.strafeT -= dt;
  if (brain.decideT <= 0) decide(m, f, brain);

  // Stuck detection: if we barely moved in 2 s, re-plan.
  if (dist2(f.x, f.z, brain.lastX, brain.lastZ) < 0.05) brain.stuckT += dt;
  else brain.stuckT = 0;
  brain.lastX = f.x;
  brain.lastZ = f.z;
  if (brain.stuckT > 2) {
    brain.stuckT = 0;
    decide(m, f, brain);
  }

  // --- hearing: a nearby gunshot pulls a holder toward the noise ---
  if (!brain.visibleEnemy && brain.role === 'hold') {
    for (const n of m.noises) {
      if (dist2(f.x, f.z, n.x, n.z) < HEAR_RANGE && dist2(n.x, n.z, SITES[brain.siteId ?? 'A'].x, SITES[brain.siteId ?? 'A'].z) < 16) {
        brain.investigate = { x: n.x, z: n.z };
        break;
      }
    }
  }

  // --- vision ---
  const enemy = nearestVisibleEnemy(m, f);
  if (enemy) {
    if (brain.visibleEnemy !== enemy) brain.reactT = brain.reactionSec;
    brain.visibleEnemy = enemy;
  } else {
    brain.visibleEnemy = null;
    brain.burstLeft = 0;
  }

  // --- combat: aim, burst, strafe ---
  if (brain.visibleEnemy) {
    const e = brain.visibleEnemy;
    const d = dist2(f.x, f.z, e.x, e.z);
    const wantYaw = Math.atan2(-(e.x - f.x), -(e.z - f.z));
    // Aim error grows with distance; the carrier push bonus and the
    // site-hold bonus tighten it a little.
    let errDeg = brain.aimErrDeg * (0.7 + d / 30) * m.botSkill;
    if (brain.role === 'carry') errDeg *= 0.85;
    if (brain.role === 'hold') errDeg *= 0.9;
    const err = (errDeg * Math.PI) / 180;
    const wobble = Math.sin(m.time * 1.7 + f.id * 2.3) * err * 0.4;
    input.yawAbs = wantYaw + wobble;
    input.aim = d > 14;
    // Low health and close enemy: back away while shooting.
    if (f.hp < 35 && d < 10) input.b = true;
    else if (brain.strafeT <= 0) {
      brain.strafeDir = m.rng() < 0.5 ? 1 : -1;
      brain.strafeT = 0.7 + m.rng() * 0.8;
    }
    if (brain.strafeT > 0) {
      if (brain.strafeDir > 0) input.r = true;
      else input.l = true;
    }

    brain.reactT -= dt;
    if (brain.reactT <= 0 && !teammateInLine(m, f, e)) {
      if (brain.burstLeft <= 0) {
        if (brain.burstPause > 0) {
          brain.burstPause -= dt;
        } else {
          brain.burstLeft = brain.burstMin + Math.floor(m.rng() * (brain.burstMax - brain.burstMin + 1));
        }
      }
      if (brain.burstLeft > 0) {
        const holding = f.slot === 'primary' ? f.primary : 'p9';
        const cur = WEAPONS[holding] ?? WEAPONS.p9;
        if (f.fireCooldown <= 0) {
          input.fire = cur.auto;
          input.firePressed = !cur.auto;
          brain.burstLeft -= 1;
          if (brain.burstLeft <= 0) brain.burstPause = 0.5 + m.rng() * 0.5;
        }
      }
    }
    // Frag at a visible enemy behind cover, from mid range.
    if (brain.grenadeT <= 0 && f.grenades.frag > 0 && d > 9 && d < 26 && m.rng() < 0.02) {
      input.grenade = 'frag';
      brain.grenadeT = 8;
    }
    return input;
  }

  // --- objective work ---
  if (f.hasSpike && m.phase === 'live') {
    const site = siteAt(f.x, f.z);
    if (site) {
      // On site: plant. The carrier lobs smoke at the site first, once.
      if (!brain.smokedSite && f.grenades.smoke > 0) {
        input.grenade = 'smoke';
        brain.smokedSite = true;
        return input;
      }
      input.use = true;
      return input;
    }
  }
  if (f.team === 's' && m.spike.state === 'planted') {
    const d = dist2(f.x, f.z, m.spike.x, m.spike.z);
    if (d < 1.6) {
      input.use = true;
      return input;
    }
  }

  // --- movement toward the role's goal ---
  const inSite = f.hasSpike && siteAt(f.x, f.z);
  if (!inSite) {
    if (brain.role === 'hold' && brain.holdPos && dist2(f.x, f.z, brain.holdPos.x, brain.holdPos.z) < 2) {
      // Holding: face the Vanguard spawn (west), where attackers come from.
      input.yawAbs = Math.atan2(-(-28 - f.x), -(0 - f.z));
      return input;
    }
    if (brain.role === 'guard' && brain.holdPos && dist2(f.x, f.z, brain.holdPos.x, brain.holdPos.z) < 2) {
      const site = SITES[m.spike.siteId ?? 'A'];
      input.yawAbs = Math.atan2(-(site.x - f.x), -(site.z - f.z));
      return input;
    }
    followPath(m, brain, f, input, 'f');
    // Carrier reached its lane waypoint: cut in to the site itself.
    if (brain.role === 'carry' && brain.stage === 'toLane' && brain.pathIdx >= brain.path.length) {
      const site = SITES[brain.siteId ?? 'A'];
      setPathTo(m, brain, f, site.x, site.z);
      brain.stage = 'toSite';
    }
    // Escorts trail the carrier instead of racing ahead.
    if (brain.role === 'escort' && brain.escortId !== undefined) {
      const carrier = m.fighters.find((e) => e.id === brain.escortId);
      if (carrier && dist2(f.x, f.z, carrier.x, carrier.z) < 3.5) {
        input.f = false;
        input.b = false;
      }
    }
  }
  return input;
}
