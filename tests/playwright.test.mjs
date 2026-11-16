// tests/playwright.test.mjs — browser tests for the game.
// Serves game/ on a local port, opens it in headless Chromium and checks
// that the four staged scenes render without errors, that a human can
// play (move, open the buy menu, buy a frag for $300), and captures the
// four screenshots the entry ships.
// Run: node tests/playwright.test.mjs

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { statSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = 8137;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = [
  { name: '1-combat.jpg', query: '?shot=combat&seed=1' },
  { name: '2-start.jpg', query: '?shot=start&seed=1' },
  { name: '3-buy.jpg', query: '?shot=buy&seed=1' },
  { name: '4-end.jpg', query: '?shot=end&seed=1' },
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForServer(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('server did not come up');
}

const server = spawn('node', ['serve.ts', '--port', String(PORT)], {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: 'ignore',
});

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`FAIL ${name}\n  ${err.message}`);
  }
}

try {
  await waitForServer(BASE + '/');
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push('console: ' + msg.text());
  });

  // --- staged scenes: no errors, game handle present, scene staged ---
  for (const shot of SHOTS) {
    await check(`staged scene ${shot.query}`, async () => {
      errors.length = 0;
      await page.goto(BASE + '/' + shot.query, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__game, null, { timeout: 15000 });
      await sleep(1800);
      const staged = await page.evaluate(() => window.__game.staged);
      assert.equal(staged, shot.query.match(/shot=(\w+)/)[1]);
      const summary = await page.evaluate(() => window.__game.summary());
      assert.ok(summary.fighters.length === 8, 'expected 8 fighters');
      assert.equal(errors.length, 0, errors.join(' | '));
    });
  }

  // --- interactive: play, buy a frag, move ---
  await check('interactive play + buy + move', async () => {
    errors.length = 0;
    await page.goto(BASE + '/?seed=7', { waitUntil: 'load' });
    await page.waitForFunction(() => window.__game, null, { timeout: 15000 });
    await page.click('#btn-play');
    await sleep(500);
    let phase = await page.evaluate(() => window.__game.summary().phase);
    assert.equal(phase, 'buy', `phase is ${phase}, expected buy`);
    const money0 = await page.evaluate(() => window.__game.summary().fighters[0].money);
    assert.equal(money0, 800, `money is ${money0}, expected 800`);
    await page.keyboard.press('KeyB');
    await sleep(300);
    const menuVisible = await page.evaluate(() => {
      const m = document.querySelector('.buy-menu');
      return m && getComputedStyle(m).display !== 'none';
    });
    assert.equal(menuVisible, true, 'buy menu did not open');
    await page.click('[data-buy="frag"]');
    await sleep(300);
    const money1 = await page.evaluate(() => window.__game.summary().fighters[0].money);
    assert.equal(money1, 500, `money after frag is ${money1}, expected 500`);
    // The HUD refreshes on the next rendered frame; SwiftShader is slow,
    // so wait for the text instead of assuming a fixed delay.
    await page.waitForFunction(() => document.querySelector('.money')?.textContent.includes('500'), null, { timeout: 10000 });
    const hudMoney = await page.textContent('.money');
    assert.ok(hudMoney.includes('500'), `HUD money shows ${hudMoney}`);
    await page.keyboard.press('KeyB');
    await sleep(200);
    const p0 = await page.evaluate(() => window.__game.pos());
    await page.keyboard.down('KeyW');
    // Headless SwiftShader renders a few frames a second, so wait for
    // the movement itself instead of assuming a fixed wall-clock window.
    await page.waitForFunction((start) => {
      const p = window.__game.pos();
      return Math.hypot(p.x - start.x, p.z - start.z) > 1;
    }, p0, { timeout: 20000 });
    await page.keyboard.up('KeyW');
    const p1 = await page.evaluate(() => window.__game.pos());
    const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    assert.ok(moved > 1, `moved only ${moved.toFixed(2)} m while holding W`);
    assert.equal(errors.length, 0, errors.join(' | '));
  });

  // --- screenshots: 1280x720 JPEG, each at most 256 KiB ---
  for (const shot of SHOTS) {
    await check(`screenshot ${shot.name}`, async () => {
      errors.length = 0;
      await page.goto(BASE + '/' + shot.query, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__game, null, { timeout: 15000 });
      await sleep(1800);
      const buf = await page.screenshot({ type: 'jpeg', quality: 80 });
      assert.ok(buf.length <= 262144, `${shot.name} is ${buf.length} bytes, over 256 KiB`);
      const path = new URL(`../screenshots/${shot.name}`, import.meta.url).pathname;
      writeFileSync(path, buf);
      console.log(`  ${shot.name}: ${buf.length} bytes`);
      assert.equal(errors.length, 0, errors.join(' | '));
    });
  }

  await browser.close();
} finally {
  server.kill();
}

if (failures > 0) {
  console.error(`\n${failures} playwright check(s) failed`);
  process.exit(1);
}
console.log('\nall playwright checks passed');
