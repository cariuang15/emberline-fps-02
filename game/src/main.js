// main.js — boot and game loop. It wires the deterministic simulation to
// the renderer, the HUD and the synth audio, and samples the keyboard and
// mouse into one input object per fixed tick (60 Hz). The sim never sees
// the frame rate; the renderer never sees the input.
//
// Staged screenshots: ?shot=start|combat|buy|end&seed=1 puts the match in
// a fixed, deterministic pose for a screenshot — the menu, a firefight at
// Foundry, the buy menu, or the final score — then pauses the sim so the
// frame is stable.

import { createMatch, stepMatch, matchSummary, buyItemMatch, TICK, debugTeleport, debugSetScore, debugSetMoney, debugSetPhase } from './sim.js';
import { createRenderer } from './render.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { BUY_MENU } from './weapons.js';
import { buyItem, currentWeaponDef, EYE_STAND, EYE_CROUCH } from './fighters.js';

const params = new URLSearchParams(location.search);
const seedParam = params.get('seed');
const seed = seedParam !== null ? (Number(seedParam) >>> 0) : Math.floor(Math.random() * 0x7fffffff);
const shot = params.get('shot');

const canvas = document.getElementById('game');
const renderer = createRenderer(canvas);
const audio = createAudio();

let match = createMatch(seed);
let started = false;
let paused = false;
let muted = false;

const hud = createHud({
  onPlay() {
    audio.unlock();
    started = true;
    hud.setMenu(false);
    lockPointer();
  },
  onBuy(itemId) {
    const ok = buyItemMatch(match, match.playerId, itemId);
    if (ok) audio.buy();
    else audio.deny();
  },
  onRestart() {
    match = createMatch(Math.floor(Math.random() * 0x7fffffff));
    hud.hideEnd();
    hud.setMenu(false);
    started = true;
    paused = false;
    lastSeen = snapshotCursors();
  },
});

// --- input state -------------------------------------------------------------
const keys = new Set();
let mouseDX = 0;
let mouseDY = 0;
let mouseDown = false;
let mouseRight = false;
let fireEdge = false;
let reloadEdge = false;
let grenadeEdge = null;
let slotEdge = 0;
let pointerLocked = false;

function lockPointer() {
  try {
    const p = canvas.requestPointerLock?.();
    if (p && p.catch) p.catch(() => {});
  } catch {
    // Headless browsers refuse pointer lock; keyboard + arrows still work.
  }
}

function exitPointerLock() {
  try {
    document.exitPointerLock?.();
  } catch {
    // Not locked; nothing to release.
  }
}

document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === canvas;
});
document.addEventListener('mousemove', (e) => {
  if (pointerLocked) {
    mouseDX += e.movementX;
    mouseDY += e.movementY;
  }
});
canvas.addEventListener('mousedown', (e) => {
  audio.unlock();
  if (!started) return;
  if (e.button === 0) {
    mouseDown = true;
    fireEdge = true;
  } else if (e.button === 2) {
    mouseRight = true;
  }
  // With the buy menu open the mouse belongs to the menu, not the view.
  if (!pointerLocked && !hud.isBuyOpen()) lockPointer();
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) mouseDown = false;
  if (e.button === 2) mouseRight = false;
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('keydown', (e) => {
  if (e.code === 'Tab') {
    e.preventDefault();
    hud.setScoreboard(true);
    return;
  }
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'KeyR') reloadEdge = true;
  if (e.code === 'KeyG') grenadeEdge = 'frag';
  if (e.code === 'KeyH') grenadeEdge = 'smoke';
  if (e.code === 'Digit1') slotEdge = 1;
  if (e.code === 'Digit2') slotEdge = 2;
  if (e.code === 'KeyB' && started && match.phase === 'buy') {
    const open = !hud.isBuyOpen();
    hud.setBuyOpen(open);
    // Opening the buy menu hands the mouse back so its buttons are clickable.
    if (open) exitPointerLock();
    audio.click();
  }
  if (e.code === 'KeyM') {
    muted = !muted;
    audio.setMuted(muted);
    hud.setMuted(muted);
  }
  if (e.code === 'KeyF' && started) lockPointer();
  if (hud.isBuyOpen()) {
    const item = BUY_MENU.find((b) => b.key === e.code.replace('Digit', ''));
    if (item) {
      const ok = buyItemMatch(match, match.playerId, item.id);
      if (ok) audio.buy();
      else audio.deny();
    }
  }
});
document.addEventListener('keyup', (e) => {
  keys.delete(e.code);
  if (e.code === 'Tab') hud.setScoreboard(false);
});

