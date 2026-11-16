// hud.js — the DOM overlay: health, ammo, timer, score, money, killfeed,
// crosshair, hitmarker, buy menu, scoreboard, banners and the start/end
// screens. It only reads match state and calls back into main.js; it never
// touches the simulation itself.

import { BUY_MENU } from './weapons.js';
import { fmtClock } from './util.js';

function el(tag, cls, parent, text = '') {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  if (parent) parent.appendChild(n);
  return n;
}

export function createHud(callbacks) {
  const root = document.getElementById('hud');

  // --- crosshair + hitmarker ---
  const cross = el('div', 'crosshair', root);
  for (const c of ['top', 'right', 'bottom', 'left']) el('div', 'ch-line ' + c, cross);
  el('div', 'ch-dot', cross);
  const hitmark = el('div', 'hitmarker', root);
  for (let i = 0; i < 4; i++) el('div', 'hm-line hm' + i, hitmark);

  // --- top bar: timer, round, score ---
  const topBar = el('div', 'topbar', root);
  const timerEl = el('div', 'timer', topBar, '0:00');
  const roundEl = el('div', 'round', topBar, 'ROUND 1');
  const scoreEl = el('div', 'score', topBar, '0 — 0');
  const spikeEl = el('div', 'spike-status', topBar, '');

  // --- killfeed, banner, objective progress ---
  const feed = el('div', 'killfeed', root);
  const banner = el('div', 'banner', root);
  const bannerTitle = el('div', 'banner-title', banner);
  const bannerSub = el('div', 'banner-sub', banner);
  const objWrap = el('div', 'objective', root);
  const objLabel = el('div', 'objective-label', objWrap);
  const objBar = el('div', 'objective-bar', objWrap);
  const objFill = el('div', 'objective-fill', objBar);

  // --- bottom-left: health / armour; bottom-right: ammo / money ---
  const bl = el('div', 'bl', root);
  el('div', 'lbl', bl, 'HEALTH');
  const hpNum = el('div', 'hp-num', bl, '100');
  const hpBar = el('div', 'hp-bar', bl);
  const hpFill = el('div', 'hp-fill', hpBar);
  const armorEl = el('div', 'armor', bl, '');
  const br = el('div', 'br', root);
  const ammoEl = el('div', 'ammo', br, '12 / 36');
  const weaponEl = el('div', 'weapon-name', br, 'P9');
  const moneyEl = el('div', 'money', br, '$800');
  const nadeEl = el('div', 'nades', br, '');

  const msgEl = el('div', 'msg', root);
  const muteEl = el('div', 'mute-chip', root, 'MUTED');
  muteEl.style.display = 'none';

  // --- buy menu ---
  const buyMenu = el('div', 'buy-menu', root);
  el('div', 'buy-title', buyMenu, 'BUY  —  press B to close');
  const buyRows = [];
  for (const item of BUY_MENU) {
    const row = el('button', 'buy-row', buyMenu);
    row.dataset.buy = item.id;
    row.type = 'button';
    el('span', 'buy-key', row, '[' + item.key + ']');
    el('span', 'buy-label', row, item.label);
    el('span', 'buy-price', row, '$' + item.price);
    row.addEventListener('click', () => callbacks.onBuy(item.id));
    buyRows.push({ item, row });
  }
  buyMenu.style.display = 'none';

  // --- scoreboard (Tab) ---
  const board = el('div', 'scoreboard', root);
  el('div', 'board-title', board, 'SCOREBOARD');
  const boardBody = el('div', 'board-body', board);
  board.style.display = 'none';

  // --- scope overlay for the Longshot ---
  const scope = el('div', 'scope', root);
  scope.style.display = 'none';

  // --- start menu ---
  const menu = document.getElementById('menu');
  const playBtn = document.getElementById('btn-play');
  playBtn.addEventListener('click', () => callbacks.onPlay());
  const againBtn = document.getElementById('btn-again');
  againBtn.addEventListener('click', () => callbacks.onRestart());

  let lastFeedTick = -1;
  let bannerTimer = 0;
  let last = {};

  function setText(node, key, value) {
    if (last[key] !== value) {
      last[key] = value;
      node.textContent = value;
    }
  }

  function addFeed(text, cls = '') {
    const d = el('div', 'feed-line ' + cls, feed, text);
    setTimeout(() => d.remove(), 6000);
    while (feed.children.length > 6) feed.firstChild.remove();
  }

  return {
    update(m, player) {
      // Feed: surface new events since the last frame.
      for (const ev of m.events) {
        if (ev.tick <= lastFeedTick) continue;
        if (ev.type === 'kill') addFeed(ev.text, 'feed-kill');
        else if (ev.type === 'plant') addFeed(ev.text, 'feed-plant');
        else if (ev.type === 'defuse') addFeed(ev.text, 'feed-defuse');
        else if (ev.type === 'explode') addFeed(ev.text, 'feed-explode');
        else if (ev.type === 'round') addFeed(ev.text, 'feed-round');
      }
      if (m.events.length > 0) lastFeedTick = m.events[m.events.length - 1].tick;

      // Timer line depends on the phase.
      let timerText;
      if (m.phase === 'buy') timerText = 'BUY ' + fmtClock(m.phaseT);
      else if (m.phase === 'live') {
        timerText = m.spike.state === 'planted' ? 'SPIKE ' + fmtClock(m.spike.fuseT) : fmtClock(m.phaseT);
      } else if (m.phase === 'post') timerText = 'ROUND OVER';
      else timerText = 'MATCH OVER';
      setText(timerEl, 'timer', timerText);
      setText(roundEl, 'round', 'ROUND ' + m.round + ' / 9');
      setText(scoreEl, 'score', `${m.score.v} — ${m.score.s}`);
      timerEl.classList.toggle('urgent', m.phase === 'live' && m.spike.state === 'planted');

      let spikeText = '';
      if (m.spike.state === 'planted') spikeText = '⚠ SPIKE PLANTED — ' + (m.spike.siteId === 'A' ? 'Foundry' : 'Silo');
      else if (m.spike.state === 'dropped') spikeText = 'Spike is down — pick it up';
      else if (player.hasSpike) spikeText = '◆ You carry the spike — plant at A or B';
      setText(spikeEl, 'spike', spikeText);

      // Health / armour.
      setText(hpNum, 'hp', String(Math.ceil(player.hp)));
      hpFill.style.width = Math.max(0, player.hp) + '%';
      hpFill.style.background = player.hp > 55 ? '#58c96b' : player.hp > 25 ? '#e8b13c' : '#e4572e';
      setText(armorEl, 'armor', player.armor > 0 ? '🛡 ' + Math.ceil(player.armor) : '');

      // Ammo / weapon / money / grenades.
      const w = player.weapon;
      const mag = player.mag ?? 0;
      const reserve = player.reserve ?? 0;
      setText(ammoEl, 'ammo', player.reloading ? 'RELOADING…' : `${mag} / ${reserve}`);
      setText(weaponEl, 'wname', w);
      setText(moneyEl, 'money', '$' + player.money.toLocaleString('en-US'));
      const nades = [];
      if (player.grenades.frag > 0) nades.push(`Frag ×${player.grenades.frag} [G]`);
      if (player.grenades.smoke > 0) nades.push(`Smoke ×${player.grenades.smoke}`);
      setText(nadeEl, 'nades', nades.join('  ·  '));

      // Crosshair gap grows with speed and spray: stopping to aim pays.
      const gap = 5 + player.speed * 1.6 + player.spray * 0.9;
      cross.style.setProperty('--gap', gap.toFixed(1) + 'px');
      cross.style.opacity = player.aiming && w === 'Longshot' ? '0' : '1';
      scope.style.display = player.aiming && w === 'Longshot' ? 'block' : 'none';

      // Plant / defuse progress.
      const plantP = player.plantT > 0 ? player.plantT / 3.5 : 0;
      const defuseP = player.defuseT > 0 ? player.defuseT / 6 : 0;
      if (plantP > 0) {
        objWrap.style.display = 'block';
        objLabel.textContent = 'PLANTING THE SPIKE…';
        objFill.style.width = (plantP * 100).toFixed(0) + '%';
      } else if (defuseP > 0) {
        objWrap.style.display = 'block';
        objLabel.textContent = 'DEFUSING…';
        objFill.style.width = (defuseP * 100).toFixed(0) + '%';
      } else {
        objWrap.style.display = 'none';
      }

      // Buy menu affordability.
      if (buyMenu.style.display !== 'none') {
        for (const { item, row } of buyRows) {
          const afford = player.money >= item.price;
          row.classList.toggle('cant', !afford);
          const owned = item.id === 'frag' ? player.grenades.frag : item.id === 'smoke' ? player.grenades.smoke : 0;
          row.querySelector('.buy-label').textContent = item.label + (owned > 0 ? `  (×${owned})` : '');
        }
      }

      // Scoreboard.
      if (board.style.display !== 'none') {
        let html = '';
        for (const team of ['v', 's']) {
          html += `<div class="board-team">${team === 'v' ? 'VANGUARD' : 'SENTINEL'}</div>`;
          for (const f of m.fighters.filter((x) => x.team === team)) {
            html += `<div class="board-row"><span>${f.name}${f.hasSpike ? ' ◆' : ''}</span><span>${f.kills} / ${f.deaths}</span><span>$${f.money}</span></div>`;
          }
        }
        if (last.board !== html) {
          last.board = html;
          boardBody.innerHTML = html;
        }
      }

      // Banner auto-hide.
      if (bannerTimer > 0) {
        bannerTimer -= 1;
        if (bannerTimer <= 0) banner.style.display = 'none';
      }
    },

    showBanner(title, sub = '', ms = 2600) {
      bannerTitle.textContent = title;
      bannerSub.textContent = sub;
      banner.style.display = 'block';
      bannerTimer = Math.round(ms / 16.7);
    },

    showMessage(text, ms = 3000) {
      msgEl.textContent = text;
      msgEl.style.opacity = '1';
      setTimeout(() => {
        msgEl.style.opacity = '0';
      }, ms);
    },

    flashHit(kill) {
      hitmark.classList.remove('show', 'kill');
      void hitmark.offsetWidth;
      hitmark.classList.add('show');
      if (kill) hitmark.classList.add('kill');
      setTimeout(() => hitmark.classList.remove('show', 'kill'), 140);
    },

    setBuyOpen(open) {
      buyMenu.style.display = open ? 'block' : 'none';
    },
    isBuyOpen() {
      return buyMenu.style.display !== 'none';
    },
    setScoreboard(open) {
      board.style.display = open ? 'block' : 'none';
    },
    setMenu(open) {
      menu.style.display = open ? 'flex' : 'none';
    },
    showEnd(winner, score) {
      const end = document.getElementById('end-screen');
      document.getElementById('end-title').textContent = winner === 'v' ? 'VANGUARD WINS' : 'SENTINEL WINS';
      document.getElementById('end-title').style.color = winner === 'v' ? '#2ec4b6' : '#e4572e';
      document.getElementById('end-score').textContent = `Final score ${score.v} — ${score.s}`;
      end.style.display = 'flex';
    },
    hideEnd() {
      document.getElementById('end-screen').style.display = 'none';
    },
    setMuted(muted) {
      muteEl.style.display = muted ? 'block' : 'none';
    },
  };
}
