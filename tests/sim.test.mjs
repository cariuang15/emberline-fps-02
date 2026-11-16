// tests/sim.test.mjs — headless Node tests for the match simulation.
// Run: node tests/sim.test.mjs
// No browser, no DOM: sim.js, bots.js, world.js and friends are pure.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  createMatch, stepMatch, snapshot, matchSummary, buyItemMatch, throwGrenade,
  debugTeleport, debugKill, debugSetScore, debugSetMoney, debugPlantSpike, debugSetPhase,
  TICK,
} from '../game/src/sim.js';
import { NAV, nearestNode } from '../game/src/world.js';
import { buyItem } from '../game/src/fighters.js';

const EMPTY = { f: false, b: false, l: false, r: false, crouch: false, walk: false, aim: false, fire: false, firePressed: false, reload: false, use: false, yawDelta: 0, pitchDelta: 0, yawAbs: null, pitchAbs: null, slot: 0, grenade: null };
const FWD = { ...EMPTY, f: true };

function run(m, seconds, inputFn = () => EMPTY) {
  const ticks = Math.round(seconds / TICK);
  for (let t = 0; t < ticks; t++) stepMatch(m, inputFn(t));
  return m;
}

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}\n  ${err.message}`);
    process.exitCode = 1;
  }
}

// --- nav graph: every node reachable from the Vanguard spawn node ---
test('nav graph is fully connected', () => {
  const start = nearestNode(-28, 0);
  const adj = new Map();
  for (const [a, b] of NAV.edges) {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(b);
    adj.get(b).push(a);
  }
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.pop();
    for (const nb of adj.get(cur) ?? []) {
      if (!seen.has(nb)) {
        seen.add(nb);
        queue.push(nb);
      }
    }
  }
  assert.equal(seen.size, NAV.nodes.length, `only ${seen.size}/${NAV.nodes.length} nodes reachable`);
  const lanes = new Set(NAV.nodes.map((n) => n.lane));
  assert.ok(lanes.has('top') && lanes.has('mid') && lanes.has('bottom'), 'all three lanes have nodes');
});

// --- movement: walking forward moves the player east, inside the yard ---
test('player movement', () => {
  const m = createMatch(7);
  debugSetPhase(m, 'live', 100);
  const p = m.fighters[0];
  const x0 = p.x;
  run(m, 1, () => FWD);
  assert.ok(p.x > x0 + 2.5, `moved only ${(p.x - x0).toFixed(2)} m in 1 s`);
  assert.ok(Math.abs(p.x) < 32 && Math.abs(p.z) < 24, 'left the yard');
});

// --- shooting: a pistol shot at 4 m hits and hurts ---
test('player shot hits a bot in front', () => {
  const m = createMatch(9);
  debugSetPhase(m, 'live', 100);
  const p = m.fighters[0];
  const victim = m.fighters.find((f) => f.team === 's');
  debugTeleport(m, victim.id, -24, -6); // due east of the player's spawn (-28,-6)
  const hp0 = victim.hp;
  run(m, 0.5, (t) => (t < 2 ? { ...EMPTY, firePressed: true } : EMPTY));
  assert.ok(victim.hp < hp0, `victim hp still ${victim.hp} after point-blank shots`);
});

// --- economy: buying a frag costs $300 ---
test('buy menu economy', () => {
  const m = createMatch(19);
  const p = m.fighters[0];
  assert.equal(p.money, 800);
  assert.equal(buyItemMatch(m, p.id, 'frag'), true);
  assert.equal(p.money, 500);
  assert.equal(p.grenades.frag, 1);
  assert.equal(buyItemMatch(m, p.id, 'vk47'), false, 'VK-47 should be unaffordable at $500');
  assert.equal(p.money, 500);
});

// --- frag: a grenade thrown at a bot's feet kills ---
test('frag grenade kill', () => {
  const m = createMatch(13);
  debugSetPhase(m, 'live', 100);
  const p = m.fighters[0];
  const victim = m.fighters.find((f) => f.team === 's');
  debugTeleport(m, victim.id, 0, 0);
  debugTeleport(m, p.id, 0, -3);
  p.yaw = Math.PI; // face +z, toward the victim
  debugSetMoney(m, p.id, 5000);
  assert.equal(buyItem(p, 'frag'), true);
  assert.equal(throwGrenade(m, p, 'frag', 0, 0), true);
  run(m, 2.5);
  assert.equal(victim.alive, false, 'victim survived a frag at their feet');
});

// --- plant: a bot-only match plants the spike ---
test('bot-only match plants the spike', () => {
  const m = createMatch(23, { playerIsBot: true });
  let planted = false;
  for (let t = 0; t < 150 * 60; t++) {
    stepMatch(m, EMPTY);
    if (m.spike.state === 'planted') {
      planted = true;
      break;
    }
    if (m.phase === 'over') break;
  }
  assert.equal(planted, true, 'no plant within 150 s of bot play');
});

// --- defuse: a lone Sentinel defuses a planted spike ---
test('sentinel defuses a planted spike', () => {
  const m = createMatch(11);
  debugSetPhase(m, 'live', 100);
  debugPlantSpike(m, 'A');
  // Clear the yard so nobody interrupts the defuse.
  for (const f of m.fighters.filter((x) => x.team === 'v')) debugKill(m, f.id);
  const defuser = m.fighters.find((f) => f.team === 's');
  for (const f of m.fighters.filter((x) => x.team === 's' && x.id !== defuser.id)) debugKill(m, f.id);
  debugTeleport(m, defuser.id, -16, -13);
  run(m, 8);
  assert.equal(m.roundWinner, 's', `round winner is ${m.roundWinner}, spike state ${m.spike.state}`);
  assert.equal(m.score.s, 1);
});

// --- rounds end: a bot-only match finishes a round ---
test('bot-only match finishes a round', () => {
  const m = createMatch(29, { playerIsBot: true });
  const round0 = m.round;
  run(m, 160);
  assert.ok(m.round > round0 || m.matchWinner, `still round ${m.round} after 160 s`);
});

// --- first to 5: at 4-4, wiping Sentinel ends the match for Vanguard ---
test('first to 5 wins the match', () => {
  const m = createMatch(17);
  debugSetScore(m, 4, 4);
  debugSetPhase(m, 'live', 100);
  for (const f of m.fighters.filter((x) => x.team === 's')) debugKill(m, f.id);
  run(m, 1);
  assert.equal(m.matchWinner, 'v', `match winner is ${m.matchWinner}`);
  assert.equal(m.score.v, 5);
  run(m, 6);
  assert.equal(m.phase, 'over');
});

// --- determinism: two 30 s bot-only runs are byte-identical ---
test('determinism: two runs, same seed, same bytes', () => {
  const runOnce = () => {
    const m = createMatch(42, { playerIsBot: true });
    run(m, 30);
    return snapshot(m);
  };
  const a = runOnce();
  const b = runOnce();
  assert.equal(a, b, 'snapshots differ');
  const ha = createHash('sha256').update(a).digest('hex');
  const hb = createHash('sha256').update(b).digest('hex');
  assert.equal(ha, hb);
  console.log(`  snapshot sha256 ${ha.slice(0, 16)}… (${a.length} chars)`);
});

console.log(`\n${passed} sim tests passed`);