function buildInput() {
  const buying = hud.isBuyOpen();
  const input = {
    f: keys.has('KeyW'),
    b: keys.has('KeyS'),
    l: keys.has('KeyA'),
    r: keys.has('KeyD'),
    crouch: keys.has('KeyC') || keys.has('ControlLeft'),
    walk: keys.has('ShiftLeft') || keys.has('ShiftRight'),
    aim: mouseRight,
    fire: mouseDown && !buying,
    firePressed: fireEdge && !buying,
    reload: reloadEdge,
    use: keys.has('KeyE'),
    yawDelta: mouseDX * 0.0022 + (keys.has('ArrowLeft') ? 0.045 : 0) + (keys.has('ArrowRight') ? -0.045 : 0),
    pitchDelta: mouseDY * 0.0022 + (keys.has('ArrowUp') ? 0.03 : 0) + (keys.has('ArrowDown') ? -0.03 : 0),
    yawAbs: null,
    pitchAbs: null,
    slot: slotEdge,
    grenade: grenadeEdge,
  };
  mouseDX = 0;
  mouseDY = 0;
  fireEdge = false;
  reloadEdge = false;
  grenadeEdge = null;
  slotEdge = 0;
  return input;
}

// --- staged screenshots ------------------------------------------------------
function stageShot(kind) {
  const player = match.fighters[0];
  if (kind === 'start') {
    // Menu over the yard at spawn; the match waits in buy phase.
    paused = true;
    hud.setMenu(true);
  } else if (kind === 'combat') {
    hud.setMenu(false);
    started = true;
    debugSetMoney(match, player.id, 6000);
    buyItem(player, 'vk47');
    buyItem(player, 'frag');
    debugTeleport(match, player.id, -4, 2);
    player.yaw = Math.atan2(-(-16 - -4), -(-13 - 2));
    debugSetPhase(match, 'live', 55);
    const sentinels = match.fighters.filter((f) => f.team === 's');
    debugTeleport(match, sentinels[0].id, -12, -10);
    debugTeleport(match, sentinels[1].id, -18, -8);
    const ally = match.fighters.find((f) => f.team === 'v' && f.bot);
    if (ally) debugTeleport(match, ally.id, -8, 5);
    // Let the bots spread and the player fire one shot, then freeze.
    // The shot goes off on the last tick so its tracer is still in the air.
    for (let t = 0; t < 45; t++) {
      const inp = { f: false, b: false, l: false, r: false, crouch: false, walk: false, aim: true, fire: t === 44, firePressed: t === 44, reload: false, use: false, yawDelta: 0, pitchDelta: 0, yawAbs: null, pitchAbs: null, slot: 0, grenade: null };
      stepMatch(match, inp);
    }
    paused = true;
  } else if (kind === 'buy') {
    hud.setMenu(false);
    started = true;
    paused = true;
    hud.setBuyOpen(true);
  } else if (kind === 'end') {
    hud.setMenu(false);
    started = true;
    debugSetScore(match, 5, 3);
    match.matchWinner = 'v';
    debugSetPhase(match, 'over', 0);
    hud.showEnd('v', { v: 5, s: 3 });
    paused = true;
  }
}

if (shot) stageShot(shot);

