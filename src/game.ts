import { BALANCE as B } from './config/balance';
import { TEXT } from './config/meta';
import { FixedLoop } from './core/loop';
import { formatDistance } from './core/format';
import { newSeed } from './core/rng';
import { GameState } from './core/state';
import { Input } from './input/input';
import { Renderer, type View } from './render/renderer';
import { Sim } from './sim/sim';
import { KINDS } from './sim/world';
import { Road } from './sim/road';
import { lightT } from './render/scenery';
import { Sound } from './audio/sound';
import { load, save } from './storage/storage';
import { PICKUP_LABEL, applyConfig, type PickupKey } from './config/runtime';
import { SPRINT_CONFIG, SPRINT_ENABLED, SPRINT_FINISH_M, SPRINT_ID, SPRINT_ROUTE, SPRINT_SEED, sprintStageScale } from './sprint/rules';
import { BUILTIN, Telemetry, eventActive, fetchConfig, randomId, type RemoteConfig } from './net/remote';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

/** Satz zur tatsächlichen Absturzursache (aus dem Crash-Ereignis). */
export function crashCauseText(kind: string | undefined): string {
  const t: Record<string, string> = { taxi: 'Taxi getroffen', cabrio: 'Cabrio getroffen', sedan: 'Limousine getroffen', truck: 'Lkw getroffen', baken: 'Bake getroffen', barrier: 'Absperrung getroffen' };
  return kind && t[kind] ? t[kind] : '';
}

/**
 * Ein konkretes Ziel für den nächsten Versuch – nur aus dem erfassten Zustand abgeleitet:
 * erstes Power-up (wenn keins eingesammelt wurde), 1 km, Abstand zur Bestweite, sonst das nächste 5-km-Schild.
 */
export function nextGoalText(dist: number, best: number, record: boolean, pickups: number): string {
  const km = (m: number): string => (m % 1000 === 0 ? String(m / 1000) : (m / 1000).toFixed(2).replace('.', ','));
  if (dist < 1000 && pickups === 0) return 'Ziel: Sammle ein Power-up ein.';
  if (dist < 1000) return 'Ziel: Schaffe 1 km.';
  if (!record && best > dist && best - dist <= 3000) return `Ziel: Noch ${Math.max(1, Math.round((best - dist) / 10) * 10)} m bis zu deiner Bestweite.`;
  const next = (Math.floor(dist / 5000) + 1) * 5000;
  return `Ziel: Das ${km(next)}-km-Schild.`;
}

type Mode = 'endless' | 'sprint';

/** Eingehende Herausforderung (?sprint=S1&c=<Meter>): nur bekannte Kennung, Wert als Angabe des Absenders begrenzt auf 0…Ziel. */
export function parseChallenge(search: string): { ok: boolean; reach: number | null } | null {
  const q = new URLSearchParams(search);
  const id = q.get('sprint');
  if (id === null) return null;
  if (id !== SPRINT_ID) return { ok: false, reach: null };
  const c = q.get('c');
  return { ok: true, reach: c !== null && /^\d{1,6}$/.test(c) ? Math.min(Number(c), SPRINT_FINISH_M) : null };
}

/** Ursache einer Pause: manuell oder automatisch (mit verständlichem Hinweis). */
type PauseReason = 'manual' | 'blur' | 'hidden' | 'stall';
const PAUSE_TEXT: Record<PauseReason, string> = {
  manual: '',
  blur: 'Automatisch pausiert: Das Fenster hat den Fokus verloren.',
  hidden: 'Automatisch pausiert: Der Tab war im Hintergrund.',
  stall: 'Automatisch pausiert: Das Gerät oder der Browser war kurz blockiert.',
};

export class Game {
  private canvas = $<HTMLCanvasElement>('stage');
  private renderer = new Renderer(this.canvas);
  private state = new GameState();
  private sound = new Sound();
  private sim: Sim | null = null;
  private best = load().best;
  private runCount = 0;
  private previewS = 0;
  private previewRoad = new Road(0);
  private touchCapable = false;
  private input: Input;
  private loop: FixedLoop;
  private crashAt = 0;
  private recordShown = false;
  private beaten = false;
  private held = new Set<string>();
  private blocked = new Set<string>();
  private overlayArmed = false;
  private seedParam: number | null;
  /** Nur für Tests: reproduzierbarer Szeneneinstieg per URL (?startS=&startT=&turbo=1&qa=1), unsichtbar. */
  private qa: { startS?: number; startT?: number; ghost?: boolean } = {};
  private qaHook = false;
  private qaSceneT: number | null = null;
  private qaPickupEvents = 0;
  private qaNoPickups = false;
  /** Pausen mit Auslöser (Tests, Fehlersuche) und Fokusstatus: ohne Fokus von Anfang an (z. B. eingebetteter Browser) wird nicht bei blur pausiert. */
  private pauseLog: string[] = [];
  private focusKnown = true;
  /** Erstes-Hindernis-Hinweis und Landungssignal. */
  private tutorialDone = load().dodged;
  private firstObsId: number | null = null;
  private landing = false;
  private runPickups = 0;
  private runStartedAt = 0;
  private runCtl = false;
  private runDodged = false;
  private runFlew = false;
  private mode: Mode = 'endless';
  private challenge: { ok: boolean; reach: number | null } | null = null;
  private sprintBest = load().sprintBest;
  private sprintDone = load().sprintDone;
  private lastReach = 0;
  private lastGoal = false;
  private crashToken = 0;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  /** Konfiguration (Admin) und Messung. Testfahrt (?testdrive=) und QA-Läufe zählen weder für KPIs noch für die Bestweite. */
  private remote: RemoteConfig = BUILTIN;
  private previewToken: string | null = null;
  private tele: Telemetry;
  private runId = '';
  private runSeen = new Set<string>();
  private runMiles = 0;
  private runOpen = false;
  private excluded = false;

