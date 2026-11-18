import { load, save } from '../storage/storage';
import { BALANCE } from '../config/balance';

export type Sfx = 'start' | 'shield' | 'slow' | 'clear' | 'magnet' | 'glide' | 'land' | 'boost' | 'guide' | 'shieldHit' | 'crash' | 'record' | 'effectEnd';

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

  constructor() { this.muted = load().muted; }

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

  // ---------- Musik: eigenes 80er-Arcade-Rennthema „Sunset Drive" in A-Dur (138 BPM, 32 Takte ≈ 56 s) ----------
  // Eigene Komposition. Aufbau: Intro-Riff (Bläser-Stabs) · Strophe ×2 · Pre-Chorus mit Snare-Aufbau · Hook-Refrain ×2 ·
  // Break (Riff + Glocken) · Schluss-Refrain. Klang: Oktav-Achtelbass, Viertel-Bassdrum, Gated-Snare, 16tel-Hats,
  // Fusion-Lead (Säge + Rechteck), Bläser-Stabs, Glocken-Arpeggio, Crash auf jedem Abschnittsbeginn.
  /** Akkorde: Bass-Grundton und Vierklang (MIDI). */
  private static CH: Record<string, { root: number; notes: number[] }> = {
    A: { root: 45, notes: [57, 61, 64, 69] }, G: { root: 43, notes: [55, 59, 62, 67] }, D: { root: 38, notes: [57, 62, 66, 69] },
    E: { root: 40, notes: [56, 59, 64, 68] }, Fm: { root: 42, notes: [57, 61, 66, 69] }, Cm: { root: 37, notes: [56, 61, 64, 68] },
  };
  /** Melodien je Takt: [Schritt, MIDI, Länge in 16teln]. „hook" ist das Wiedererkennungsmotiv (kurz–kurz–lang, zweimal, dann Antwort). */
  private static LEADS: Record<string, [number, number, number][][]> = {
    verse: [
      [[0, 69, 2], [3, 69, 1], [4, 71, 2], [6, 73, 4], [12, 76, 4]], [[0, 74, 2], [3, 74, 1], [4, 71, 2], [6, 67, 6], [14, 69, 2]],
      [[0, 69, 2], [3, 69, 1], [4, 71, 2], [6, 74, 4], [12, 76, 2], [14, 78, 2]], [[0, 76, 6], [6, 73, 2], [8, 69, 8]],
    ],
    pre: [
      [[0, 74, 6], [6, 76, 2], [8, 78, 8]], [[0, 76, 6], [6, 78, 2], [8, 80, 8]],
      [[0, 81, 6], [6, 80, 2], [8, 76, 8]], [[0, 80, 4], [4, 78, 4], [8, 76, 2], [10, 78, 2], [12, 80, 4]],
    ],
    hook: [
      [[0, 73, 2], [2, 76, 2], [4, 78, 4], [10, 76, 2], [12, 78, 4]], [[0, 81, 3], [3, 78, 3], [6, 76, 2], [8, 74, 8]],
      [[0, 73, 2], [2, 76, 2], [4, 78, 4], [10, 76, 2], [12, 81, 4]], [[0, 80, 6], [6, 78, 2], [8, 76, 8]],
    ],
    hookEnd: [
      [[0, 73, 2], [2, 76, 2], [4, 78, 4], [10, 76, 2], [12, 78, 4]], [[0, 81, 3], [3, 78, 3], [6, 76, 2], [8, 74, 8]],
      [[0, 73, 2], [2, 76, 2], [4, 78, 4], [10, 76, 2], [12, 81, 4]], [[0, 80, 4], [4, 81, 4], [8, 83, 8]],
    ],
  };
  /** Acht Abschnitte zu je vier Takten. drums: full | build | half; stab: Bläser-Riff; arp: Glocken; big: Refrain-Fülle. */
  private static FORM: { ch: string[]; lead?: string; drums: 'full' | 'build' | 'half'; stab?: boolean; arp?: boolean; big?: boolean }[] = [
    { ch: ['A', 'G', 'D', 'A'], drums: 'full', stab: true },                       // Intro-Riff
    { ch: ['A', 'G', 'D', 'A'], lead: 'verse', drums: 'full' },                    // Strophe
    { ch: ['A', 'G', 'D', 'A'], lead: 'verse', drums: 'full', arp: true },         // Strophe 2
    { ch: ['D', 'E', 'Cm', 'E'], lead: 'pre', drums: 'build', arp: true },         // Pre-Chorus
    { ch: ['Fm', 'D', 'A', 'E'], lead: 'hook', drums: 'full', arp: true, big: true },    // Refrain
    { ch: ['Fm', 'D', 'A', 'E'], lead: 'hookEnd', drums: 'full', arp: true, big: true }, // Refrain 2
    { ch: ['A', 'G', 'D', 'A'], drums: 'half', stab: true, arp: true },            // Break
    { ch: ['Fm', 'D', 'A', 'E'], lead: 'hookEnd', drums: 'full', arp: true, big: true }, // Schluss-Refrain
  ];
  /** Rhythmus des Bläser-Riffs (Schritt, Länge in 16teln): synkopiert, gleiche Figur in jedem Takt. */
  private static STAB: [number, number][] = [[0, 2], [3, 2], [6, 3], [10, 2], [12, 3]];
  private static BPM = 138;
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
    this.nextT = c.currentTime + 0.08;
    if (this.musicTimer !== undefined) clearInterval(this.musicTimer);
    this.musicTimer = setInterval(() => this.schedule(), 40);
  }

  private stopMusic(): void {
    this.musicOn = false;
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
      const i = this.step % 512, bar = i >> 4, st = i & 15, t = this.nextT;
      const lt = this.light, vk = this.speedK;
      const sec = Sound.FORM[bar >> 2], bi = bar & 3;
      const ch = Sound.CH[sec.ch[bi]], chord = ch.notes, root = ch.root;
      const big = !!sec.big;
      // Schlagzeug: Viertel-Bassdrum, Snare auf 2 und 4, 16tel-Hats; Crash auf jedem Abschnittsbeginn;
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
        if (st % 2 === 0 || big || vk > 0.3) this.drum('hat', t);
        if (st === 14 && (big || vk > 0.45)) this.drum('open', t);
        if ((bar === 3 || bar === 23) && st >= 12) this.drum('tom', t, 1.25 - (st - 12) * 0.12);
      }
      // treibender Oktav-Achtelbass (Grundton – Oktave), im Break nur lange Grundtöne; Sinus-Fundament auf den Vierteln
      if (sec.drums === 'half') {
        if (st === 0 || st === 8) this.mnote(root, t, sd * 7, 'sawtooth', 0.1, 420 + 200 * lt, { dest: this.padBus, attack: 0.01 });
      } else if (st % 2 === 0) {
        const n = st % 4 === 2 ? root + 12 : root;
        this.mnote(n, t, sd * 1.6, 'sawtooth', 0.1, 560 + 300 * lt + 260 * vk, { dest: this.padBus, attack: 0.004 });
        if (st % 4 === 0 && root >= 40) this.mnote(root - 12, t, sd * 3, 'sine', 0.11, 300, { dest: this.padBus });
      }
      // Pad (zwei verstimmte Sägezähne je Akkordton); im Refrain heller, nachts mit Oktav-Glanz
      if (st === 0) for (const n of chord) {
        const cut = (big ? 1100 : 700) + 500 * lt + 250 * vk;
        this.mnote(n, t, sd * 16, 'sawtooth', big ? 0.017 : 0.014, cut, { detune: -9, dest: this.padBus, attack: 0.25 });
        this.mnote(n, t, sd * 16, 'sawtooth', big ? 0.017 : 0.014, cut, { detune: 9, dest: this.padBus, attack: 0.25 });
        if (lt > 0.45) this.mnote(n + 12, t, sd * 16, 'triangle', 0.012 * Math.min(1, (lt - 0.45) / 0.4), 1800, { dest: this.padBus, attack: 0.5, send: 0.3 });
      }
      // Bläser-Riff: synkopierte Akkord-Stabs (Intro und Break) – das zweite Erkennungszeichen neben dem Refrain-Hook
      if (sec.stab) for (const [s0, len] of Sound.STAB) {
        if (s0 !== st) continue;
        for (const n of chord) {
          this.mnote(n + 12, t, sd * len * 0.8, 'sawtooth', 0.022, 2600 + 900 * lt, { detune: 6, attack: 0.008, send: 0.25 });
          this.mnote(n + 12, t, sd * len * 0.8, 'square', 0.012, 2000, { detune: -6, attack: 0.008 });
        }
      }
      // Glocken-Arpeggio in 16teln (FM-Anmutung, Echo), leise unter der Melodie
      if (sec.arp && st % 2 === 0) {
        const pat = [0, 1, 2, 3, 2, 1, 2, 3][(st >> 1) & 7];
        this.bell(chord[pat] + 12, t, (sec.lead ? 0.016 : 0.03) + 0.01 * lt + 0.006 * vk, 0.3);
      }
      // Fusion-Lead (Sägezahn + Rechteck, schneller Einsatz, Vibrato, Echo); im Refrain eine Oktave tiefer gedoppelt
      if (sec.lead) {
        for (const [s0, midi, len] of Sound.LEADS[sec.lead][bi]) {
          if (s0 !== st) continue;
          const dur = sd * len * 0.92;
          const cut = (big ? 3000 : 2200) + 1200 * lt;
          this.mnote(midi, t, dur, 'sawtooth', big ? 0.05 : 0.045, cut, { detune: 6, vib: len >= 4 ? 18 : 0, send: 0.35, attack: 0.012 });
          this.mnote(midi, t, dur, 'square', big ? 0.03 : 0.026, cut * 0.8, { detune: -6, vib: len >= 4 ? 12 : 0, send: 0.25, attack: 0.012 });
          if (big) this.mnote(midi - 12, t, dur, 'sawtooth', 0.026, 1500, { vib: len >= 4 ? 10 : 0, send: 0.15, attack: 0.015 });
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

  sfx(name: Sfx): void {
    const c = this.ready();
    if (!c || this.muted) return;
    if (name !== 'effectEnd') this.duck(name === 'crash' ? 0.6 : 0.3);
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
    }
  }
}
