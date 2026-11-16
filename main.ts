// main.ts — the entrypoint (Node 22, standard library only).
// It hands the game in: it copies this repository's game/ and
// screenshots/ into the output directory and writes dossier.json with
// the kit's buildDossier library, so the judge reads exactly the game
// that is served here. Run it locally with:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Outside the grader, MAKEFUN_OUTPUT_DIR stands in for /output.
// The run is deterministic: two runs write byte-identical files.

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

// The scorer's caps for this competition (see the kit's RULES.txt):
// the dossier text is capped at 160 KiB, at most 4 screenshots of at
// most 256 KiB each, game/ holds at most 993 files and 48 MiB.
const TEXT_MAX_BYTES = 163840;
const MAX_SCREENSHOTS = 4;
const MAX_SCREENSHOT_BYTES = 262144;
const GAME_MAX_FILES = 993;
const GAME_MAX_BYTES = 50331648;

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

function fail(message) {
  throw new Error(`main.ts: ${message}`);
}

function countGameFiles(dir) {
  let files = 0;
  let bytes = 0;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) {
      const sub = countGameFiles(path);
      files += sub.files;
      bytes += sub.bytes;
    } else if (st.isFile()) {
      files += 1;
      bytes += st.size;
    }
  }
  return { files, bytes };
}

const gameDir = join(here, 'game');
if (!existsSync(gameDir)) fail('game/ is missing next to main.ts');
const gameSize = countGameFiles(gameDir);
if (gameSize.files > GAME_MAX_FILES) fail(`game/ holds ${gameSize.files} files, over the ${GAME_MAX_FILES} cap`);
if (gameSize.bytes > GAME_MAX_BYTES) fail(`game/ is ${gameSize.bytes} bytes, over the ${GAME_MAX_BYTES} cap`);

const shotsDir = join(here, 'screenshots');
if (!existsSync(shotsDir)) fail('screenshots/ is missing next to main.ts');
const shots = readdirSync(shotsDir).filter((n) => !n.startsWith('.')).sort();
if (shots.length < 3 || shots.length > MAX_SCREENSHOTS) {
  fail(`screenshots/ holds ${shots.length} images, need 3 to ${MAX_SCREENSHOTS}`);
}
for (const name of shots) {
  const size = statSync(join(shotsDir, name)).size;
  if (size > MAX_SCREENSHOT_BYTES) fail(`screenshots/${name} is ${size} bytes, over the ${MAX_SCREENSHOT_BYTES} cap`);
}

mkdirSync(out, { recursive: true });
cpSync(gameDir, join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
cpSync(shotsDir, join(out, 'screenshots'), { recursive: true });

writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: { max: MAX_SCREENSHOTS, max_bytes: MAX_SCREENSHOT_BYTES },
    game_max_files: GAME_MAX_FILES,
    game_max_bytes: GAME_MAX_BYTES,
  }),
);

console.log(`dossier written to ${join(out, 'dossier.json')} (${shots.length} screenshots, ${gameSize.files} game files)`);
