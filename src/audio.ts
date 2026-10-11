// Procedural sound: every effect and voice is synthesized live with WebAudio.
import { clamp, rng } from './util.ts';

export type VoiceLine = 'turn' | 'fire' | 'throw' | 'hurt' | 'bigHurt' | 'fear' | 'bye' | 'drown' | 'jump' | 'victory' | 'missed' | 'taunt' | 'oof';

const VOWELS: Record<string, [number, number]> = {
  a: [800, 1200], e: [500, 1900], i: [320, 2300], o: [500, 900], u: [350, 800],
};

interface Syllable {
  v: keyof typeof VOWELS;
  dur: number;
  p0: number;
  p1: number;
  hiss?: number;
  vib?: number;
  vol?: number;
}

const LINES: Record<VoiceLine, Syllable[][]> = {
  turn: [
    [{ v: 'e', dur: 0.09, p0: 1.0, p1: 1.1, hiss: 0.12 }, { v: 'a', dur: 0.16, p0: 1.2, p1: 1.35 }],
    [{ v: 'o', dur: 0.1, p0: 1.0, p1: 1.0 }, { v: 'i', dur: 0.08, p0: 1.1, p1: 1.2 }, { v: 'a', dur: 0.18, p0: 1.3, p1: 1.15 }],
    [{ v: 'u', dur: 0.08, p0: 0.9, p1: 1.0, hiss: 0.1 }, { v: 'e', dur: 0.2, p0: 1.15, p1: 1.4 }],
  ],
  fire: [
    [{ v: 'a', dur: 0.22, p0: 1.3, p1: 1.0, vol: 1.2 }],
    [{ v: 'i', dur: 0.06, p0: 1.2, p1: 1.3 }, { v: 'a', dur: 0.2, p0: 1.45, p1: 1.1, vol: 1.2 }],
  ],
  throw: [
    [{ v: 'u', dur: 0.06, p0: 1.0, p1: 1.1, hiss: 0.06 }, { v: 'a', dur: 0.14, p0: 1.3, p1: 1.0 }],
  ],
  hurt: [
    [{ v: 'o', dur: 0.18, p0: 1.4, p1: 0.9 }],
    [{ v: 'a', dur: 0.08, p0: 1.5, p1: 1.4 }, { v: 'u', dur: 0.14, p0: 1.2, p1: 0.8 }],
  ],
  bigHurt: [
    [{ v: 'a', dur: 0.1, p0: 1.7, p1: 1.6 }, { v: 'o', dur: 0.1, p0: 1.5, p1: 1.3 }, { v: 'u', dur: 0.28, p0: 1.2, p1: 0.7, vib: 9 }],
  ],
  fear: [
    [{ v: 'i', dur: 0.2, p0: 1.8, p1: 2.1, vib: 14 }],
    [{ v: 'e', dur: 0.08, p0: 1.6, p1: 1.7 }, { v: 'i', dur: 0.16, p0: 1.9, p1: 2.2 }],
  ],
  bye: [
    [{ v: 'a', dur: 0.12, p0: 1.1, p1: 1.2 }, { v: 'i', dur: 0.45, p0: 1.25, p1: 0.6, vib: 7 }],
  ],
  drown: [
    [{ v: 'u', dur: 0.16, p0: 0.9, p1: 0.8, vib: 18 }, { v: 'o', dur: 0.16, p0: 0.8, p1: 0.65, vib: 22 }, { v: 'u', dur: 0.22, p0: 0.7, p1: 0.5, vib: 25 }],
  ],
  jump: [
    [{ v: 'u', dur: 0.07, p0: 1.1, p1: 1.3, vol: 0.6 }],
    [{ v: 'a', dur: 0.06, p0: 1.2, p1: 1.4, vol: 0.6 }],
  ],
  victory: [
    [{ v: 'e', dur: 0.1, p0: 1.2, p1: 1.3, hiss: 0.12 }, { v: 'a', dur: 0.09, p0: 1.5, p1: 1.4 }, { v: 'a', dur: 0.09, p0: 1.5, p1: 1.4 }, { v: 'a', dur: 0.2, p0: 1.6, p1: 1.9 }],
  ],
  missed: [
    [{ v: 'a', dur: 0.14, p0: 1.1, p1: 1.0 }, { v: 'o', dur: 0.32, p0: 1.0, p1: 0.7 }],
  ],
  taunt: [
    [{ v: 'e', dur: 0.08, p0: 1.4, p1: 1.4, hiss: 0.08 }, { v: 'e', dur: 0.08, p0: 1.5, p1: 1.5 }, { v: 'e', dur: 0.12, p0: 1.6, p1: 1.7 }],
  ],
  oof: [
    [{ v: 'u', dur: 0.14, p0: 1.0, p1: 0.7, vol: 1.1 }],
  ],
};

