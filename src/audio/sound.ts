import { load, save } from '../storage/storage';
import { BALANCE } from '../config/balance';
import { Soundtrack } from './soundtrack';

export type Sfx = 'start' | 'shield' | 'slow' | 'clear' | 'magnet' | 'glide' | 'land' | 'boost' | 'guide' | 'shieldHit' | 'crash' | 'record' | 'effectEnd' | 'nearMiss' | 'rushStart' | 'rushEnd' | 'rushTick' | 'laneWarn' | 'zap' | 'slash' | 'gate' | 'wave' | 'rushPass';

type Ctx = AudioContext;

/**
 * Synthetisierte Originalsounds (Web Audio, keine Dateien). Der Kontext entsteht erst in `unlock()`
 * aus einer Benutzergeste; ohne Audio bleibt das Spiel voll nutzbar (alle Methoden sind dann No-Ops).
 */
export class Sound {
  muted: boolean;
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  /** Gruppenpegel (Admin-Standardwerte): Motor/Flug und Effekte; die persönliche Stummschaltung wirkt weiter auf den Master. */
  private engBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private engine: { g: GainNode; o1: OscillatorNode; o2: OscillatorNode; lp: BiquadFilterNode; ng: GainNode } | null = null;
  private squeal: { g: GainNode; f: BiquadFilterNode } | null = null;
  private engineOn = false;
  private musicGain: GainNode | null = null;
  private musicTimer: ReturnType<typeof setInterval> | undefined;
  private musicOn = false;
  private step = 0;
  private nextT = 0;
  private noiseBuf: AudioBuffer | null = null;
  private flight: { g: GainNode; nf: BiquadFilterNode; o1: OscillatorNode; o2: OscillatorNode; wf: BiquadFilterNode; rg: GainNode } | null = null;

  private track = new Soundtrack();

  constructor() {
    this.muted = load().muted;
    // Aufnahme erst nach dem Laden einwechseln (nur falls Musik schon läuft); Synth-Takt endet dann sauber
    this.track.onReady = () => { if (this.musicOn && this.ctx && this.musicGain) { this.halt(); this.track.start(this.ctx, this.musicGain); } };
  }

  private halt(): void { if (this.musicTimer !== undefined) clearInterval(this.musicTimer); this.musicTimer = undefined; this.padBus?.gain.setTargetAtTime(0, this.ctx!.currentTime, 0.3); }

  setMuted(m: boolean): void {
    this.muted = m;
    save({ muted: m });
    this.applyMaster();
  }
  toggle(): boolean { this.setMuted(!this.muted); return this.muted; }