  // zuletzt in das DOM geschriebene Werte (kein DOM-Update pro Frame ohne Änderung)
  private last = { dist: '', speed: '', shield: '', slow: '', magnet: '', blitz: '', glide: '', boost: '', guide: '' };

  private el = {
    hud: $('hud'), dist: $('hud-distance'), best: $('hud-best'), bestWrap: $('hud-best-wrap'), speed: $('hud-speed'),
    shield: $('fx-shield'), slow: $('fx-slow'), magnet: $('fx-magnet'), blitz: $('fx-blitz'), glide: $('fx-glide'), boost: $('fx-boost'), guide: $('fx-guide'), pause: $<HTMLButtonElement>('btn-pause'), snd: $<HTMLButtonElement>('btn-sound'), hint: $('hint'), sprintBar: $('sprint-bar'), sprintBtn: $('btn-sprint'), challengeBox: $('challenge'), shareBtn: $('btn-share'), endlessBtn: $('btn-endless'), resSprintBtn: $('btn-res-sprint'), shareBox: $('share-box'), shareUrl: $<HTMLInputElement>('share-url'), shareMsg: $('share-msg'), resTitle: $('res-title'), resBestLabel: $('res-best-label'), toast: $('fx-toast'), pauseReason: $('pause-reason'),
    start: $('screen-start'), paused: $('screen-pause'), result: $('screen-result'),
    again: $<HTMLButtonElement>('btn-again'),
  };

