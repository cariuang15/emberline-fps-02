// weapons.js — every weapon, grenade and economy number in one table.
// The simulation and the HUD both read from here, so a price or a damage
// value can never disagree between the buy menu and the gun that fires.

// damage: body damage at close range. headMult multiplies it on a head hit.
// rpm: rounds per minute. spreadDeg: base cone half-angle in degrees.
// moveSpreadDeg: extra cone added at full sprint speed. recoilDeg: pitch
// kick per shot (the player's view climbs; it recovers between shots).
export const WEAPONS = {
  p9: {
    id: 'p9', name: 'P9', kind: 'pistol', price: 0,
    damage: 26, headMult: 2.2, rpm: 380, auto: false,
    mag: 12, reserve: 36, reloadSec: 1.4,
    spreadDeg: 0.55, moveSpreadDeg: 1.6, recoilDeg: 0.55, range: 40,
  },
  mp9: {
    id: 'mp9', name: 'MP9', kind: 'smg', price: 900,
    damage: 21, headMult: 2.0, rpm: 780, auto: true,
    mag: 30, reserve: 90, reloadSec: 2.0,
    spreadDeg: 0.9, moveSpreadDeg: 2.4, recoilDeg: 0.42, range: 32,
  },
  vk47: {
    id: 'vk47', name: 'VK-47', kind: 'rifle', price: 1700,
    damage: 34, headMult: 2.2, rpm: 600, auto: true,
    mag: 25, reserve: 75, reloadSec: 2.3,
    spreadDeg: 0.7, moveSpreadDeg: 2.2, recoilDeg: 0.8, range: 55,
  },
  longshot: {
    id: 'longshot', name: 'Longshot', kind: 'sniper', price: 2600,
    damage: 96, headMult: 2.5, rpm: 48, auto: false,
    mag: 5, reserve: 15, reloadSec: 3.1,
    spreadDeg: 0.08, moveSpreadDeg: 3.2, recoilDeg: 2.6, range: 90,
    scopedSpreadDeg: 0.05, zoomFov: 26,
  },
};

export const GRENADE_DEFS = {
  frag: {
    id: 'frag', name: 'Frag Grenade', price: 300,
    damage: 140, radius: 5.5, fuseSec: 1.2, throwSpeed: 13,
  },
  smoke: {
    id: 'smoke', name: 'Smoke Grenade', price: 250,
    radius: 4.5, durationSec: 14, throwSpeed: 12,
  },
};

export const KEVLAR_PRICE = 650;
export const KEVLAR_ARMOR = 100;

export const ECON = {
  startMoney: 800,
  roundWin: 325,
  roundLoss: 190,
  kill: 300,
  plant: 300,
};

export function weapon(id) {
  return WEAPONS[id] ?? null;
}

/** Seconds between two shots of this weapon. */
export function shotInterval(w) {
  return 60 / w.rpm;
}

/**
 * Damage of one hit at `dist` metres, before armour.
 * Rifles and pistols lose a fifth of their punch past 25 m; the Longshot
 * keeps its full power at any range, which is what you pay 2600 for.
 */
export function damageAtRange(w, dist, head) {
  let dmg = w.damage * (head ? w.headMult : 1);
  if (w.id !== 'longshot' && dist > 25) dmg *= 0.8;
  return dmg;
}

/** Price list for the buy menu, in menu order. */
export const BUY_MENU = [
  { id: 'mp9', label: 'MP9 SMG', price: 900, key: '1' },
  { id: 'vk47', label: 'VK-47 Rifle', price: 1700, key: '2' },
  { id: 'longshot', label: 'Longshot Sniper', price: 2600, key: '3' },
  { id: 'kevlar', label: 'Kevlar Vest', price: 650, key: '4' },
  { id: 'frag', label: 'Frag Grenade', price: 300, key: '5' },
  { id: 'smoke', label: 'Smoke Grenade', price: 250, key: '6' },
];
