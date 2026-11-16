// audio.js — every sound in the game is synthesised with WebAudio:
// no audio files, no network, nothing to download. Oscillators and a
// shared noise buffer make the shots, clicks, beeps and booms. All calls
// are guarded: in a headless browser (or before the first user gesture)
// the context may not exist, and the game must never crash for that.

export function createAudio() {
  const api = {
    muted: false,
    ctx: null,
    master: null,
    noiseBuf: null,
  };

  function ensure() {
    if (api.ctx) return true;
    try {
      const Ctx = window.AudioContext ?? window.webkitAudioContext;
      if (!Ctx) return false;
      api.ctx = new Ctx();
      api.master = api.ctx.createGain();
      api.master.gain.value = 0.5;
      api.master.connect(api.ctx.destination);
      const len = api.ctx.sampleRate * 1;
      api.noiseBuf = api.ctx.createBuffer(1, len, api.ctx.sampleRate);
      const data = api.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      return true;
    } catch {
      return false;
    }
  }

  function resume() {
    if (api.ctx && api.ctx.state === 'suspended') api.ctx.resume().catch(() => {});
  }

  /** Short noise burst through a low-pass filter. */
  function noise(dur, filterFreq, gainVal, when = 0) {
    if (!ensure()) return;
    resume();
    const t = api.ctx.currentTime + when;
    const src = api.ctx.createBufferSource();
    src.buffer = api.noiseBuf;
    src.loop = true;
    const filt = api.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = filterFreq;
    const g = api.ctx.createGain();
    g.gain.setValueAtTime(gainVal, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filt).connect(g).connect(api.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.02);
  }

  /** One oscillator tone with an exponential decay. */
  function tone(freq, dur, type, gainVal, slideTo = null, when = 0) {
    if (!ensure()) return;
    resume();
    const t = api.ctx.currentTime + when;
    const o = api.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo !== null) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = api.ctx.createGain();
    g.gain.setValueAtTime(gainVal, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(api.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function unlock() {
    ensure();
    resume();
  }

  return {
    unlock,
    setMuted(m) {
      api.muted = !!m;
      if (api.master) api.master.gain.value = api.muted ? 0 : 0.5;
    },
    isMuted() {
      return api.muted;
    },
    shot(weaponId) {
      if (api.muted) return;
      if (weaponId === 'longshot') {
        noise(0.28, 900, 0.9);
        tone(160, 0.18, 'square', 0.25, 60);
      } else if (weaponId === 'vk47') {
        noise(0.12, 1400, 0.7);
        tone(220, 0.08, 'square', 0.18, 90);
      } else if (weaponId === 'mp9') {
        noise(0.08, 1800, 0.5);
      } else {
        noise(0.09, 1600, 0.55);
        tone(300, 0.06, 'square', 0.12, 120);
      }
    },
    dryFire() {
      if (api.muted) return;
      tone(900, 0.04, 'square', 0.1);
    },
    reload() {
      if (api.muted) return;
      tone(500, 0.05, 'square', 0.15);
      tone(700, 0.05, 'square', 0.15, null, 0.18);
    },
    hit() {
      if (api.muted) return;
      tone(1200, 0.06, 'sine', 0.25);
    },
    kill() {
      if (api.muted) return;
      tone(880, 0.09, 'sine', 0.3);
      tone(1320, 0.12, 'sine', 0.25, null, 0.08);
    },
    hurt() {
      if (api.muted) return;
      tone(140, 0.15, 'sawtooth', 0.2, 70);
    },
    plantBeep() {
      if (api.muted) return;
      tone(1000, 0.08, 'sine', 0.2);
    },
    beep() {
      if (api.muted) return;
      tone(660, 0.07, 'sine', 0.2);
    },
    defuseBeep() {
      if (api.muted) return;
      tone(520, 0.07, 'sine', 0.2);
    },
    explosion() {
      if (api.muted) return;
      noise(1.4, 320, 1.0);
      tone(70, 1.1, 'sine', 0.7, 28);
    },
    footstep() {
      if (api.muted) return;
      noise(0.05, 500, 0.12);
    },
    buy() {
      if (api.muted) return;
      tone(740, 0.06, 'sine', 0.2);
      tone(990, 0.09, 'sine', 0.2, null, 0.07);
    },
    deny() {
      if (api.muted) return;
      tone(180, 0.12, 'square', 0.15);
    },
    roundWin() {
      if (api.muted) return;
      tone(523, 0.14, 'sine', 0.25);
      tone(659, 0.14, 'sine', 0.25, null, 0.13);
      tone(784, 0.22, 'sine', 0.25, null, 0.26);
    },
    roundLose() {
      if (api.muted) return;
      tone(392, 0.16, 'sine', 0.22);
      tone(311, 0.24, 'sine', 0.22, null, 0.15);
    },
    click() {
      if (api.muted) return;
      tone(800, 0.04, 'square', 0.12);
    },
  };
}
