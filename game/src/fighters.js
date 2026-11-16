// fighters.js — one fighter is one body on the yard: the human player or
// a bot. This module owns their state and the small rules that touch it
// (damage with armour, buying, spawning). The sim drives them each tick.

import { GRENADE_DEFS, KEVLAR_ARMOR, KEVLAR_PRICE, WEAPONS, weapon } from './weapons.js';

export const EYE_STAND = 1.55;
export const EYE_CROUCH = 1.05;
export const BODY_HEIGHT = 1.75;
export const BODY_CROUCH_HEIGHT = 1.2;
export const HEAD_TOP = 1.75;
export const HEAD_BOTTOM = 1.42;

/**
 * Create a fighter. `id` is a stable per-match number (0-7) so snapshots
 * are comparable across runs. `team` is 'v' (Vanguard, attackers) or 's'
 * (Sentinel). `bot` marks an AI-controlled fighter. Names are original
 * callsigns.
 */
export function makeFighter(id, team, name, bot, spawn) {
  return {
    id,
    team,
    name,
    bot,
    x: spawn.x,
    z: spawn.z,
    yaw: spawn.yaw,
    pitch: 0,
    vx: 0,
    vz: 0,
    hp: 100,
    armor: 0,
    alive: true,
    money: 800,
    kills: 0,
    deaths: 0,
    plants: 0,
    defuses: 0,
    // Loadout: primary slot holds a rifle/smg/sniper or null, secondary is
    // always the P9. ammo[weaponId] = { mag, reserve }.
    primary: null,
    secondary: 'p9',
    slot: 'secondary',
    ammo: {
      p9: { mag: WEAPONS.p9.mag, reserve: WEAPONS.p9.reserve },
    },
    grenades: { frag: 0, smoke: 0 },
    hasSpike: false,
    // Per-tick combat state, reset by the sim as needed.
    fireCooldown: 0,
    reloadT: 0,
    reloading: false,
    spray: 0,
    sprayT: 0,
    recoil: 0,
    crouched: false,
    aiming: false,
    moving: false,
    speed: 0,
    plantT: 0,
    defuseT: 0,
    lastShotTick: -999,
    flashT: 0,
  };
}

/** Weapon id the fighter is currently holding. */
export function currentWeapon(f) {
  return f.slot === 'primary' ? f.primary : f.secondary;
}

/** Full weapon table entry for the held weapon. */
export function currentWeaponDef(f) {
  return weapon(currentWeapon(f)) ?? WEAPONS.p9;
}

/** Reset a fighter for a new round at its spawn point. */
export function resetForRound(f, spawn) {
  f.x = spawn.x;
  f.z = spawn.z;
  f.yaw = spawn.yaw;
  f.pitch = 0;
  f.vx = 0;
  f.vz = 0;
  f.hp = 100;
  f.alive = true;
  f.fireCooldown = 0;
  f.reloadT = 0;
  f.reloading = false;
  f.spray = 0;
  f.sprayT = 0;
  f.recoil = 0;
  f.crouched = false;
  f.aiming = false;
  f.plantT = 0;
  f.defuseT = 0;
  f.hasSpike = false;
  f.flashT = 0;
  // Fresh reserve ammo each round; the magazine keeps what it had.
  for (const id of Object.keys(f.ammo)) {
    const w = weapon(id);
    if (w) f.ammo[id].reserve = w.reserve;
  }
  if (f.primary) f.slot = 'primary';
  else f.slot = 'secondary';
}

/**
 * Apply `dmg` to a fighter. Kevlar absorbs half the damage until its
 * 100 points run out — unless `pierce` is set (explosions ignore armour).
 * Returns { dealt, died }.
 */
export function applyDamage(f, dmg, pierce = false) {
  if (!f.alive) return { dealt: 0, died: false };
  let remaining = dmg;
  if (f.armor > 0 && !pierce) {
    const absorbed = Math.min(f.armor, remaining * 0.5);
    f.armor -= absorbed;
    remaining -= absorbed;
  }
  remaining = Math.max(0, remaining);
  f.hp -= remaining;
  const died = f.hp <= 0;
  if (died) {
    f.hp = 0;
    f.alive = false;
    f.hasSpike = false;
  }
  return { dealt: remaining, died };
}

/**
 * Buy an item during the buy phase. Returns true when the purchase went
 * through (money taken, item given). Weapons replace the primary; buying
 * a primary you already own refills its reserve instead.
 */
export function buyItem(f, itemId) {
  if (!f.alive) return false;
  if (WEAPONS[itemId]) {
    const w = WEAPONS[itemId];
    if (f.money < w.price) return false;
    if (f.primary === itemId) {
      f.ammo[itemId].reserve = w.reserve;
      f.money -= w.price;
      return true;
    }
    f.money -= w.price;
    f.primary = itemId;
    f.ammo[itemId] = { mag: w.mag, reserve: w.reserve };
    f.slot = 'primary';
    return true;
  }
  if (itemId === 'kevlar') {
    if (f.money < KEVLAR_PRICE || f.armor >= KEVLAR_ARMOR) return false;
    f.money -= KEVLAR_PRICE;
    f.armor = KEVLAR_ARMOR;
    return true;
  }
  if (GRENADE_DEFS[itemId]) {
    const g = GRENADE_DEFS[itemId];
    if (f.money < g.price) return false;
    if (f.grenades[itemId] >= 2) return false;
    f.money -= g.price;
    f.grenades[itemId] += 1;
    return true;
  }
  return false;
}

/** Can this fighter afford the item right now? (HUD greys out the rest.) */
export function canAfford(f, itemId) {
  if (WEAPONS[itemId]) return f.money >= WEAPONS[itemId].price;
  if (itemId === 'kevlar') return f.money >= KEVLAR_PRICE && f.armor < KEVLAR_ARMOR;
  if (GRENADE_DEFS[itemId]) return f.money >= GRENADE_DEFS[itemId].price && f.grenades[itemId] < 2;
  return false;
}