  private applyMaster(): void {
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, this.ctx.currentTime, 0.02);
  }

  /** Aus einer echten Benutzergeste aufrufen. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.9;
        const comp = this.ctx.createDynamicsCompressor();
        const warm = this.ctx.createBiquadFilter(); warm.type = 'lowpass'; warm.frequency.value = 11000;
        this.master.connect(warm).connect(comp).connect(this.ctx.destination);
        this.engBus = this.ctx.createGain(); this.engBus.connect(this.master);
        this.sfxBus = this.ctx.createGain(); this.sfxBus.connect(this.master);
        this.applyLevels();
        const len = this.ctx.sampleRate;
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      if (typeof fetch === 'function') void this.track.load(this.ctx as AudioContext);
    } catch { this.ctx = null; }
  }

  private ready(): Ctx | null {
    return this.ctx && this.master && this.ctx.state !== 'closed' ? this.ctx : null;
  }

  // ---------- Fahrloop ----------
  startLoops(): void {
    const c = this.ready();
    if (!c || this.engineOn) return;
    this.engineOn = true;
    if (!this.engine) {
      const g = c.createGain(); g.gain.value = 0;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
      const o1 = c.createOscillator(); o1.type = 'triangle'; o1.frequency.value = 70;
      const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = 35;
      const g2 = c.createGain(); g2.gain.value = 0.5;
      o1.connect(lp); o2.connect(g2).connect(lp); lp.connect(g).connect(this.engBus!);
      // leises Fahrgeräusch (gefiltertes Rauschen)
      const n = c.createBufferSource(); n.buffer = this.noiseBuf; n.loop = true;
      const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 700; nf.Q.value = 0.6;
      const ng = c.createGain(); ng.gain.value = 0;
      n.connect(nf).connect(ng).connect(this.engBus!);
      o1.start(); o2.start(); n.start();
      this.engine = { g, o1, o2, lp, ng };
      // Reifenquietschen: genau eine Schleife (gefiltertes Rauschen), Pegel folgt dem Schlupf
      const sn = c.createBufferSource(); sn.buffer = this.noiseBuf; sn.loop = true;
      const sf = c.createBiquadFilter(); sf.type = 'bandpass'; sf.frequency.value = 1900; sf.Q.value = 9;
      const sg = c.createGain(); sg.gain.value = 0;
      sn.connect(sf).connect(sg).connect(this.engBus!);
      sn.start();
      this.squeal = { g: sg, f: sf };
    }
    const t = c.currentTime;
    this.engine.g.gain.cancelScheduledValues(t);
    this.engine.g.gain.setTargetAtTime(0.045, t, 0.12);
    this.startMusic();
  }

  stopLoops(): void {
    const c = this.ready();
    this.engineOn = false;
    this.stopMusic();
    if (!c || !this.engine) return;
    const t = c.currentTime;
    this.engine.g.gain.cancelScheduledValues(t);
    this.engine.g.gain.setTargetAtTime(0, t, 0.08);
    this.engine.ng.gain.setTargetAtTime(0, t, 0.08);
    this.squeal?.g.gain.setTargetAtTime(0, t, 0.05);
    this.setFlight(false);
    this.setRush(false);
  }

  /** Tempo- und lastabhängige Motorparameter. */
  update(speedKmh: number, turbo: boolean, slip = 0): void {
    const c = this.ready();
    if (!c || !this.engine || !this.engineOn) return;
    // 100…600 km/h: Tonhöhe, Filter und Lautstärke wachsen durchgehend (360, 500 und 600 km/h klingen deutlich verschieden)
    const k = Math.min(1, Math.max(0, (speedKmh - 100) / 500));
    this.speedK = Math.min(1, Math.max(0, (speedKmh - 250) / 350));
    const f = 62 + k * 150 + (turbo ? 18 : 0);
    const t = c.currentTime;
    this.engine.o1.frequency.setTargetAtTime(f, t, 0.05);
    this.engine.o2.frequency.setTargetAtTime(f / 2, t, 0.05);
    this.engine.lp.frequency.setTargetAtTime(320 + k * 900 + (turbo ? 500 : 0), t, 0.08);
    this.engine.g.gain.setTargetAtTime(0.035 + k * 0.03 + (turbo ? 0.02 : 0), t, 0.1);
    this.engine.ng.gain.setTargetAtTime(0.008 + k * 0.045, t, 0.1);
    if (this.squeal) {
      this.squeal.g.gain.setTargetAtTime(slip > 0.02 ? 0.025 + 0.06 * Math.min(1, slip) : 0, t, slip > 0.02 ? 0.04 : 0.1);
      this.squeal.f.frequency.setTargetAtTime(1700 + 900 * Math.min(1, slip) + k * 300, t, 0.05);
    }
  }

  // ---------- Musik: eigenes 80er-Las-Vegas-Thema „Neon Vegas" in A-Dur (124 BPM, Shuffle, 32 Takte ≈ 62 s) ----------
  // Eigene Komposition. Aufbau: Intro-Riff (Brass-Stabs) · Strophe ×2 · Pre-Chorus mit Snare-Aufbau und Glocken-Lauf · Fanfaren-Refrain ×2 ·
  // Break (Riff, halbes Tempo) · Schluss-Refrain. Klang: Shuffle-Groove (geswingte Achtel), Four-on-the-floor-Bassdrum, Gated-Snare, offene Hats auf dem
  // Offbeat, laufender Walking-Synthbass mit chromatischem Zielton, Neun-Akkorde (Showband-Harmonik), Synth-Brass-Stabs und -Lead, Slot-Machine-Glöckchen.
  /** Akkorde: Bass-Grundton, Terz für den Bass und Voicing (MIDI). */
  private static CH: Record<string, { root: number; third: number; notes: number[] }> = {
    A: { root: 45, third: 4, notes: [55, 59, 61, 64] },      // A9 (7–9–3–5)
    D: { root: 38, third: 4, notes: [60, 64, 66, 69] },      // D9
    E: { root: 40, third: 4, notes: [62, 66, 68, 71] },      // E9
    F: { root: 42, third: 3, notes: [57, 61, 64, 66] },      // F#m7
  };
  /** Melodien je Takt: [Schritt, MIDI, Länge in 16teln]. „hook" ist die Vegas-Fanfare (kurz–kurz–lang, zweimal, dann Antwort). */
  private static LEADS: Record<string, [number, number, number][][]> = {
    verse: [
      [[0, 76, 2], [2, 76, 2], [4, 79, 2], [6, 81, 6], [12, 79, 2], [14, 76, 2]], [[0, 74, 2], [2, 74, 2], [4, 76, 2], [6, 78, 6], [12, 76, 2], [14, 74, 2]],
      [[0, 76, 2], [2, 76, 2], [4, 79, 2], [6, 81, 4], [10, 83, 2], [12, 85, 4]], [[0, 83, 4], [4, 81, 2], [6, 80, 2], [8, 76, 8]],
    ],
    pre: [
      [[0, 78, 6], [6, 78, 2], [8, 81, 8]], [[0, 80, 6], [6, 80, 2], [8, 83, 8]],
      [[0, 81, 6], [6, 83, 2], [8, 85, 8]], [[0, 86, 4], [4, 85, 4], [8, 83, 2], [10, 85, 2], [12, 88, 4]],
    ],
    hook: [
      [[0, 85, 2], [2, 85, 2], [4, 88, 4], [8, 88, 2], [10, 85, 2], [12, 81, 4]], [[0, 86, 2], [2, 86, 2], [4, 85, 4], [8, 81, 4], [12, 78, 4]],
      [[0, 85, 2], [2, 85, 2], [4, 88, 4], [8, 90, 4], [12, 88, 4]], [[0, 86, 6], [6, 83, 2], [8, 80, 8]],
    ],
    hookEnd: [
      [[0, 85, 2], [2, 85, 2], [4, 88, 4], [8, 88, 2], [10, 85, 2], [12, 81, 4]], [[0, 86, 2], [2, 86, 2], [4, 85, 4], [8, 81, 4], [12, 78, 4]],
      [[0, 85, 2], [2, 85, 2], [4, 88, 4], [8, 90, 4], [12, 88, 4]], [[0, 83, 4], [4, 85, 4], [8, 88, 8]],
    ],
  };
  /** Acht Abschnitte zu je vier Takten. drums: full | build | half; stab: Brass-Riff; arp: Slot-Machine-Glöckchen; big: Refrain-Fülle. */
  private static FORM: { ch: string[]; lead?: string; drums: 'full' | 'build' | 'half'; stab?: boolean; arp?: boolean; big?: boolean }[] = [
    { ch: ['A', 'D', 'A', 'E'], drums: 'full', stab: true },                       // Intro-Riff
    { ch: ['A', 'D', 'A', 'E'], lead: 'verse', drums: 'full' },                    // Strophe
    { ch: ['A', 'D', 'A', 'E'], lead: 'verse', drums: 'full', arp: true },         // Strophe 2
    { ch: ['D', 'E', 'D', 'E'], lead: 'pre', drums: 'build', arp: true },          // Pre-Chorus
    { ch: ['A', 'F', 'D', 'E'], lead: 'hook', drums: 'full', arp: true, big: true },    // Refrain
    { ch: ['A', 'F', 'D', 'E'], lead: 'hookEnd', drums: 'full', arp: true, big: true }, // Refrain 2
    { ch: ['A', 'D', 'A', 'E'], drums: 'half', stab: true, arp: true },            // Break
    { ch: ['A', 'F', 'D', 'E'], lead: 'hookEnd', drums: 'full', arp: true, big: true }, // Schluss-Refrain
  ];
  /** Rhythmus des Brass-Riffs (Schritt, Länge in 16teln): Showband-Hits, gleiche Figur in jedem Takt (Schritte 6 und 10 swingen). */
  private static STAB: [number, number][] = [[0, 3], [4, 2], [6, 2], [10, 2], [12, 4]];
  private static BPM = 124;
  private light = 0;
  private speedK = 0;
  private padBus: GainNode | null = null;
  private delayIn: GainNode | null = null;

  /** Distanzabhängige Lichtphase (0 Sonne … 1 Nacht): blendet hellere Lagen und Glanz ein, ohne den Rhythmus zu brechen. */
  setLight(lt: number): void { this.light = Math.max(0, Math.min(1, lt)); }
  /** Neuer Versuch: Stück beginnt wieder vorn. */
  newRun(): void { this.step = 0; }

  /** Musikbus (weich und unter den Effekten). */
  private static MUSIC_BASE = 0.55;
  private static get MUSIC_BUS(): number { return Sound.MUSIC_BASE * BALANCE.audio.music; }

  /** Übernimmt die Standardpegel der Konfiguration (Musik wirkt ab dem nächsten Ducking-Schritt, Motor und Effekte sofort). */
  applyLevels(): void {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    this.engBus?.gain.setTargetAtTime(BALANCE.audio.engine, t, 0.05);
    this.sfxBus?.gain.setTargetAtTime(BALANCE.audio.sfx, t, 0.05);
    if (this.musicGain && this.musicOn) this.musicGain.gain.setTargetAtTime(Sound.MUSIC_BUS, t, 0.1);
  }

  /** Kurzes, dezentes Ducking der Musik für wichtige Signale. */
  private duck(sec: number): void {
    const c = this.ready();
    if (!c || !this.musicGain || !this.musicOn) return;
    const t = c.currentTime;
    this.musicGain.gain.cancelScheduledValues(t);
    this.musicGain.gain.setTargetAtTime(Sound.MUSIC_BUS * 0.55, t, 0.02);
    this.musicGain.gain.setTargetAtTime(Sound.MUSIC_BUS, t + sec, 0.15);
  }

  /** Musik schon auf dem Startbildschirm: legt den Audiokontext an (Browser geben ihn oft erst nach der ersten Geste frei) und startet die Musik-Schleife. */
  menuMusic(): void { this.unlock(); this.startMusic(); }

  private startMusic(): void {
    const c = this.ready();
    if (!c || this.musicOn) return;
    this.musicOn = true;
    if (!this.musicGain) {
      this.musicGain = c.createGain(); this.musicGain.connect(this.master!);
      // Pad-/Bass-Bus (Sidechain-Pumpen auf der Bassdrum) und gemeinsamer Echo-Bus (punktierte Achtel)
      this.padBus = c.createGain(); this.padBus.connect(this.musicGain);
      const dl = c.createDelay(1); dl.delayTime.value = (60 / Sound.BPM) * 0.75;
      const fb = c.createGain(); fb.gain.value = 0.34;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
      const wet = c.createGain(); wet.gain.value = 0.5;
      this.delayIn = c.createGain();
      this.delayIn.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(wet); wet.connect(this.musicGain);
    }
    this.musicGain.gain.cancelScheduledValues(c.currentTime);
    this.musicGain.gain.setTargetAtTime(Sound.MUSIC_BUS, c.currentTime, 0.2);
    if (this.track.available) { this.padBus?.gain.setTargetAtTime(0, c.currentTime, 0.05); this.track.start(c as AudioContext, this.musicGain); return; }
    this.nextT = c.currentTime + 0.08;
    if (this.musicTimer !== undefined) clearInterval(this.musicTimer);
    this.musicTimer = setInterval(() => this.schedule(), 40);
  }

  private stopMusic(): void {
    this.musicOn = false;
    if (this.track.playing && this.ctx) this.track.stop(this.ctx as AudioContext);
    if (this.musicTimer !== undefined) clearInterval(this.musicTimer);
    this.musicTimer = undefined;
    const c = this.ready();
    if (c && this.musicGain) this.musicGain.gain.setTargetAtTime(0, c.currentTime, 0.1);
  }

  private midiHz(m: number): number { return 440 * Math.pow(2, (m - 69) / 12); }

  /** Weicher, gefilterter Einzelton mit optionalem Echo-Send. */
  private mnote(midi: number, t: number, dur: number, type: OscillatorType, vol: number, cutoff: number, opt: { detune?: number; dest?: AudioNode; send?: number; attack?: number; vib?: number } = {}): void {
    const c = this.ctx!;
    const o = c.createOscillator(); o.type = type; o.frequency.value = this.midiHz(midi);
    o.detune.setValueAtTime(opt.detune ?? 0, t);
    if (opt.vib) { o.detune.linearRampToValueAtTime((opt.detune ?? 0) + opt.vib, t + dur * 0.6); o.detune.linearRampToValueAtTime(opt.detune ?? 0, t + dur); }
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff; f.Q.value = 0.7;
    const g = c.createGain();
    const at = opt.attack ?? 0.012;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + at);
    g.gain.setTargetAtTime(0.0001, t + dur * 0.78, Math.max(0.03, dur * 0.2));
    o.connect(f).connect(g).connect(opt.dest ?? this.musicGain!);
    if (opt.send && this.delayIn) { const sg = c.createGain(); sg.gain.value = opt.send; g.connect(sg).connect(this.delayIn); }
    o.start(t); o.stop(t + dur + 0.6);
  }

  /** FM-artige Glocke (E-Piano-Anmutung): Grundton plus leise Doppeloktave, beide klingen exponentiell aus. */
  private bell(midi: number, t: number, vol: number, send = 0.4): void {
    const c = this.ctx!;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
    const o1 = c.createOscillator(); o1.type = 'sine'; o1.frequency.value = this.midiHz(midi);
    const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = this.midiHz(midi + 24);
    const g2 = c.createGain(); g2.gain.setValueAtTime(0.5, t); g2.gain.exponentialRampToValueAtTime(0.01, t + 0.25);
    o1.connect(g); o2.connect(g2).connect(g); g.connect(this.musicGain!);
    if (this.delayIn) { const sg = c.createGain(); sg.gain.value = send; g.connect(sg).connect(this.delayIn); }
    o1.start(t); o2.start(t); o1.stop(t + 0.85); o2.stop(t + 0.85);
  }

  private drum(kind: 'kick' | 'clap' | 'hat' | 'open' | 'tom' | 'crash', t: number, pitch = 1): void {
    const c = this.ctx!, mg = this.musicGain!;
    if (kind === 'crash') {
      const s = c.createBufferSource(); s.buffer = this.noiseBuf;
      const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 4200;
      const g = c.createGain(); g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
      s.connect(f).connect(g).connect(mg); s.start(t); s.stop(t + 1.35);
      return;
    }
    if (kind === 'tom') {
      const o = c.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(190 * pitch, t); o.frequency.exponentialRampToValueAtTime(80 * pitch, t + 0.35);
      const g = c.createGain(); g.gain.setValueAtTime(0.22, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      o.connect(g).connect(mg); o.start(t); o.stop(t + 0.5);
      return;
    }
    if (kind === 'kick') {
      const o = c.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(46, t + 0.12);
      const g = c.createGain(); g.gain.setValueAtTime(0.36, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
      o.connect(g).connect(mg); o.start(t); o.stop(t + 0.3);
      // Sidechain: Pad und Bass pumpen sanft im Takt der Bassdrum
      if (this.padBus) { this.padBus.gain.setValueAtTime(0.72, t); this.padBus.gain.linearRampToValueAtTime(1, t + 0.3); }
      return;
    }
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    const g = c.createGain();
    if (kind === 'clap') {
      f.type = 'bandpass'; f.frequency.value = 1500; f.Q.value = 0.9;
      for (const dt of [0, 0.012, 0.024]) { g.gain.setValueAtTime(0.16, t + dt); g.gain.exponentialRampToValueAtTime(0.02, t + dt + 0.01); }
      g.gain.setValueAtTime(0.16, t + 0.036); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      s.connect(f).connect(g).connect(mg); s.start(t); s.stop(t + 0.25);
      // Snare-Körper und große Gated-Reverb-Fahne (Balladen-Backbeat)
      const o = c.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(210, t); o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
      const og = c.createGain(); og.gain.setValueAtTime(0.12, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      o.connect(og).connect(mg); o.start(t); o.stop(t + 0.15);
      const s2 = c.createBufferSource(); s2.buffer = this.noiseBuf;
      const f2 = c.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = 3200;
      const g2 = c.createGain(); g2.gain.setValueAtTime(0.0001, t + 0.02); g2.gain.linearRampToValueAtTime(0.09, t + 0.05); g2.gain.setValueAtTime(0.085, t + 0.3); g2.gain.linearRampToValueAtTime(0.0001, t + 0.33);
      s2.connect(f2).connect(g2).connect(mg); s2.start(t); s2.stop(t + 0.4);
    } else {
      f.type = 'highpass'; f.frequency.value = kind === 'open' ? 6500 : 8000;
      g.gain.setValueAtTime(kind === 'open' ? 0.03 : 0.022, t); g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === 'open' ? 0.16 : 0.035));
      s.connect(f).connect(g).connect(mg); s.start(t); s.stop(t + 0.22);
    }
  }

  private schedule(): void {
    const c = this.ready();
    if (!c || !this.musicOn || !this.musicGain || !this.padBus) return;
    const sd = 60 / Sound.BPM / 4; // 16tel
    while (this.nextT < c.currentTime + 0.25) {
      const i = this.step % 512, bar = i >> 4, st = i & 15;
      // Shuffle: die Und-Achtel (Schritt 2 mod 4) rutschen Richtung Triole
      const t = this.nextT + (st % 4 === 2 ? sd * 0.34 : 0);
      const lt = this.light, vk = this.speedK;
      const sec = Sound.FORM[bar >> 2], bi = bar & 3;
      const ch = Sound.CH[sec.ch[bi]], chord = ch.notes, root = ch.root;
      const nextRoot = Sound.CH[sec.ch[(bi + 1) & 3]].root;
      const big = !!sec.big;
      // Schlagzeug: Four-on-the-floor-Bassdrum, Gated-Snare auf 2 und 4, geswingte Achtel-Hats, offene Hats auf dem Offbeat; Crash je Abschnitt;
      // Pre-Chorus baut mit Achtel- und 16tel-Snare auf; Break nur halbes Tempo; Tom-Lauf vor Strophe und Break
      if (st === 0 && bi === 0) this.drum('crash', t);
      if (sec.drums === 'half') {
        if (st === 0) this.drum('kick', t);
        if (st === 8) this.drum('clap', t);
        if (st % 4 === 2) this.drum('hat', t);
      } else {
        if (st % 4 === 0) this.drum('kick', t);
        if (sec.drums === 'build' && bi === 3) { if (st >= 8 || st % 2 === 0) this.drum('clap', t); }
        else if (sec.drums === 'build' && bi === 2) { if (st % 2 === 0 && st >= 8 || st === 4) this.drum('clap', t); }
        else if (st === 4 || st === 12) this.drum('clap', t);
        if (st % 2 === 0) this.drum('hat', t);
        if (st % 4 === 2 && (big || vk > 0.45)) this.drum('open', t);
        if ((bar === 3 || bar === 23) && st >= 12) this.drum('tom', t, 1.25 - (st - 12) * 0.12);
      }
      // Walking-Bass: Grundton – Terz – Quinte – chromatischer Zielton vor dem nächsten Akkord; im Refrain Oktavsprung auf dem Offbeat; im Break lange Töne
      if (sec.drums === 'half') {
        if (st === 0 || st === 8) this.mnote(root, t, sd * 7, 'sawtooth', 0.1, 420 + 200 * lt, { dest: this.padBus, attack: 0.01 });
      } else if (st % 4 === 0 || (big && st === 10)) {
        const k = st >> 2;
        const n = st === 10 ? root + 12 : k === 0 ? root : k === 1 ? root + ch.third : k === 2 ? root + 7 : nextRoot + (nextRoot > root ? -1 : 1);
        this.mnote(n, t, sd * 3.4, 'sawtooth', 0.1, 600 + 300 * lt + 260 * vk, { dest: this.padBus, attack: 0.004 });
        this.mnote(n, t, sd * 3.4, 'square', 0.04, 520, { dest: this.padBus, attack: 0.004 });
        if (k === 0 && root >= 40) this.mnote(root - 12, t, sd * 4, 'sine', 0.11, 300, { dest: this.padBus });
      }
      // Pad (zwei verstimmte Sägezähne je Akkordton); im Refrain heller, nachts mit Oktav-Glanz
      if (st === 0) for (const n of chord) {
        const cut = (big ? 1100 : 700) + 500 * lt + 250 * vk;
        this.mnote(n, t, sd * 16, 'sawtooth', big ? 0.017 : 0.014, cut, { detune: -9, dest: this.padBus, attack: 0.25 });
        this.mnote(n, t, sd * 16, 'sawtooth', big ? 0.017 : 0.014, cut, { detune: 9, dest: this.padBus, attack: 0.25 });
        if (lt > 0.45) this.mnote(n + 12, t, sd * 16, 'triangle', 0.012 * Math.min(1, (lt - 0.45) / 0.4), 1800, { dest: this.padBus, attack: 0.5, send: 0.3 });
      }
      // Brass-Riff: kräftige Akkord-Hits wie in einer Showband (Intro und Break)
      if (sec.stab) for (const [s0, len] of Sound.STAB) {
        if (s0 !== st) continue;
        for (const n of chord) {
          this.mnote(n + 12, t, sd * len * 0.8, 'sawtooth', 0.026, 2800 + 900 * lt, { detune: 8, attack: 0.012, send: 0.25 });
          this.mnote(n + 12, t, sd * len * 0.8, 'sawtooth', 0.022, 2400, { detune: -8, attack: 0.012 });
        }
      }
      // E-Piano-Komping auf dem Offbeat (Strophen): kurze Glockenakkorde
      if (sec.lead && !big && (st === 6 || st === 14)) { this.bell(chord[1] + 12, t, 0.02, 0.25); this.bell(chord[3] + 12, t, 0.016, 0.25); }
      // Slot-Machine-Glöckchen: im Refrain Achtel-Arpeggio nach oben, im Intro/Break ebenso etwas lauter; Ding auf der Eins des Refrains, Glocken-Lauf vor dem Refrain
      if (sec.arp && st % 2 === 0 && (big || !sec.lead)) {
        const pat = [0, 1, 2, 3, 2, 3, 2, 1][(st >> 1) & 7];
        this.bell(chord[pat] + 24, t, (sec.lead ? 0.012 : 0.022) + 0.008 * lt + 0.004 * vk, 0.3);
      }
      if (big && st === 0) this.bell(chord[3] + 36, t, 0.022, 0.4);
      if (sec.drums === 'build' && bi === 3 && st >= 8 && st % 2 === 0) this.bell(chord[(st >> 1) & 3] + 24 + (st >= 12 ? 12 : 0), t, 0.024, 0.3);
      // Synth-Brass-Lead (zwei Sägezähne, Vibrato auf langen Tönen, Echo); im Refrain eine Oktave tiefer mit Rechteck gedoppelt
      if (sec.lead) {
        for (const [s0, midi, len] of Sound.LEADS[sec.lead][bi]) {
          if (s0 !== st) continue;
          const dur = sd * len * 0.92;
          const cut = (big ? 3200 : 2400) + 1200 * lt;
          this.mnote(midi, t, dur, 'sawtooth', big ? 0.05 : 0.045, cut, { detune: 9, vib: len >= 4 ? 20 : 0, send: 0.3, attack: 0.022 });
          this.mnote(midi, t, dur, 'sawtooth', big ? 0.04 : 0.034, cut, { detune: -9, vib: len >= 4 ? 14 : 0, send: 0.2, attack: 0.022 });
          if (big) this.mnote(midi - 12, t, dur, 'square', 0.022, 1500, { vib: len >= 4 ? 10 : 0, send: 0.15, attack: 0.02 });
        }
      }
      this.nextT += sd;
      this.step++;
    }
  }

  // ---------- Flug: Düsenjet-Rauschen und Turbinenheulen ----------
  /** Schaltet den Flugklang ein/aus (Rauschen mit steigendem Filter, Turbinenheulen, tiefes Grollen). */
  setFlight(on: boolean): void {
    const c = this.ready();
    if (!c) return;
    if (!this.flight && on) {
      const g = c.createGain(); g.gain.value = 0;
      const n = c.createBufferSource(); n.buffer = this.noiseBuf; n.loop = true;
      const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 900; nf.Q.value = 0.8;
      n.connect(nf).connect(g);
      const rg = c.createGain(); rg.gain.value = 0.5;
      const rl = c.createBiquadFilter(); rl.type = 'lowpass'; rl.frequency.value = 220;
      n.connect(rl).connect(rg).connect(g);
      const wf = c.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 900; wf.Q.value = 2.5;
      const o1 = c.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 300;
      const o2 = c.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 303; o2.detune.value = 14;
      const og = c.createGain(); og.gain.value = 0.22;
      o1.connect(wf); o2.connect(wf); wf.connect(og).connect(g);
      g.connect(this.engBus!);
      n.start(); o1.start(); o2.start();
      this.flight = { g, nf, o1, o2, wf, rg };
    }
    if (!this.flight) return;
    const t = c.currentTime, F = this.flight;
    F.g.gain.cancelScheduledValues(t);
    if (on) {
      F.g.gain.setTargetAtTime(0.16, t, 0.35);
      F.nf.frequency.cancelScheduledValues(t); F.nf.frequency.setValueAtTime(600, t); F.nf.frequency.exponentialRampToValueAtTime(2600, t + 1.4);
      F.o1.frequency.cancelScheduledValues(t); F.o1.frequency.setValueAtTime(220, t); F.o1.frequency.exponentialRampToValueAtTime(560, t + 1.6);
      F.o2.frequency.cancelScheduledValues(t); F.o2.frequency.setValueAtTime(223, t); F.o2.frequency.exponentialRampToValueAtTime(563, t + 1.6);
      F.wf.frequency.cancelScheduledValues(t); F.wf.frequency.setValueAtTime(700, t); F.wf.frequency.exponentialRampToValueAtTime(1900, t + 1.6);
    } else {
      F.g.gain.setTargetAtTime(0, t, 0.25);
      F.nf.frequency.exponentialRampToValueAtTime(500, t + 0.9);
      F.o1.frequency.exponentialRampToValueAtTime(160, t + 0.9);
      F.o2.frequency.exponentialRampToValueAtTime(162, t + 0.9);
    }
  }

  // ---------- Streckenumgebung: Tunnel-Hall und Casino-Ambience (dezent, folgt den Soundeinstellungen) ----------
  private envN: { lp: BiquadFilterNode; send: GainNode; hum: GainNode; amb: GainNode; osc: OscillatorNode[]; src: AudioBufferSourceNode } | null = null;
  private envDingT = 0;
  /**
   * Umgebungsklang nach Streckenereignis (kind: 'PALM_TUNNEL' | 'CASINO_INTERIOR' | null) und Stärke k (0…1): kurzer, weicher Hall auf Motor und Effekten,
   * Tunnel mit leisem elektrischem Summen, Casino mit gedämpftem Stimmengewirr und seltenen, hellen Automatenklängen. Weiche Übergänge, kein Browser-Autoplay vor der ersten Eingabe.
   */
  setEnv(kind: string | null, k: number, theme = 0): void {
    const c = this.ready();
    if (!c || !this.engBus || !this.sfxBus || !this.master) return;
    if ((!kind || k < 0.01) && !this.envN) return;
    const t = c.currentTime;
    if (!this.envN) {
      const send = c.createGain(); send.gain.value = 0;
      const d1 = c.createDelay(0.5); d1.delayTime.value = 0.083;
      const d2 = c.createDelay(0.5); d2.delayTime.value = 0.131;
      const fb = c.createGain(); fb.gain.value = 0.42;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
      this.engBus.connect(send); this.sfxBus.connect(send);
      send.connect(d1); send.connect(d2); d1.connect(fb); d2.connect(fb); fb.connect(d1); fb.connect(d2); d1.connect(lp); d2.connect(lp); lp.connect(this.master);
      const hum = c.createGain(); hum.gain.value = 0;
      const o1 = c.createOscillator(); o1.type = 'sine'; o1.frequency.value = 55;
      const o2 = c.createOscillator(); o2.type = 'triangle'; o2.frequency.value = 110.7;
      o1.connect(hum); o2.connect(hum); hum.connect(this.master); o1.start(); o2.start();
      const amb = c.createGain(); amb.gain.value = 0;
      const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.7;
      src.connect(bp).connect(amb).connect(this.master); src.start();
      this.envN = { lp, send, hum, amb, osc: [o1, o2], src };
    }
    const E = this.envN, tun = kind === 'PALM_TUNNEL' ? k : 0, cas = kind === 'CASINO_INTERIOR' ? k : 0;
    // Themenklang (nur Farbe der Ambience, die Musik bleibt unberührt): 0 Cosmic = weiter, heller Schimmer; 1 Atlantis = tiefes, gedämpftes Wasser;
    // 2 Kingdom = längerer Hall mit leerer Quinte; 3 Jazz = warme Terz, sehr leise.
    const TH = [
      { f1: 82, f2: 165.4, hum: 0.013, rev: 0.22, lp: 3200 },
      { f1: 41, f2: 82.2, hum: 0.02, rev: 0.26, lp: 900 },
      { f1: 55, f2: 82.5, hum: 0.012, rev: 0.3, lp: 2000 },
      { f1: 110, f2: 138.6, hum: 0.007, rev: 0.12, lp: 2600 },
    ][((theme % 4) + 4) % 4];
    if (tun > 0) { E.osc[0].frequency.setTargetAtTime(TH.f1, t, 0.3); E.osc[1].frequency.setTargetAtTime(TH.f2, t, 0.3); }
    E.send.gain.setTargetAtTime(TH.rev * tun + 0.1 * cas, t, 0.15);
    E.lp.frequency.setTargetAtTime(TH.lp, t, 0.3);
    E.hum.gain.setTargetAtTime(TH.hum * tun, t, 0.2);
    E.amb.gain.setTargetAtTime(0.012 * cas, t, 0.25);
    // Casino: gelegentlich ein heller, leiser Automatenklang (Zufallsabstand 1–3 s, nie bei abgeschaltetem Ton)
    if (cas > 0.4 && !this.muted && t > this.envDingT) {
      this.envDingT = t + 1 + Math.random() * 2;
      const f = [1568, 1976, 2349, 1319][Math.floor(Math.random() * 4)];
      this.note(f, t, 0.18, 'sine', 0.018 * cas, this.sfxBus);
      this.note(f * 1.5, t + 0.09, 0.14, 'sine', 0.012 * cas, this.sfxBus);
    }
    if (!kind && k < 0.01) {                       // Ereignis vorbei: Knoten abbauen (keine dauerhaft laufenden Oszillatoren)
      const old = this.envN; this.envN = null;
      old.send.gain.setTargetAtTime(0, t, 0.1);
      for (const o of old.osc) { try { o.stop(t + 0.6); } catch { /* bereits gestoppt */ } }
      try { old.src.stop(t + 0.6); } catch { /* bereits gestoppt */ }
      try { this.engBus.disconnect(old.send); this.sfxBus.disconnect(old.send); } catch { /* ok */ }
    }
  }

  // ---------- Neon Rush: leises elektrisches Summen während des Rushs ----------
  private rushHum: { g: GainNode; o: OscillatorNode[] } | null = null;
  /** Schaltet das Rush-Summen ein/aus (Sägezahn-Quint mit langsamem Tremolo über den Motor-Bus; folgt den Soundeinstellungen). */
  setRush(on: boolean): void {
    const c = this.ready();
    if (!c || !this.engBus) return;
    if (this.track.playing) this.track.rush(c as AudioContext, on);
    const t = c.currentTime;
    if (on && !this.rushHum) {
      const g = c.createGain(); g.gain.value = 0;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 2;
      const o1 = c.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 110;
      const o2 = c.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 165; o2.detune.value = 8;
      const lfo = c.createOscillator(); lfo.frequency.value = 7.5;
      const ld = c.createGain(); ld.gain.value = 0.012;
      lfo.connect(ld).connect(g.gain);
      o1.connect(lp); o2.connect(lp); lp.connect(g).connect(this.engBus);
      o1.start(); o2.start(); lfo.start();
      g.gain.setTargetAtTime(0.03, t, 0.12);
      this.rushHum = { g, o: [o1, o2, lfo] };
    } else if (!on && this.rushHum) {
      const h = this.rushHum; this.rushHum = null;
      h.g.gain.cancelScheduledValues(t); h.g.gain.setTargetAtTime(0, t, 0.08);
      for (const o of h.o) { try { o.stop(t + 0.5); } catch { /* bereits gestoppt */ } }
    }
  }

  // ---------- Effekte ----------
  private note(freq: number, t: number, dur: number, type: OscillatorType, vol: number, dest: AudioNode, endFreq?: number): void {
    const c = this.ctx!;
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t); o.stop(t + dur + 0.05);
  }

  private noise(t: number, dur: number, vol: number, f0: number, f1: number): void {
    const c = this.ctx!;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.sfxBus!);
    s.start(t); s.stop(t + dur + 0.05);
  }

  /**
   * Effekt abspielen. `level` (nur nearMiss): Combo-Stufe 1…5+ – jede Stufe klingt eine Stufe höher (steigende Rückmeldung, ohne die Musik lange zu verdecken).
   */
  sfx(name: Sfx, level = 1): void {
    const c = this.ready();
    if (!c || this.muted) return;
    if (name !== 'effectEnd' && name !== 'laneWarn' && name !== 'rushTick' && name !== 'slash' && name !== 'rushPass') this.duck(name === 'crash' ? 0.6 : name === 'nearMiss' ? 0.12 : 0.3);
    const t = c.currentTime;
    const m = this.sfxBus!;
    switch (name) {
      case 'start': [262, 330, 392, 523].forEach((f, i) => this.note(f, t + i * 0.07, 0.14, 'square', 0.12, m)); break;
      case 'shield': this.note(880, t, 0.25, 'sine', 0.16, m); this.note(1320, t + 0.09, 0.4, 'sine', 0.13, m); this.note(1760, t + 0.18, 0.5, 'triangle', 0.07, m); break;
      case 'shieldHit': this.noise(t, 0.18, 0.35, 3000, 300); this.note(200, t, 0.2, 'triangle', 0.2, m, 90); break;
      case 'crash': this.noise(t, 0.8, 0.7, 4000, 120); this.note(180, t, 0.7, 'sawtooth', 0.25, m, 40); this.note(90, t, 0.5, 'square', 0.15, m, 30); break;
      case 'record': [523, 659, 784, 1047].forEach((f, i) => this.note(f, t + i * 0.09, 0.3, 'triangle', 0.14, m)); break;
      case 'slow': this.note(660, t, 0.5, 'sine', 0.15, m, 220); this.note(330, t + 0.1, 0.5, 'triangle', 0.08, m, 110); break;
      case 'clear': this.noise(t, 0.2, 0.25, 4500, 600); this.note(220, t, 0.3, 'sawtooth', 0.14, m, 900); this.note(660, t + 0.06, 0.25, 'square', 0.08, m, 1300); break;
      case 'boost': this.noise(t, 0.9, 0.3, 500, 6000); this.note(110, t, 0.9, 'sawtooth', 0.14, m, 640); this.note(55, t, 0.5, 'sine', 0.3, m, 40); break;
      case 'guide': [1318, 1568, 2093].forEach((fr, i) => this.note(fr, t + i * 0.09, 0.22, 'sine', 0.09, m)); break;
      case 'glide': this.noise(t, 1.1, 0.28, 400, 5200); this.note(140, t, 1.0, 'sawtooth', 0.12, m, 900); [784, 988, 1319, 1760].forEach((fr, i) => this.note(fr, t + 0.15 + i * 0.07, 0.25, 'triangle', 0.06, m)); break;
      case 'land': this.noise(t, 0.2, 0.3, 1800, 200); this.note(140, t, 0.25, 'sine', 0.2, m, 60); this.note(520, t + 0.02, 0.12, 'triangle', 0.06, m, 260); break;
      case 'magnet': this.note(1100, t, 0.08, 'sine', 0.12, m); this.note(1100, t + 0.16, 0.08, 'sine', 0.1, m); this.note(1650, t + 0.32, 0.22, 'sine', 0.1, m); break;
      case 'effectEnd': this.note(520, t, 0.18, 'sine', 0.09, m, 300); break;
      case 'nearMiss': {
        // kurzer „Whoosh“ plus zwei steigende Töne; Tonhöhe folgt der Combo-Stufe (Halbtonschritte, Pentatonik-ähnlich)
        const st = [0, 2, 4, 7, 9][Math.max(0, Math.min(4, level - 1))], f = 660 * Math.pow(2, st / 12);
        this.noise(t, 0.09, 0.12, 5200, 1400);
        this.note(f, t, 0.1, 'square', 0.07, m); this.note(f * 1.5, t + 0.06, 0.16, 'triangle', 0.1, m);
        break;
      }
      case 'rushStart':
        // markanter Start: Aufwärtsschwenk, Quint-Akkord und kurzer Rauschimpuls
        this.noise(t, 0.35, 0.22, 800, 7000); this.note(220, t, 0.4, 'sawtooth', 0.12, m, 880);
        [523, 659, 784, 1047].forEach((fr, i) => this.note(fr, t + 0.08 + i * 0.05, 0.3, 'square', 0.07, m));
        break;
      case 'rushEnd': this.note(988, t, 0.3, 'triangle', 0.09, m, 262); this.note(494, t + 0.06, 0.3, 'sine', 0.08, m, 131); this.noise(t, 0.25, 0.1, 5000, 400); break;
      // Neon Slash: kurzer elektrischer Zischer mit fallendem Sägezahn (leise, damit er sich bei Wechselfolgen nicht auftürmt)
      case 'slash': this.noise(t, 0.14, 0.12, 7000, 1800); this.note(2100, t, 0.16, 'sawtooth', 0.05, m, 420); this.note(3100, t + 0.01, 0.07, 'square', 0.025, m, 1100); break;
      // Neon Gate: steigendes Zwei-Ton-Glöckchen, Tonhöhe folgt der Rush-Chain (Stufe 1–3)
      case 'gate': { const f = [659, 784, 988][Math.max(0, Math.min(2, level - 1))]; this.note(f, t, 0.22, 'triangle', 0.11, m); this.note(f * 2, t + 0.05, 0.3, 'sine', 0.08, m); this.note(f * 3, t + 0.1, 0.2, 'sine', 0.035, m); break; }
      // Neon Shockwave: tiefer Schlag mit aufspringendem Rauschen
      case 'wave': this.note(170, t, 0.35, 'sine', 0.2, m, 42); this.noise(t, 0.32, 0.18, 6000, 500); this.note(880, t + 0.04, 0.2, 'triangle', 0.05, m, 1760); break;
      // Phantom-Durchfahrt: weicher Luftzug
      case 'rushPass': this.noise(t, 0.09, 0.06, 4200, 1500); this.note(520, t, 0.08, 'sine', 0.04, m, 260); break;
      case 'rushTick': this.note(1760, t, 0.05, 'sine', 0.035, m); break;
      case 'laneWarn': this.note(1500, t, 0.035, 'square', 0.035, m); this.note(1100, t + 0.11, 0.035, 'square', 0.03, m); break;
      case 'zap':
        // elektrisches Knistern für den Spurblitz: schnelle Rauschimpulse und fallender Sägezahn
        this.noise(t, 0.22, 0.3, 7000, 900); this.noise(t + 0.06, 0.12, 0.22, 6000, 1500);
        this.note(1300, t, 0.18, 'sawtooth', 0.1, m, 180); this.note(2600, t + 0.02, 0.08, 'square', 0.05, m, 800);
        break;
    }
  }
}