class Audio {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private charge: { osc: OscillatorNode; gain: GainNode } | null = null;
  private windGain: GainNode | null = null;
  private waveGain: GainNode | null = null;
  private musicTimer: number | null = null;
  private lastVoice = 0;
  private jet: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private ambSrc: AudioScheduledSourceNode[] = [];
  private out: AudioNode | null = null;
  private tap: MediaStreamAudioDestinationNode | null = null;

  /** Live copy of the final mix for recording (null until audio is unlocked). */
  captureStream(): MediaStream | null {
    if (!this.ctx || !this.out) return null;
    if (!this.tap) {
      this.tap = this.ctx.createMediaStreamDestination();
      this.out.connect(this.tap);
    }
    return this.tap.stream;
  }
  muted = false;
  /** Set while the CPU simulates shots so predictions make no noise. */
  silent = false;

  unlock(): void {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const Ctor = window.AudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0.55;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(ctx.destination);
      this.out = comp;
      this.sfxBus = ctx.createGain();
      this.sfxBus.connect(this.master);
      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = 0.35;
      this.musicBus.connect(this.master);
      const len = ctx.sampleRate * 2;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  toggleMute(): void {
    this.muted = !this.muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.55, this.ctx.currentTime, 0.02);
  }

  private get ok(): boolean {
    return !this.silent && !!this.ctx && this.ctx.state === 'running';
  }

  private tone(f0: number, f1: number, dur: number, type: OscillatorType, vol: number, delay = 0, dest?: AudioNode): void {
    if (!this.ok) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest ?? this.sfxBus!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private burst(dur: number, type: BiquadFilterType, f0: number, f1: number, q: number, vol: number, delay = 0, dest?: AudioNode): void {
    if (!this.ok || !this.noise) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest ?? this.sfxBus!);
    src.start(t, Math.random() * Math.max(0, 1.9 - dur));
    src.stop(t + dur + 0.05);
  }

