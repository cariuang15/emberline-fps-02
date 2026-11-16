[![threejs-fps-01](https://make.fun/badge/threejs-fps-01.svg)](https://make.fun/bounty/threejs-fps-01)
[![rank](https://make.fun/badge/threejs-fps-01/cariuang15/emberline-fps-02/rank.svg)](https://make.fun/bounty/threejs-fps-01)
[![reward](https://make.fun/badge/threejs-fps-01/cariuang15/emberline-fps-02/reward.svg)](https://make.fun/bounty/threejs-fps-01)

# Emberline — Kestrel Yard

A round-based tactical FPS in the style Counter-Strike made famous, built
original from the ground up on three.js 0.187.0. 4v4, first to 5 rounds.
Vanguard attack with a spike; Sentinel defend two sites — Foundry (A) and
Silo (B) — across a three-lane container yard. Buy weapons between rounds,
plant or defuse, and mind the crossfire: bots hold their fire when a
teammate is in the way, and smoke really does block their sight.

## Play it

```sh
node serve.ts
# open http://localhost:8080
```

No build step, no network request, no account. Static files only.

## Controls

| Key | Action |
| --- | --- |
| W A S D | Move |
| Mouse | Look (click to lock) |
| Click | Fire |
| Right-click | Aim (scope on the Longshot) |
| R | Reload |
| E (hold) | Plant the spike / defuse (3.5 s plant, 6 s defuse) |
| B | Buy menu (buy phase, 12 s) |
| G / H | Throw frag / smoke grenade |
| 1 / 2 | Switch weapon |
| C | Crouch |
| Shift | Walk slow (accurate) |
| Tab | Scoreboard |
| M | Mute |

## The game

- **Rounds:** 100 seconds, first to 5 (max 9). Win by eliminating the
  other team, or by planting the spike and letting its 35-second fuse run
  out. Sentinel win by running the clock out or defusing.
- **Economy:** start $800; round win +$325, loss +$190, kill +$300,
  plant +$300. P9 pistol free; MP9 $900; VK-47 $1,700; Longshot sniper
  $2,600; kevlar $650; frag $300; smoke $250.
- **Gunplay:** hitscan with headshots, recoil and spread that grow while
  moving or spraying, reloads, running dry, crouching and collision.
- **Bots:** seven bots with A* pathing over the lane graph, vision cones,
  hearing, burst fire, lane variation, planting, defusing, retakes,
  escorting the carrier, auto-buying — and a carrier that smokes the site
  before planting. Both teams share the same aim and reaction, so no side
  feels like it is cheating.
- **Simulation:** fixed-step 60 Hz, separated from rendering, seeded RNG
  (mulberry32) — the same seed replays byte-identically. `?seed=N` picks
  a seed; `?shot=start|combat|buy|end&seed=1` stages a screenshot pose.
- **Sound:** everything synthesised with WebAudio — no audio files.

## Layout

```
game/
  index.html          entry point + HUD shell
  src/
    util.js           seeded RNG + math helpers
    audio.js          synthesised WebAudio sounds
    weapons.js        weapon / grenade / economy tables
    world.js          map, nav graph, collision, sight
    fighters.js       fighter state, damage, buying
    sim.js            fixed-step match logic (Node-testable)
    bots.js           bot AI
    render.js         three.js scene
    hud.js            DOM HUD + buy menu + scoreboard
    main.js           boot + input + game loop
  vendor/three/       three.js 0.187.0 (kit copy, byte for byte)
main.ts               builds out/dossier.json (Node 22, stdlib only)
serve.ts              static server for local play
```

## License

MIT — see [LICENSE](LICENSE).