// --- sound + banner reactions -----------------------------------------------
function snapshotCursors() {
  return {
    hp: match.fighters[0].hp,
    kills: match.fighters[0].kills,
    phase: match.phase,
    round: match.round,
    roundWinner: match.roundWinner,
    matchWinner: match.matchWinner,
    lastHitTick: match.lastHit ? match.lastHit.tick : -1,
    lastEventTick: match.events.length ? match.events[match.events.length - 1].tick : -1,
    plantTick: -1,
    explodeTick: -1,
  };
}
let lastSeen = snapshotCursors();

function react() {
  const player = match.fighters[0];
  if (match.lastHit && match.lastHit.shooterId === match.playerId && match.lastHit.tick > lastSeen.lastHitTick) {
    lastSeen.lastHitTick = match.lastHit.tick;
    hud.flashHit(match.lastHit.kill);
    if (match.lastHit.kill) audio.kill();
    else audio.hit();
  }
  if (player.hp < lastSeen.hp && player.alive) audio.hurt();
  lastSeen.hp = player.hp;
  lastSeen.kills = player.kills;
  if (match.phase !== lastSeen.phase) {
    if (match.phase === 'live') hud.showBanner('ROUND ' + match.round, 'Eliminate Sentinel or plant the spike');
    if (match.phase === 'buy' && match.round > 1) hud.showBanner('ROUND ' + match.round, 'Buy phase — press B');
    lastSeen.phase = match.phase;
  }
  if (match.roundWinner && match.roundWinner !== lastSeen.roundWinner) {
    lastSeen.roundWinner = match.roundWinner;
    const won = match.roundWinner === 'v';
    hud.showBanner(won ? 'VANGUARD WIN THE ROUND' : 'SENTINEL WIN THE ROUND', `Score ${match.score.v} — ${match.score.s}`, 3000);
    if (won) audio.roundWin();
    else audio.roundLose();
  }
  for (const ev of match.events) {
    if (ev.tick <= lastSeen.lastEventTick) continue;
    if (ev.type === 'plant') audio.plantBeep();
    if (ev.type === 'explode') audio.explosion();
  }
  if (match.events.length) lastSeen.lastEventTick = match.events[match.events.length - 1].tick;
  if (match.matchWinner && match.matchWinner !== lastSeen.matchWinner) {
    lastSeen.matchWinner = match.matchWinner;
    exitPointerLock();
    hud.showEnd(match.matchWinner, match.score);
  }
  if (!player.alive && match.phase === 'live') {
    hud.showMessage('You were eliminated — the round plays on without you.', 4000);
  }
}

// --- main loop ---------------------------------------------------------------
function resize() {
  renderer.resize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);
resize();

let lastT = performance.now();
let acc = 0;

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - lastT) / 1000;
  lastT = now;
  if (dt > 0.25) dt = 0.25;
  if (started && !paused) {
    acc += dt;
    let steps = 0;
    while (acc >= TICK && steps < 10) {
      stepMatch(match, buildInput());
      acc -= TICK;
      steps += 1;
    }
    if (steps === 10) acc = 0;
  }
  const player = match.fighters[0];
  const summary = matchSummary(match);
  const pv = summary.fighters[0];
  hud.update(match, pv);
  react();
  const wdef = currentWeaponDef(player);
  renderer.render(match, {
    x: player.x,
    z: player.z,
    yaw: player.yaw,
    pitch: player.pitch,
    eye: player.crouched ? EYE_CROUCH : EYE_STAND,
    recoil: player.recoil,
    flashT: player.flashT,
    scoped: player.aiming && wdef.id === 'longshot',
  }, dt);
}

requestAnimationFrame(frame);

// Handle for tests and screenshots.
window.__game = {
  match,
  playerId: match.playerId,
  seed,
  staged: shot ?? null,
  version: 'emberline-kestrel-yard/2',
  summary: () => matchSummary(match),
  pos: () => ({ x: match.fighters[0].x, z: match.fighters[0].z }),
};