  explosion(radius: number): void {
    const s = clamp(radius / 32, 0.4, 1.6);
    this.burst(0.9 * s + 0.2, 'lowpass', 3200, 120, 0.7, 0.9);
    this.tone(140, 32, 0.5 * s + 0.15, 'sine', 0.9);
    this.tone(70, 28, 0.6 * s, 'triangle', 0.5);
    for (let i = 0; i < 5; i++) this.burst(0.05, 'highpass', 2500, 1800, 0.5, 0.25, 0.08 + Math.random() * 0.35 * s);
  }
  launch(): void {
    this.burst(0.4, 'bandpass', 500, 2200, 1.2, 0.5);
    this.tone(110, 50, 0.18, 'sine', 0.7);
  }
  throwSwish(): void {
    this.burst(0.18, 'bandpass', 900, 2600, 2, 0.35);
  }
  clink(v: number): void {
    const vol = clamp(v / 4, 0.05, 0.35);
    this.tone(1500 + Math.random() * 200, 1100, 0.07, 'triangle', vol);
    this.tone(3100, 2900, 0.03, 'square', vol * 0.25);
  }
  fuseTick(): void {
    this.tone(1900, 1800, 0.02, 'square', 0.08);
  }
  boing(high: boolean): void {
    const b = high ? 260 : 200;
    this.tone(b, b * 2.6, 0.17, 'triangle', 0.35);
    this.tone(b * 1.5, b * 3.2, 0.12, 'sine', 0.12, 0.02);
  }
  coil(): void {
    this.tone(500, 260, 0.08, 'sine', 0.12);
  }
  land(soft: number): void {
    this.burst(0.09, 'lowpass', 600, 200, 0.7, clamp(soft, 0.06, 0.5));
  }
  thud(): void {
    this.burst(0.18, 'lowpass', 900, 120, 0.8, 0.6);
    this.tone(120, 50, 0.15, 'sine', 0.6);
  }
  slither(): void {
    this.burst(0.06, 'bandpass', 3800, 3000, 3, 0.05);
  }
  splash(big: boolean): void {
    this.burst(big ? 0.7 : 0.35, 'bandpass', 1800, 400, 0.8, big ? 0.6 : 0.3);
    this.burst(0.15, 'highpass', 3000, 2000, 0.5, 0.2);
    for (let i = 0; i < (big ? 6 : 3); i++) this.bubble(0.1 + Math.random() * 0.6);
  }
  bubble(delay = 0): void {
    const f = 300 + Math.random() * 400;
    this.tone(f, f * 2.4, 0.06, 'sine', 0.12, delay);
  }
  beep(urgent: boolean): void {
    this.tone(urgent ? 990 : 880, urgent ? 990 : 880, 0.09, 'square', 0.12);
  }
  blip(): void {
    this.tone(660, 990, 0.06, 'square', 0.1);
  }
  countTick(): void {
    this.tone(1400, 1300, 0.025, 'sine', 0.06);
  }
  pop(): void {
    this.tone(700, 90, 0.14, 'sine', 0.5);
    this.burst(0.1, 'highpass', 2000, 900, 0.7, 0.2);
  }
  jingle(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => this.tone(f, f, 0.12, 'triangle', 0.18, i * 0.075));
    this.tone(1046.5, 1046.5, 0.3, 'square', 0.05, 0.3);
  }
  fanfare(): void {
    const seq = [392, 523.25, 659.25, 784, 659.25, 784, 1046.5];
    seq.forEach((f, i) => this.tone(f, f, 0.16, 'square', 0.12, i * 0.13));
    seq.forEach((f, i) => this.tone(f / 2, f / 2, 0.16, 'triangle', 0.15, i * 0.13));
  }
  bleat(pitch = 1): void {
    if (!this.ok) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const base = 520 * pitch * (0.9 + Math.random() * 0.2);
    o.frequency.setValueAtTime(base, t);
    o.frequency.linearRampToValueAtTime(base * 0.92, t + 0.45);
    const lfo = ctx.createOscillator();
    const lg = ctx.createGain();
    lfo.frequency.value = 22;
    lg.gain.value = base * 0.08;
    lfo.connect(lg).connect(o.frequency);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1400;
    bp.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(bp).connect(g).connect(this.sfxBus!);
    o.start(t);
    lfo.start(t);
    o.stop(t + 0.55);
    lfo.stop(t + 0.55);
  }
  choir(): void {
    const chord = [261.6, 329.6, 392, 523.3, 659.3];
    chord.forEach((f, i) => {
      this.tone(f, f * 1.01, 1.3, 'sawtooth', 0.05, i * 0.02);
      this.tone(f, f, 1.3, 'triangle', 0.08, i * 0.02);
    });
  }
  airhorn(): void {
    const hits: Array<[number, number]> = [[0, 0.22], [0.26, 0.1], [0.4, 0.1], [0.54, 0.45]];
    for (const [d, len] of hits) for (const f of [466, 470, 233]) this.tone(f, f * 0.98, len, 'sawtooth', 0.09, d);
  }
  pianoNote(freq: number, delay = 0): void {
    this.tone(freq, freq, 0.9, 'triangle', 0.3, delay);
    this.tone(freq * 2, freq * 2, 0.4, 'sine', 0.08, delay);
    this.burst(0.03, 'highpass', 3000, 2500, 0.7, 0.08, delay);
  }
  siren(): void {
    for (let i = 0; i < 4; i++) {
      this.tone(600, 900, 0.35, 'square', 0.08, i * 0.7);
      this.tone(900, 600, 0.35, 'square', 0.08, i * 0.7 + 0.35);
    }
  }
  gunshot(): void {
    this.burst(0.12, 'highpass', 1800, 800, 0.6, 0.55);
    this.tone(220, 60, 0.1, 'square', 0.25);
  }
  whoosh(): void {
    this.burst(0.25, 'bandpass', 600, 2400, 1.5, 0.4);
  }
  teleport(): void {
    this.tone(200, 1800, 0.3, 'sine', 0.2);
    this.tone(300, 2400, 0.3, 'triangle', 0.1, 0.05);
  }
  twang(): void {
    this.tone(180, 120, 0.25, 'sawtooth', 0.15);
    this.burst(0.1, 'bandpass', 2500, 1500, 3, 0.15);
  }
  coin(): void {
    this.tone(988, 988, 0.08, 'square', 0.12);
    this.tone(1319, 1319, 0.25, 'square', 0.12, 0.08);
  }
  mineBeep(): void {
    this.tone(1500, 1500, 0.06, 'square', 0.12);
  }
  crackle(): void {
    this.burst(0.04, 'highpass', 4000, 3000, 0.5, 0.06);
  }
  gurgle(): void {
    for (let i = 0; i < 3; i++) this.bubble(i * 0.07);
  }
  whistle(): void {
    this.tone(2400, 700, 0.9, 'sine', 0.08);
  }
  burstGlass(): void {
    this.burst(0.25, 'highpass', 5000, 3000, 1, 0.35);
    for (let i = 0; i < 4; i++) this.tone(2500 + Math.random() * 2000, 2000, 0.05, 'triangle', 0.08, i * 0.03);
  }
  jetStart(): void {
    if (!this.ok || !this.noise || this.jet) return;
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 900;
    f.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    src.connect(f).connect(gain).connect(this.sfxBus!);
    src.start();
    this.jet = { src, gain };
  }
  jetLevel(v: number): void {
    if (!this.jet || !this.ctx) return;
    this.jet.gain.gain.setTargetAtTime(0.02 + v * 0.18, this.ctx.currentTime, 0.03);
  }
  jetStop(): void {
    if (!this.jet || !this.ctx) return;
    this.jet.gain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.03);
    this.jet.src.stop(this.ctx.currentTime + 0.2);
    this.jet = null;
  }

  chargeStart(): void {
    if (!this.ok || this.charge) return;
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = 180;
    gain.gain.value = 0.0001;
    gain.gain.exponentialRampToValueAtTime(0.06, ctx.currentTime + 0.05);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1400;
    osc.connect(f).connect(gain).connect(this.sfxBus!);
    osc.start();
    this.charge = { osc, gain };
  }
  chargeUpdate(power: number): void {
    if (!this.charge || !this.ctx) return;
    this.charge.osc.frequency.setTargetAtTime(180 + power * 700, this.ctx.currentTime, 0.02);
  }
  chargeStop(): void {
    if (!this.charge || !this.ctx) return;
    const { osc, gain } = this.charge;
    gain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.02);
    osc.stop(this.ctx.currentTime + 0.1);
    this.charge = null;
  }

  /** Babble voice: formant-filtered buzz with a snake hiss on some syllables. */
  voice(line: VoiceLine, pitch: number, force = false): void {
    if (!this.ok || !this.noise) return;
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    if (!force && now - this.lastVoice < 0.25) return;
    this.lastVoice = now;
    const variants = LINES[line];
    const syl = variants[Math.floor(Math.random() * variants.length)]!;
    const base = 210 * pitch * (0.94 + Math.random() * 0.12);
    let t = now + 0.01;
    for (const s of syl) {
      if (s.hiss) {
        this.burst(s.hiss, 'highpass', 5200, 4200, 0.7, 0.18, t - now);
        t += s.hiss * 0.8;
      }
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(base * s.p0, t);
      o.frequency.exponentialRampToValueAtTime(base * s.p1, t + s.dur);
      if (s.vib) {
        const lfo = ctx.createOscillator();
        const lg = ctx.createGain();
        lfo.frequency.value = s.vib;
        lg.gain.value = base * 0.06;
        lfo.connect(lg).connect(o.frequency);
        lfo.start(t);
        lfo.stop(t + s.dur + 0.03);
      }
      const [f1, f2] = VOWELS[s.v]!;
      const g = ctx.createGain();
      const vol = 0.32 * (s.vol ?? 1);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
      g.gain.setValueAtTime(vol, t + s.dur * 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, t + s.dur);
      for (const [fq, q, amp] of [[f1, 6, 1], [f2, 9, 0.6]] as Array<[number, number, number]>) {
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = fq * (0.95 + Math.random() * 0.1);
        bp.Q.value = q;
        const ag = ctx.createGain();
        ag.gain.value = amp * 3;
        o.connect(bp).connect(ag).connect(g);
      }
      g.connect(this.sfxBus!);
      o.start(t);
      o.stop(t + s.dur + 0.03);
      t += s.dur + 0.025;
    }
  }

  /** Looping waves and wind bed for the island. */
  startAmbience(): void {
    if (!this.ok || !this.noise || this.waveGain) return;
    const ctx = this.ctx!;
    const mk = (type: BiquadFilterType, freq: number, q: number): [AudioBufferSourceNode, GainNode] => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(this.sfxBus!);
      src.start();
      return [src, g];
    };
    const [waveSrc, wave] = mk('lowpass', 420, 0.6);
    const lfo = ctx.createOscillator();
    const lg = ctx.createGain();
    lfo.frequency.value = 0.13;
    lg.gain.value = 0.035;
    lfo.connect(lg).connect(wave.gain);
    lfo.start();
    wave.gain.value = 0.05;
    this.waveGain = wave;
    const [windSrc, wind] = mk('bandpass', 700, 0.5);
    this.windGain = wind;
    this.ambSrc = [waveSrc, windSrc, lfo];
  }
  stopAmbience(): void {
    for (const s of this.ambSrc) s.stop();
    this.ambSrc = [];
    this.waveGain = null;
    this.windGain = null;
    this.jetStop();
    this.chargeStop();
  }
  setWind(w: number): void {
    if (!this.windGain || !this.ctx) return;
    this.windGain.gain.setTargetAtTime(0.015 + Math.abs(w) * 0.07, this.ctx.currentTime, 0.8);
  }

  /** Looping theme music (title and menus). */
  startMusic(m: { scale: number[]; root: number; bpm: number; lead: OscillatorType } = { scale: [0, 1, 4, 5, 7, 8, 11, 12, 13, 16], root: 220, bpm: 112, lead: 'square' }): void {
    if (!this.ok || this.musicTimer !== null) return;
    const ctx = this.ctx!;
    const step = 60 / m.bpm / 2;
    const scale = m.scale;
    const root = m.root;
    const f = (deg: number, oct = 0): number => root * Math.pow(2, (scale[((deg % 10) + 10) % 10]! + 12 * oct) / 12);
    const melody = [4, -1, 3, 2, 1, -1, 2, 1, 0, -1, -1, 1, 2, 3, 4, -1, 6, 5, 4, -1, 3, 2, 3, -1, 2, 1, 0, -1, 1, 0, -1, -1];
    let i = 0;
    let next = ctx.currentTime + 0.1;
    const tick = (): void => {
      if (!this.ctx) return;
      while (next < this.ctx.currentTime + 0.25) {
        const d = melody[i % melody.length]!;
        const at = next - this.ctx.currentTime;
        if (d >= 0) {
          this.tone(f(d, 1), f(d, 1) * 0.995, step * 0.9, m.lead, 0.07, at, this.musicBus!);
          this.tone(f(d, 1), f(d, 1), step * 0.9, 'triangle', 0.09, at, this.musicBus!);
        }
        if (i % 4 === 0) this.tone(root / 2, root / 2, step * 1.8, 'triangle', 0.22, at, this.musicBus!);
        if (i % 8 === 4) this.tone(f(4) / 2, f(4) / 2, step * 1.8, 'triangle', 0.16, at, this.musicBus!);
        if (i % 4 === 0) this.tone(150, 45, 0.12, 'sine', 0.35, at, this.musicBus!);
        if (i % 2 === 1) this.burst(0.04, 'highpass', 7000, 6000, 0.7, 0.05, at, this.musicBus!);
        if (i % 8 === 6 && rng.chance(0.5)) this.burst(0.12, 'bandpass', 1800, 900, 1, 0.12, at, this.musicBus!);
        next += step;
        i++;
      }
    };
    tick();
    this.musicTimer = window.setInterval(tick, 50);
  }
  stopMusic(): void {
    if (this.musicTimer !== null) window.clearInterval(this.musicTimer);
    this.musicTimer = null;
  }
}

export const sfx = new Audio();