  constructor() {
    const sp = new URLSearchParams(location.search).get('seed');
    this.seedParam = sp !== null && /^\d+$/.test(sp) ? Number(sp) >>> 0 : null;
    const q = new URLSearchParams(location.search);
    const num = (n: string): number | undefined => { const v = q.get(n); return v !== null && /^\d+$/.test(v) ? Number(v) : undefined; };
    this.qaHook = q.get('qa') === '1';
    this.challenge = SPRINT_ENABLED ? parseChallenge(location.search) : null;           // Herausforderungs-Links öffnen vorerst einfach das Endless-Spiel
    const td = q.get('testdrive');
    this.previewToken = td && /^[A-Za-z0-9_-]{8,128}$/.test(td) ? td : null;
    this.excluded = this.qaHook || this.previewToken !== null;
    this.tele = new Telemetry(!this.excluded);
    this.tele.send('view', undefined, undefined, this.challenge?.ok ? { ch: 1 } : undefined);
    void this.refreshConfig();
    if (this.previewToken) this.showBadge();
    window.addEventListener('pagehide', () => this.endRun('leave'));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void this.refreshConfig(); });
    this.qa = this.qaHook ? { startS: num('startS'), startT: num('startT'), ghost: q.get('ghost') === '1' } : {};
    this.renderer.debug = this.qaHook && q.get('debug') === '1';
    this.renderer.ghost = this.qa.ghost === true;
    if (this.qaHook && q.get('nolots') === '1') this.renderer.lotsOn = false;
    if (this.qaHook) {
      (window as unknown as { __qa: unknown }).__qa = {
        pause: () => this.pause(),
        pauseLog: () => [...this.pauseLog],
        mode: () => this.mode,
        input: () => ({ ...this.input.snapshot() }),
        give: (shield: number, slow = 0, magnet = 0, glide = 0, boost = 0, guide = 0) => { if (this.sim) { this.sim.shieldT = shield; this.sim.slowT = slow; this.sim.magnetT = magnet; if (glide > 0) this.sim.glideT = glide; this.sim.boostT = boost; this.sim.guideT = guide; } },
        scene: (t: number | null) => { this.qaSceneT = t; this.render(1 / 60); },
        /** Simulation um sec Sekunden vorstellen (feste Schritte), anschließend ein Bild zeichnen. target = absolute Querposition q (m). */
        advance: (sec: number, target: number | null = null, dir = 0) => this.qaAdvance(sec, target, dir),
        setQ: (q: number) => { if (this.sim) this.sim.q = q; },
        /** Nur Tests: Generator anhalten und die Strecke leeren. */
        freeze: () => { if (this.sim) { (this.sim.gen as unknown as { update: () => void }).update = () => {}; this.sim.obstacles = []; this.sim.pickups = []; this.sim.blitzT = 0; this.sim.blitzLeft = 0; } },
        place: (spec: { k: 'obstacle' | 'pickup'; kind?: string; type?: string; x: number; dz: number; vz?: number }) => {
          const sim = this.sim; if (!sim) return;
          const id = sim.nextId++;
          if (spec.k === 'pickup') sim.pickups.push({ id, type: spec.type as never, x: spec.x, z: sim.s + spec.dz, taken: false });
          else sim.obstacles.push({ id, kind: (spec.kind ?? 'barrier') as never, x: spec.x, z: sim.s + spec.dz, vz: spec.vz ?? 0, hit: false, knockT: 0, knockVx: 0 });
        },
        noPickups: (on: boolean) => { this.qaNoPickups = on; },
        /** Nur Tests: Zuordnung Bildzeile → Tiefe des letzten Bildes. */
        rows: () => Array.from((this.renderer as unknown as { rowD: Float32Array }).rowD),
        state: () => this.sim && ({
          t: this.sim.t, s: this.sim.s, x: this.sim.q, q: this.sim.q, vq: this.sim.vq, v: this.sim.speedKmh, crashed: this.sim.crashed, k: this.sim.road.curv(this.sim.s), X: this.sim.X, rel: this.sim.relAngle,
          pickupEvents: this.qaPickupEvents, glideT: this.sim.glideT, height: this.sim.height, blitzT: this.sim.blitzT, blitzLeft: this.sim.blitzLeft, shieldT: this.sim.shieldT, slowT: this.sim.slowT, magnetT: this.sim.magnetT, phase: this.state.phase, hill: this.sim.road.height(this.sim.s), boostT: this.sim.boostT, guideT: this.sim.guideT, guideQ: this.sim.guideQ,
          obstacles: this.sim.obstacles.filter((o) => !o.hit && o.z > this.sim!.s - 6).slice(0, 8).map((o) => ({ id: o.id, kind: o.kind, x: o.x, z: o.z, vz: o.vz })),
          pickups: this.sim.pickups.map((p) => ({ type: p.type, x: p.x, z: p.z })),
        }),
      };
    }
    // Modus folgt der tatsächlichen Eingabe: primärer grober Zeiger = Touch; Tastendruck wechselt zu Desktop, Berührung zu Touch
    this.touchCapable = matchMedia('(pointer: coarse)').matches;
    this.state.onChange = (p) => { document.documentElement.dataset.phase = p; };
    document.documentElement.dataset.phase = this.state.phase;
    document.documentElement.classList.toggle('touch', this.touchCapable);
    window.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') this.setMode(true); }, { passive: true });
    window.addEventListener('keydown', (e) => { if (!e.metaKey && !e.ctrlKey && e.code !== 'Tab') this.setMode(false); }, { passive: true });
    this.input = new Input(this.canvas);
    this.loop = new FixedLoop((dt) => this.update(dt), (fd) => this.render(fd), () => this.pause('stall'));

    $('start-best').textContent = formatDistance(this.best);
    this.el.best.textContent = formatDistance(this.best);
    // Spielhilfe geöffnet: im Smartphone-Layout in den sichtbaren Bereich über Statistikabfrage/Browserleiste scrollen
    const about = document.getElementById('about') as HTMLDetailsElement | null;
    about?.addEventListener('toggle', () => { if (about.open && document.documentElement.classList.contains('touch')) requestAnimationFrame(() => about.scrollIntoView({ block: 'end' })); });
    this.syncHowto();
    this.el.sprintBtn.hidden = !SPRINT_ENABLED;
    this.showChallenge();
    $('tip-line').textContent = this.touchCapable ? TEXT.tipTouch : TEXT.tipDesktop;
    this.syncSoundButton();
    this.bind();
    this.resize();
    this.loop.start();
    this.el.start.querySelector('button')?.focus();
    // 80er-Musik schon im Startbildschirm: sofort versuchen, spätestens mit der ersten Eingabe (Autoplay-Regeln der Browser)
    this.sound.menuMusic();
    const arm = (): void => { if (this.state.phase === 'preview') this.sound.menuMusic(); };
    window.addEventListener('pointerdown', arm, { passive: true });
    window.addEventListener('keydown', arm, { passive: true });
    window.addEventListener('touchend', arm, { passive: true });
  }

  // ---------- Verdrahtung ----------
  private bind(): void {
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => this.resize());
    // Automatische Pause nur, wenn das Fenster den Fokus tatsächlich verliert. Hatte es ihn beim Start/Fortsetzen nie (eingebettete Ansicht), gäbe es sonst eine Dauer-Pause.
    window.addEventListener('blur', () => { if (this.focusKnown) this.pause('blur'); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.pause('hidden'); });
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => { this.held.delete(e.code); this.blocked.delete(e.code); if (this.isActionKey(e.code) && this.overlayVisible() && !this.nativeTarget(e.target)) e.preventDefault(); });

    this.el.pause.addEventListener('click', () => this.pause());
    this.el.snd.addEventListener('click', () => { this.sound.unlock(); this.sound.toggle(); this.syncSoundButton(); });
    for (const o of [this.el.start, this.el.paused, this.el.result]) {
      o.addEventListener('pointerdown', () => { this.overlayArmed = true; });
      o.addEventListener('click', (e) => {
        if (!this.overlayArmed && (e as MouseEvent).detail !== 0) return;
        if ((e as MouseEvent).detail === 0 && this.blocked.size > 0) return;       // Taste vom Crash noch gehalten: kein Durchstarten
        this.overlayArmed = false;
        const b = (e.target as Element).closest('button[data-action]') as HTMLElement | null;
        // Startbildschirm: nur der Knopf startet (ein Wisch oder Tipp auf Titel und Erklärung löst nichts aus)
        if (o === this.el.start && !b) return;
        this.act(b?.dataset.action ?? o.dataset.default ?? '');
      });
    }
  }

  private nativeTarget(t: EventTarget | null): boolean { return !!(t as HTMLElement | null)?.closest?.('button, a[href], summary, input, select, textarea, [contenteditable]'); }

  private isActionKey = (c: string): boolean => c === 'Enter' || c === 'Space' || c === 'NumpadEnter';
  private overlayVisible = (): boolean => !this.el.start.hidden || !this.el.paused.hidden || !this.el.result.hidden;

  private onKeyDown(e: KeyboardEvent): void {
    this.held.add(e.code);
    if (e.code === 'Escape') {
      if (this.state.phase === 'running') this.pause();
      else if (this.state.phase === 'paused') this.act('resume');
      return;
    }
    if (!this.isActionKey(e.code)) return;
    // Fokussierte Bedienelemente (Buttons, Links, Summary, Eingabefelder) führen Enter/Leertaste selbst aus – genau eine Aktion, die globalen Kürzel greifen sonst
    if (this.nativeTarget(e.target)) return;
    if (!this.overlayVisible()) return;
    e.preventDefault();
    if (e.repeat || this.blocked.has(e.code)) return;
    this.act(this.state.phase === 'preview' ? 'start' : this.state.phase === 'paused' ? 'resume' : 'again');
  }

  private act(action: string): void {
    this.sound.unlock();
    switch (action) {
      case 'start': if (this.state.phase === 'preview') this.startRun('endless'); break;
      case 'sprint':
        if (this.state.phase === 'preview' || (this.state.phase === 'crashed' && performance.now() - this.crashAt >= B.restartDelayMs)) this.startRun('sprint');
        break;
      case 'endless':
        if (this.state.phase === 'crashed' && performance.now() - this.crashAt >= B.restartDelayMs) this.startRun('endless');
        break;
      case 'again':
        if (this.state.phase === 'crashed' && performance.now() - this.crashAt >= B.restartDelayMs) this.startRun(this.mode);
        break;
      case 'share': void this.share(); break;
      case 'copy': void this.copyLink(); break;
      case 'resume': if (this.state.phase === 'paused') this.resume(); break;
      case 'restart': if (this.state.phase === 'paused') this.startRun(this.mode); break;
    }
  }

  // ---------- Ablauf ----------
  /** Neuer Versuch: startet sofort, ohne Zwischenbildschirm. */
  /** Aktuelle Konfiguration holen; schlägt es fehl, bleibt der letzte Stand (oder die eingebauten Werte). */
  private async refreshConfig(): Promise<void> {
    const c = await fetchConfig(this.previewToken);
    if (c) this.remote = c;
  }

  private showBadge(): void {
    const b = document.createElement('div');
    b.id = 'testdrive-badge';
    b.textContent = 'Testfahrt · Entwurf – zählt nicht';
    b.setAttribute('role', 'status');
    document.body.appendChild(b);
  }

  /** Ende eines Versuchs melden (genau einmal je Versuch). */
  private endRun(reason: 'crash' | 'restart' | 'leave' | 'goal', cause?: string): void {
    if (!this.runOpen || !this.sim) return;
    this.runOpen = false;
    this.tele.send('end', this.runId, undefined, { dist: Math.floor(this.sim.s), reason, cause });
    if (reason === 'leave') this.tele.flush(true);
  }

  private startRun(mode: Mode = this.mode): void {
    if (!SPRINT_ENABLED) mode = 'endless';
    this.endRun('restart');
    this.mode = mode;
    // Der Versuch übernimmt seine Regeln fest. Endless: veröffentlichte Konfiguration (spätere Änderungen gelten erst für den nächsten Versuch);
    // Sprint: feste Regeln der Sprint-Version, unabhängig von der Live-Konfiguration. Beide Wege setzen alle Werte neu, nichts bleibt vom vorigen Modus zurück.
    if (mode === 'sprint') { applyConfig(SPRINT_CONFIG, false); sprintStageScale(true); }
    else applyConfig(this.remote.config, eventActive(this.remote));
    this.sound.applyLevels();
    this.runId = randomId(8);
    this.runSeen.clear();
    this.runMiles = 0;
    this.runOpen = true;
    this.tele.send('start', this.runId, undefined, { cfg: mode === 'sprint' ? `${SPRINT_ID}` : this.remote.id, ev: mode === 'endless' && eventActive(this.remote) ? this.remote.event!.id : null, mode, ch: mode === 'sprint' && this.challenge?.ok ? 1 : 0 });
    const seed = mode === 'sprint' ? SPRINT_SEED : this.seedParam !== null ? (this.seedParam + this.runCount) >>> 0 : newSeed();
    this.runCount++;
    this.sim = new Sim(seed, mode === 'sprint' ? { ...this.qa, script: SPRINT_ROUTE } : this.qa);
    this.el.sprintBar.hidden = mode !== 'sprint';
    this.el.bestWrap.hidden = mode === 'sprint';
    this.el.shareBox.hidden = true;
    this.state.go('running');
    this.beaten = false;
    this.recordShown = false;
    this.input.reset();
    this.input.active = true;
    this.loop.reset();
    this.focusKnown = document.hasFocus();
    this.firstObsId = null; this.landing = false; this.runPickups = 0;
    this.runStartedAt = performance.now(); this.runCtl = false; this.runDodged = false; this.runFlew = false;
    this.el.hint.hidden = true; this.el.toast.hidden = true; this.el.pauseReason.hidden = true;
    this.last = { dist: '', speed: '', shield: '', slow: '', magnet: '', blitz: '', glide: '', boost: '', guide: '' };
    for (const chip of [this.el.shield, this.el.slow, this.el.magnet, this.el.blitz, this.el.glide, this.el.boost, this.el.guide]) chip.hidden = true;   // keine Effekt-Anzeigen aus der vorigen Fahrt
    this.el.start.hidden = this.el.paused.hidden = this.el.result.hidden = true;
    this.el.hud.hidden = false;
    this.el.pause.hidden = false;
    this.el.bestWrap.classList.remove('beat');
    this.el.best.textContent = formatDistance(this.best);
    this.sound.newRun();
    this.sound.sfx('start');
    this.sound.startLoops();
  }

  private setMode(touch: boolean): void {
    if (this.touchCapable === touch) return;
    if (this.state.phase === 'running') return;     // mitten in der Fahrt ändert ein beiläufiger Tastendruck oder emulierter Mausklick weder Hilfe noch Layout
    this.touchCapable = touch;
    document.documentElement.classList.toggle('touch', touch);
    this.syncHowto();
    $('tip-line').textContent = touch ? TEXT.tipTouch : TEXT.tipDesktop;
  }

  /** Lenkhilfe des Startbildschirms: Text und Grafik passend zum zuletzt benutzten Eingabegerät (auch bei Hybridgeräten). */
  private syncHowto(): void {
    $('controls-line').textContent = this.touchCapable ? TEXT.controlsTouch : TEXT.controlsDesktop;
    $('howto').dataset.mode = this.touchCapable ? 'touch' : 'keys';
  }

  private pause(reason: PauseReason = 'manual'): void {
    if (this.state.phase !== 'running') return;
    this.pauseLog.push(reason);
    this.el.pauseReason.textContent = PAUSE_TEXT[reason];
    this.el.pauseReason.hidden = reason === 'manual';
    this.state.go('paused');
    this.input.reset();
    this.input.active = false;
    this.sound.stopLoops();
    this.el.paused.hidden = false;
    this.el.paused.querySelector<HTMLElement>('#btn-resume')?.focus();
  }

  private resume(): void {
    this.el.paused.hidden = true;
    this.focusKnown = document.hasFocus();
    this.state.go('running');
    this.input.reset();
    this.input.active = true;
    this.loop.reset();
    this.sound.startLoops();
    if (this.sim && this.sim.glideT > 0) this.sound.setFlight(true);
  }

  private lastW = 0;

  private resize(): void {
    const r = this.canvas.getBoundingClientRect();
    this.renderer.resize(r.width || innerWidth, r.height || innerHeight);
    // Laufende Eingaben verwerfen, Run bleibt erhalten. Auf dem Smartphone ändert eine ein- oder ausfahrende Browserleiste nur die Höhe:
    // Der Daumenzug (Bezug: x) bleibt dann gültig; erst eine Breitenänderung (Rotation, Split-Screen) beendet ihn.
    const w = Math.round(r.width || innerWidth);
    if (!this.touchCapable || w !== this.lastW) this.input.reset();
    this.lastW = w;
  }

  private qaAdvance(sec: number, target: number | null, dir: number): void {
    const sim = this.sim;
    if (!sim) return;
    const n = Math.round(sec / B.dt);
    for (let i = 0; i < n && !sim.crashed; i++) {
      sim.step(B.dt, { dir, target });
      sim.events.length = 0;
    }
    for (let k = 0; k < 40; k++) this.render(1 / 60); // Kamera einschwingen lassen (nur Testbilder)
  }

  private update(dt: number): void {
    if (this.state.phase !== 'running' || !this.sim) return;
    const sim = this.sim;
    if (this.qaNoPickups) sim.pickups = [];
    sim.step(dt, this.input.snapshot());
    if (sim.events.length) {
      for (const ev of sim.events) {
        if (ev.type === 'shieldHit') { this.renderer.burst('shieldHit'); this.sound.sfx('shieldHit'); this.toast('Schild verbraucht'); }
        else if (ev.type === 'pickup') { this.runPickups++; this.tele.send('taken', this.runId, this.pickupKey(ev.pickup, ev.id, ev.z), { type: ev.pickup, s: Math.floor(sim.s) }); this.qaPickupEvents++; this.renderer.burst(ev.pickup); this.sound.sfx(ev.pickup); if (ev.pickup !== 'glide') this.toast(PICKUP_LABEL[ev.pickup as PickupKey] ?? ev.pickup, 1000); }
        else if (ev.type === 'cleared') { this.renderer.burst('clear'); }
        else if (ev.type === 'blitz') this.renderer.laneFlash(ev.x, ev.z);
        else if (ev.type === 'glideStart') { this.renderer.burst('glide'); this.sound.setFlight(true); this.toast('Fliegen'); if (!this.runFlew) { this.runFlew = true; this.tele.send('fly', this.runId); } }
        else if (ev.type === 'glideEnd') { this.renderer.burst('land'); this.sound.sfx('land'); this.sound.setFlight(false); }
        else if (ev.type === 'magnetPull') this.sound.sfx('magnet');
        else if (ev.type === 'effectEnd') this.sound.sfx('effectEnd');
      }
      sim.events.length = 0;
    }
    if (!this.runCtl) { this.runCtl = true; this.tele.send('ctl', this.runId, undefined, { ms: Math.round(performance.now() - this.runStartedAt) }); }
    this.track(sim);
    this.coach(sim);
    if (this.mode === 'sprint') {
      this.el.sprintBar.style.setProperty('--p', String(Math.min(1, sim.s / SPRINT_FINISH_M)));
      if (!sim.crashed && sim.s >= SPRINT_FINISH_M) { this.onFinish(sim); return; }
    }
    if (this.mode === 'endless' && this.best > 0 && !this.beaten && sim.s > this.best) {
      this.beaten = true;
      this.el.bestWrap.classList.add('beat');
      this.sound.sfx('record');
    }
    if (sim.crashed) this.onCrash();
  }

  /** Ergebnis-Oberfläche je Modus (Endless / Sprint, Absturz / Ziel). */
  private resultFor(kind: 'crash' | 'goal'): void {
    const sprint = this.mode === 'sprint';
    this.el.resTitle.textContent = kind === 'goal' ? 'Ziel erreicht!' : sprint ? 'Dein Sprint' : 'Deine Strecke';
    this.el.resBestLabel.textContent = sprint ? 'Sprint-Bestleistung:' : 'Bestweite:';
    $('res-best').textContent = sprint ? (this.sprintDone > 0 ? `Ziel erreicht (${this.sprintDone}×)` : formatDistance(this.sprintBest)) : formatDistance(this.best);
    this.el.shareBtn.hidden = !sprint;
    this.el.endlessBtn.hidden = !sprint;
    this.el.resSprintBtn.hidden = sprint || !SPRINT_ENABLED;
    this.el.shareBox.hidden = true;
    this.el.shareMsg.textContent = '';
  }

  /** Sprint-Ziel erreicht: Lauf endet (kein Absturz), Fortschritt wird gespeichert. */
  private onFinish(sim: Sim): void {
    this.endRun('goal');
    this.tele.send('goal', this.runId, undefined, { t: Math.round(sim.t - sim.t0), ch: this.challenge?.ok ? 1 : 0 });
    void this.refreshConfig();
    this.state.go('crashed');
    this.input.reset(); this.input.active = false;
    this.crashAt = performance.now();
    this.sound.stopLoops(); this.sound.sfx('record');
    this.blocked.clear();
    for (const c of this.held) if (this.isActionKey(c)) this.blocked.add(c);
    this.lastReach = SPRINT_FINISH_M; this.lastGoal = true;
    if (!this.excluded) { this.sprintDone++; this.sprintBest = SPRINT_FINISH_M; save({ sprintDone: this.sprintDone, sprintBest: SPRINT_FINISH_M }); }
    else this.sprintDone++;
    this.recordShown = false;
    $('res-dist').textContent = formatDistance(SPRINT_FINISH_M);
    $('res-record').hidden = true;
    $('res-cause').textContent = 'Du hast die Neonnacht erreicht.';
    $('res-goal').textContent = 'Teile den Sprint und fordere einen Freund heraus.';
    this.resultFor('goal');
    this.el.again.disabled = true;
    this.el.pause.hidden = true;
    const token = ++this.crashToken;
    window.setTimeout(() => { if (this.state.phase !== 'crashed' || token !== this.crashToken) return; this.el.result.hidden = false; this.overlayArmed = false; }, 450);
    window.setTimeout(() => { if (this.state.phase !== 'crashed' || token !== this.crashToken) return; this.el.again.disabled = false; this.el.again.focus(); }, B.restartDelayMs + 150);
  }

  // ---------- Herausforderung teilen und empfangen ----------
  private showChallenge(): void {
    const c = this.challenge;
    if (!c) return;
    const km = (m: number): string => (m / 1000).toFixed(1).replace('.', ',');
    this.el.challengeBox.hidden = false;
    if (!c.ok) {
      this.el.challengeBox.textContent = 'Diese Herausforderung gibt es nicht mehr. Starte den aktuellen Sunset Sprint oder fahre Endless.';
      return;
    }
    const from = c.reach === null ? '' : c.reach >= SPRINT_FINISH_M ? ' Absender: Ziel erreicht (Angabe des Absenders).' : ` Absender: ${km(c.reach)} km weit (Angabe des Absenders).`;
    this.el.challengeBox.textContent = `Herausforderung: Sunset Sprint – erreiche die Neonnacht nach ${km(SPRINT_FINISH_M)} km.${from} Starte, wenn du bereit bist.`;
    this.el.sprintBtn.classList.add('invited');
  }

  private shareUrl(): string { return `${location.origin}/?sprint=${SPRINT_ID}&c=${this.lastReach}`; }

  private async share(): Promise<void> {
    const url = this.shareUrl();
    const km = (this.lastReach / 1000).toFixed(1).replace('.', ',');
    const text = this.lastGoal ? 'Ich habe den Sunset Sprint bis in die Neonnacht geschafft. Schaffst du das auch?' : `Ich bin im Sunset Sprint ${km} km weit gekommen. Schaffst du mehr?`;
    this.el.shareUrl.value = url;
    this.el.shareBox.hidden = false;
    try {
      if (typeof navigator.share === 'function') { await navigator.share({ title: 'Sunset Sideways – Sunset Sprint', text, url }); this.el.shareMsg.textContent = 'Geteilt.'; return; }
    } catch (e) { if ((e as Error).name === 'AbortError') { this.el.shareMsg.textContent = ''; return; } }
    await this.copyLink();
  }

  private async copyLink(): Promise<void> {
    const url = this.shareUrl();
    this.el.shareUrl.value = url; this.el.shareBox.hidden = false;
    try { await navigator.clipboard.writeText(url); this.el.shareMsg.textContent = 'Link kopiert. Du kannst ihn jetzt einfügen und verschicken.'; }
    catch { this.el.shareUrl.focus(); this.el.shareUrl.select(); this.el.shareMsg.textContent = 'Markiert: Link bitte selbst kopieren.'; }
  }

  private toast(text: string, ms = 1300): void {
    this.el.toast.textContent = text;
    this.el.toast.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { this.el.toast.hidden = true; }, ms);
  }

  /**
   * Hinweis zum ersten Hindernis: erscheint, solange es in der eigenen Spur liegt und noch nie erfolgreich umfahren wurde,
   * verschwindet beim Ausweichen und wird nach erfolgreichem Passieren dauerhaft gespeichert (nicht in QA-/Testfahrten). Ohne Ton und Farbe lesbar (Pfeile + Text).
   */
  private coach(sim: Sim): void {
    if (this.firstObsId === null && sim.obstacles.length) this.firstObsId = Math.min(...sim.obstacles.map((o) => o.id));
    if (this.firstObsId === null) return;
    const o = sim.obstacles.find((x) => x.id === this.firstObsId);
    if (!o) { this.el.hint.hidden = true; return; }
    const passed = sim.s > o.z + KINDS[o.kind].len + 2;
    if (passed && !o.hit && !this.runDodged) {                         // erstes erfolgreiches Ausweichen dieses Laufs
      this.runDodged = true;
      this.tele.send('dodge', this.runId);
      if (!this.tutorialDone) { this.tutorialDone = true; if (!this.excluded) save({ dodged: true }); }
    }
    if (this.tutorialDone) { if (!this.el.hint.hidden) this.el.hint.hidden = true; return; }
    const inLane = Math.abs(sim.q - o.x) < 2.6;
    const show = inLane && !o.hit && o.z > sim.s - 1;
    this.el.hint.hidden = !show;
    if (show) this.placeHint(o.x, o.z, o.kind === 'truck' ? 4.2 : 2.4);
  }

  /** Der Hinweis sitzt knapp über dem Hindernis und wandert mit ihm nach unten: nah am Gefahrenort, ohne es zu verdecken (Grenzen: unter dem HUD, über dem Wagen). */
  private placeHint(x: number, z: number, h: number): void {
    const p = this.renderer.screenAt(x, z, h), v = this.renderer.viewSize;
    if (!p || !v.w) return;
    const st = this.el.hint.style;
    const k = this.canvas.clientWidth / v.w;                          // Zeichenfläche → CSS-Pixel (die Zeichenauflösung kann kleiner sein)
    const top = Math.min(v.h * 0.56, Math.max(v.hy + 26 / k, p.sy - 16 / k));
    st.left = Math.round(Math.min(this.canvas.clientWidth - 110, Math.max(110, p.sx * k))) + 'px';
    st.top = Math.round(top * k) + 'px';
    this.el.hint.classList.add('at');
  }

  private pickupKey(type: string, id: number, z: number): string { return type === 'glide' ? `glide@${Math.round(z)}` : `${type}#${id}`; }

  /** Messpunkte während der Fahrt: Power-ups im Sichtbereich (je Objekt einmal) und Streckenmarken. */
  private track(sim: Sim): void {
    if (!this.tele.enabled) return;
    for (const p of sim.pickups) {
      if (p.taken || p.z <= sim.s || p.z - sim.s > 220) continue;
      const k = this.pickupKey(p.type, p.id, p.z);
      if (this.runSeen.has(k)) continue;
      this.runSeen.add(k);
      this.tele.send('seen', this.runId, k, { type: p.type, s: Math.floor(sim.s) });
    }
    const marks = [1000, 5000, 15000, 20000, 27000];
    while (this.runMiles < marks.length && sim.s >= marks[this.runMiles]) { this.tele.send('mile', this.runId, String(marks[this.runMiles])); this.runMiles++; }
  }

  private onCrash(): void {
    const sim = this.sim!;
    this.endRun('crash', sim.crash?.kind);
    void this.refreshConfig();
    this.state.go('crashed');
    this.input.reset();
    this.input.active = false;
    this.crashAt = performance.now();
    this.renderer.burst('crash');
    this.sound.stopLoops();
    this.sound.sfx('crash');
    this.blocked.clear();
    for (const c of this.held) if (this.isActionKey(c)) this.blocked.add(c); // gehaltene Taste startet nicht neu
    const dist = Math.floor(sim.s);
    const sprint = this.mode === 'sprint';
    const record = !sprint && !this.excluded && dist > this.best;
    if (record) { this.best = dist; save({ best: dist }); }
    let sprintRecord = false;
    if (sprint) {
      this.lastReach = Math.min(dist, SPRINT_FINISH_M); this.lastGoal = false;
      sprintRecord = !this.excluded && this.lastReach > this.sprintBest;
      if (sprintRecord) { this.sprintBest = this.lastReach; save({ sprintBest: this.sprintBest }); }
    }
    this.recordShown = record || sprintRecord;
    $('res-dist').textContent = formatDistance(dist);
    $('res-record').hidden = !this.recordShown;
    $('res-cause').textContent = crashCauseText(sim.crash?.kind);
    $('res-goal').textContent = sprint ? `Ziel: Noch ${Math.max(10, Math.round((SPRINT_FINISH_M - dist) / 10) * 10)} m bis zur Neonnacht.` : nextGoalText(dist, this.best, this.recordShown, this.runPickups);
    this.resultFor('crash');
    $('start-best').textContent = formatDistance(this.best);
    this.el.again.disabled = true;
    this.el.pause.hidden = true;
    const token = ++this.crashToken;                                     // veraltete Timer eines früheren Absturzes wirken nie auf den nächsten Lauf
    window.setTimeout(() => {
      if (this.state.phase !== 'crashed' || token !== this.crashToken) return;
      this.el.result.hidden = false;
      this.overlayArmed = false;
      if (this.recordShown) this.sound.sfx('record');
    }, 300);
    window.setTimeout(() => {
      if (this.state.phase !== 'crashed' || token !== this.crashToken) return;
      this.el.again.disabled = false;
      this.el.again.focus();
    }, B.restartDelayMs);
  }

  // ---------- Darstellung ----------
  private render(frameDt: number): void {
    const sim = this.sim;
    let v: View;
    if (this.state.phase === 'preview' || !sim) {
      this.previewS = (this.previewS + frameDt * 70) % 300;
      const pz = this.previewS;
      v = { s: pz, x: 0, X: this.previewRoad.center(pz), bodyYaw: Math.atan(this.previewRoad.heading(pz)), phi: this.previewRoad.heading(pz), rel: 0, speedKmh: 0, shield: false, shieldFrac: 1, slow: false, magnet: false, blitz: false, boost: false, guide: null, lift: 0, glideLeft: 0, slowAge: -1, obstacles: [], pickups: [], crash: null, running: false, sceneT: this.qaSceneT ?? 0, seed: 0, road: this.previewRoad };
    } else {
      const running = this.state.phase === 'running' || this.qaHook;
      v = {
        s: sim.s, x: sim.q, X: sim.X, bodyYaw: sim.bodyYaw, phi: sim.phi, rel: sim.relAngle, slow: sim.slowT > 0, magnet: sim.magnetT > 0, blitz: sim.blitzT > 0, boost: sim.boostT > 0, guide: sim.guideQ, lift: sim.height, glideLeft: sim.glideT, slowAge: sim.slowT > 0 ? B.effects.slow - sim.slowT : -1, road: sim.road, speedKmh: sim.speedKmh, shield: sim.shieldT > 0,
        shieldFrac: sim.shieldT / B.effects.shield, obstacles: sim.obstacles, pickups: sim.pickups,
        crash: sim.crash ? { id: sim.crash.id } : null, running, sceneT: this.qaSceneT ?? sim.t - sim.t0, seed: sim.seed, finishZ: this.mode === 'sprint' ? SPRINT_FINISH_M : undefined,
      };
      if (running) { this.sound.setLight(lightT(sim.s)); this.sound.update(sim.speedKmh, false, 0); }
    }
    this.renderer.draw(v, this.state.phase === 'paused' && !this.qaHook ? 0 : frameDt);
    if (sim && this.state.phase !== 'preview') this.updateHud(sim);
  }

  private updateHud(sim: Sim): void {
    const dist = formatDistance(sim.s);
    if (dist !== this.last.dist) { this.last.dist = dist; this.el.dist.textContent = dist; }
    const sp = String(Math.round(sim.speedKmh));
    if (sp !== this.last.speed) { this.last.speed = sp; this.el.speed.textContent = sp; }
    this.fxChip(this.el.shield, sim.shieldT, 'shield');
    this.fxChip(this.el.slow, sim.slowT, 'slow');
    this.fxChip(this.el.magnet, sim.magnetT, 'magnet');
    this.fxChip(this.el.blitz, sim.blitzT, 'blitz');
    this.fxChip(this.el.glide, sim.glideT, 'glide');
    const landing = sim.glideT > 0 && sim.glideT < 1.0;
    if (landing !== this.landing) {
      this.landing = landing;
      this.el.glide.classList.toggle('landing', landing);
      const nm = this.el.glide.querySelector('.fx-name'); if (nm) nm.textContent = landing ? 'Landung' : 'Fliegen';
      if (landing) this.sound.sfx('effectEnd');
    }
    this.fxChip(this.el.boost, sim.boostT, 'boost');
    this.fxChip(this.el.guide, sim.guideT, 'guide');
  }

  private fxChip(li: HTMLElement, remaining: number, key: 'shield' | 'slow' | 'magnet' | 'blitz' | 'glide' | 'boost' | 'guide'): void {
    const txt = remaining > 0 ? `${remaining.toFixed(1).replace('.', ',')} s` : '';
    if (this.last[key] === txt) return;
    this.last[key] = txt;
    li.hidden = remaining <= 0;
    const t = li.querySelector('.fx-time');
    if (t) t.textContent = txt;
  }

  private syncSoundButton(): void {
    this.el.snd.setAttribute('aria-pressed', String(this.sound.muted));
    this.el.snd.setAttribute('aria-label', this.sound.muted ? 'Ton einschalten' : 'Ton ausschalten');
  }
}
