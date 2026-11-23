/**
 * Optionaler, produzierter Soundtrack (Aufnahme statt Synth). Liegt unter /audio/soundtrack.json eine gültige Beschreibung samt Audiodatei, wird sie nahtlos
 * geloopt abgespielt; sonst (Datei fehlt, Dekodierung scheitert, Netz weg) bleibt die eingebaute Synth-Musik unverändert aktiv.
 * Keine Datei ist mitgeliefert: das fertige, lizenzierte Stück ist ein offenes Asset (siehe docs/music/README.md).
 */
export interface SoundtrackManifest {
  /** Haupt-Spur (Loop), relativ zu /audio/. */
  main: string;
  /** Optionale Abspielliste (ersetzt die Einzelspur): die Stücke laufen nacheinander lückenlos, danach beginnt die Liste von vorn. Jeder Eintrag braucht die Lizenz der Gesamtangabe. */
  playlist?: string[];
  /** Optionale Zusatzspur gleicher Länge (Gitarren-/Synth-Layer), wird bei Neon Rush eingeblendet. */
  rush?: string;
  /** Loop-Grenzen in Sekunden (musikalisch saubere Taktgrenzen); fehlt loopEnd, wird die ganze Datei geloopt. */
  loopStart?: number;
  loopEnd?: number;
  /** Nachweis der Nutzungsrechte; ohne Eintrag wird die Aufnahme nicht abgespielt. */
  license?: string;
}

export const SOUNDTRACK_URL = '/audio/soundtrack.json';

/** Prüft eine geladene Beschreibung (rein, testbar). Gibt nur ein Manifest mit Lizenznachweis zurück. */
export function parseManifest(raw: unknown): SoundtrackManifest | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const safe = (v: unknown): v is string => typeof v === 'string' && /^[\w.-]+\.(ogg|mp3|m4a|wav)$/i.test(v);
  if (!safe(m.main)) return null;
  if (typeof m.license !== 'string' || m.license.trim().length < 3) return null;
  const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);
  const loopStart = num(m.loopStart), loopEnd = num(m.loopEnd);
  if (loopStart !== undefined && loopEnd !== undefined && loopEnd <= loopStart) return null;
  const pl = Array.isArray(m.playlist) ? m.playlist.filter(safe) : undefined;
  if (Array.isArray(m.playlist) && pl && pl.length !== m.playlist.length) return null;
  return { main: m.main, playlist: pl && pl.length > 1 ? pl : undefined, rush: safe(m.rush) ? m.rush : undefined, loopStart, loopEnd, license: m.license };
}

export class Soundtrack {
  private main: AudioBuffer | null = null;
  private list: AudioBuffer[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private rushBuf: AudioBuffer | null = null;
  private man: SoundtrackManifest | null = null;
  private loading = false;
  private srcs: AudioBufferSourceNode[] = [];
  private rushGain: GainNode | null = null;
  private out: GainNode | null = null;
  /** Wird aufgerufen, sobald die Aufnahme dekodiert vorliegt. */
  onReady: (() => void) | null = null;

  get available(): boolean { return !!this.main; }
  get playing(): boolean { return this.srcs.length > 0; }

  async load(ctx: AudioContext): Promise<void> {
    if (this.loading || this.main) return;
    this.loading = true;
    try {
      const r = await fetch(SOUNDTRACK_URL, { cache: 'no-cache' });
      if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return;
      const man = parseManifest(await r.json());
      if (!man) return;
      const dec = async (f: string): Promise<AudioBuffer | null> => {
        const x = await fetch(`/audio/${f}`);
        if (!x.ok || (x.headers.get('content-type') ?? '').includes('html')) return null;
        return ctx.decodeAudioData(await x.arrayBuffer());
      };
      const main = await dec(man.main);
      if (!main) return;
      if (man.playlist) { const rest = await Promise.all(man.playlist.filter((f) => f !== man.main).map((f) => dec(f).catch(() => null))); this.list = [main, ...rest.filter((b): b is AudioBuffer => !!b)]; }
      this.rushBuf = man.rush ? await dec(man.rush).catch(() => null) : null;
      this.man = man; this.main = main;
      this.onReady?.();
    } catch { /* bleibt bei der Synth-Musik */ } finally { this.loading = false; }
  }

  start(ctx: AudioContext, dest: AudioNode): void {
    if (!this.main || !this.man || this.srcs.length) return;
    const out = ctx.createGain(); out.gain.value = 0; out.connect(dest);
    out.gain.setTargetAtTime(1, ctx.currentTime, 0.4);                // sanfter Einstieg, kein Knall
    const mk = (buf: AudioBuffer, g: AudioNode): AudioBufferSourceNode => {
      const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true;
      const { loopStart, loopEnd } = this.man!;
      if (loopEnd !== undefined) { s.loopStart = loopStart ?? 0; s.loopEnd = Math.min(loopEnd, buf.duration); }
      s.connect(g); return s;
    };
    const t = ctx.currentTime + 0.05;
    if (this.list.length > 1) { this.playList(ctx, out, t); this.out = out; return; }
    const a = mk(this.main, out); this.srcs = [a];
    if (this.rushBuf) {
      const rg = ctx.createGain(); rg.gain.value = 0; rg.connect(out); this.rushGain = rg;
      this.srcs.push(mk(this.rushBuf, rg));
    }
    for (const s of this.srcs) s.start(t);                             // beide Spuren starten auf demselben Takt
    this.out = out;
  }

  /** Abspielliste: das nächste Stück wird sample-genau an das Ende des vorigen gesetzt (kein Spalt, kein Überlappen). */
  private playList(ctx: AudioContext, out: GainNode, t0: number): void {
    let i = 0, at = t0;
    const put = (): void => {
      const buf = this.list[i % this.list.length];
      const s = ctx.createBufferSource(); s.buffer = buf; s.connect(out); s.start(at);
      this.srcs = [...this.srcs.filter((x) => x !== s).slice(-1), s];
      at += buf.duration; i++;
    };
    put();
    this.timer = setInterval(() => { if (at - ctx.currentTime < 4) put(); }, 500);
  }

  /** Neon Rush: Zusatzspur weich ein- bzw. ausblenden; die Hauptspur und das Tempo bleiben unverändert. */
  rush(ctx: AudioContext, on: boolean): void {
    this.rushGain?.gain.setTargetAtTime(on ? 0.9 : 0, ctx.currentTime, on ? 0.25 : 0.6);
  }

  stop(ctx: AudioContext): void {
    const t = ctx.currentTime;
    if (this.timer !== undefined) { clearInterval(this.timer); this.timer = undefined; }
    this.out?.gain.setTargetAtTime(0, t, 0.15);
    for (const s of this.srcs) { try { s.stop(t + 1); } catch { /* bereits gestoppt */ } }
    this.srcs = []; this.rushGain = null; this.out = null;
  }
}
