import { BALANCE as B } from './config/balance';
import { TEXT } from './config/meta';
import { FixedLoop } from './core/loop';
import { formatDistance } from './core/format';
import { newSeed } from './core/rng';
import { GameState } from './core/state';
import { Input } from './input/input';
import { Renderer, type View } from './render/renderer';
import { Sim } from './sim/sim';
import { Road } from './sim/road';
import { lightT } from './render/scenery';
import { Sound } from './audio/sound';
import { load, save } from './storage/storage';
import { applyConfig } from './config/runtime';
import { BUILTIN, Telemetry, eventActive, fetchConfig, randomId, type RemoteConfig } from './net/remote';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

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
    shield: $('fx-shield'), slow: $('fx-slow'), magnet: $('fx-magnet'), blitz: $('fx-blitz'), glide: $('fx-glide'), boost: $('fx-boost'), guide: $('fx-guide'), pause: $<HTMLButtonElement>('btn-pause'), snd: $<HTMLButtonElement>('btn-sound'),
    start: $('screen-start'), paused: $('screen-pause'), result: $('screen-result'),
    again: $<HTMLButtonElement>('btn-again'),
  };

  constructor() {
    const sp = new URLSearchParams(location.search).get('seed');
    this.seedParam = sp !== null && /^\d+$/.test(sp) ? Number(sp) >>> 0 : null;
    const q = new URLSearchParams(location.search);
    const num = (n: string): number | undefined => { const v = q.get(n); return v !== null && /^\d+$/.test(v) ? Number(v) : undefined; };
    this.qaHook = q.get('qa') === '1';
    const td = q.get('testdrive');
    this.previewToken = td && /^[A-Za-z0-9_-]{8,128}$/.test(td) ? td : null;
    this.excluded = this.qaHook || this.previewToken !== null;
    this.tele = new Telemetry(!this.excluded);
    this.tele.send('view');
    void this.refreshConfig();
    if (this.previewToken) this.showBadge();
    window.addEventListener('pagehide', () => this.endRun('leave'));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void this.refreshConfig(); });
    this.qa = this.qaHook ? { startS: num('startS'), startT: num('startT'), ghost: q.get('ghost') === '1' } : {};
    this.renderer.debug = this.qaHook && q.get('debug') === '1';
    this.renderer.ghost = this.qa.ghost === true;
    if (this.qaHook) {
      (window as unknown as { __qa: unknown }).__qa = {
        pause: () => this.pause(),
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
    window.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') this.setMode(true); }, { passive: true });
    window.addEventListener('keydown', (e) => { if (!e.metaKey && !e.ctrlKey && e.code !== 'Tab') this.setMode(false); }, { passive: true });
    this.input = new Input(this.canvas);
    this.loop = new FixedLoop((dt) => this.update(dt), (fd) => this.render(fd), () => this.pause());

    $('start-best').textContent = formatDistance(this.best);
    this.el.best.textContent = formatDistance(this.best);
    this.syncHowto();
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
    window.addEventListener('blur', () => this.pause());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.pause(); });
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => { this.held.delete(e.code); this.blocked.delete(e.code); if (this.isActionKey(e.code) && this.overlayVisible() && !(e.target as Element | null)?.closest?.('#about')) e.preventDefault(); });

    this.el.pause.addEventListener('click', () => this.pause());
    this.el.snd.addEventListener('click', () => { this.sound.unlock(); this.sound.toggle(); this.syncSoundButton(); });
    for (const o of [this.el.start, this.el.paused, this.el.result]) {
      o.addEventListener('pointerdown', () => { this.overlayArmed = true; });
      o.addEventListener('click', (e) => {
        if (!this.overlayArmed && (e as MouseEvent).detail !== 0) return;
        this.overlayArmed = false;
        const b = (e.target as Element).closest('button[data-action]') as HTMLElement | null;
        // Startbildschirm: nur der Knopf startet (ein Wisch oder Tipp auf Titel und Erklärung löst nichts aus)
        if (o === this.el.start && !b) return;
        this.act(b?.dataset.action ?? o.dataset.default ?? '');
      });
    }
  }

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
    const t = e.target as HTMLElement | null;
    if (t && (t.closest('#hud-btns') || t.closest('#about'))) return; // HUD-Buttons und die aufklappbare Spielbeschreibung behalten ihr natives Verhalten
    if (!this.overlayVisible()) return;
    e.preventDefault();
    if (e.repeat || this.blocked.has(e.code)) return;
    this.act(this.state.phase === 'preview' ? 'start' : this.state.phase === 'paused' ? 'resume' : 'again');
  }

  private act(action: string): void {
    this.sound.unlock();
    switch (action) {
      case 'start': if (this.state.phase === 'preview') this.startRun(); break;
      case 'again':
        if (this.state.phase === 'crashed' && performance.now() - this.crashAt >= B.restartDelayMs) this.startRun();
        break;
      case 'resume': if (this.state.phase === 'paused') this.resume(); break;
      case 'restart': if (this.state.phase === 'paused') this.startRun(); break;
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
  private endRun(reason: 'crash' | 'restart' | 'leave', cause?: string): void {
    if (!this.runOpen || !this.sim) return;
    this.runOpen = false;
    this.tele.send('end', this.runId, undefined, { dist: Math.floor(this.sim.s), reason, cause });
    if (reason === 'leave') this.tele.flush(true);
  }

  private startRun(): void {
    this.endRun('restart');
    // Der Versuch übernimmt die veröffentlichte Konfiguration fest; spätere Änderungen gelten erst für den nächsten Versuch.
    applyConfig(this.remote.config, eventActive(this.remote));
    this.sound.applyLevels();
    this.runId = randomId(8);
    this.runSeen.clear();
    this.runMiles = 0;
    this.runOpen = true;
    this.tele.send('start', this.runId, undefined, { cfg: this.remote.id, ev: eventActive(this.remote) ? this.remote.event!.id : null });
    const seed = this.seedParam !== null ? (this.seedParam + this.runCount) >>> 0 : newSeed();
    this.runCount++;
    this.sim = new Sim(seed, this.qa);
    this.state.go('running');
    this.beaten = false;
    this.recordShown = false;
    this.input.reset();
    this.input.active = true;
    this.loop.reset();
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
    this.touchCapable = touch;
    this.syncHowto();
    $('tip-line').textContent = touch ? TEXT.tipTouch : TEXT.tipDesktop;
  }

  /** Lenkhilfe des Startbildschirms: Text und Grafik passend zum zuletzt benutzten Eingabegerät (auch bei Hybridgeräten). */
  private syncHowto(): void {
    $('controls-line').textContent = this.touchCapable ? TEXT.controlsTouch : TEXT.controlsDesktop;
    $('howto').dataset.mode = this.touchCapable ? 'touch' : 'keys';
  }

  private pause(): void {
    if (this.state.phase !== 'running') return;
    this.state.go('paused');
    this.input.reset();
    this.input.active = false;
    this.sound.stopLoops();
    this.el.paused.hidden = false;
    this.el.paused.querySelector<HTMLElement>('#btn-resume')?.focus();
  }

  private resume(): void {
    this.el.paused.hidden = true;
    this.state.go('running');
    this.input.reset();
    this.input.active = true;
    this.loop.reset();
    this.sound.startLoops();
    if (this.sim && this.sim.glideT > 0) this.sound.setFlight(true);
  }

  private resize(): void {
    const r = this.canvas.getBoundingClientRect();
    this.renderer.resize(r.width || innerWidth, r.height || innerHeight);
    this.input.reset(); // laufende Eingaben verwerfen, Run bleibt erhalten
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
        if (ev.type === 'shieldHit') { this.renderer.burst('shieldHit'); this.sound.sfx('shieldHit'); }
        else if (ev.type === 'pickup') { this.tele.send('taken', this.runId, this.pickupKey(ev.pickup, ev.id, ev.z), { type: ev.pickup, s: Math.floor(sim.s) }); this.qaPickupEvents++; this.renderer.burst(ev.pickup); this.sound.sfx(ev.pickup); }
        else if (ev.type === 'cleared') { this.renderer.burst('clear'); }
        else if (ev.type === 'blitz') this.renderer.laneFlash(ev.x, ev.z);
        else if (ev.type === 'glideStart') { this.renderer.burst('glide'); this.sound.setFlight(true); }
        else if (ev.type === 'glideEnd') { this.renderer.burst('land'); this.sound.sfx('land'); this.sound.setFlight(false); }
        else if (ev.type === 'magnetPull') this.sound.sfx('magnet');
        else if (ev.type === 'effectEnd') this.sound.sfx('effectEnd');
      }
      sim.events.length = 0;
    }
    this.track(sim);
    if (this.best > 0 && !this.beaten && sim.s > this.best) {
      this.beaten = true;
      this.el.bestWrap.classList.add('beat');
      this.sound.sfx('record');
    }
    if (sim.crashed) this.onCrash();
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
    const record = !this.excluded && dist > this.best;
    if (record) { this.best = dist; save({ best: dist }); }
    this.recordShown = record;
    $('res-dist').textContent = formatDistance(dist);
    $('res-best').textContent = formatDistance(this.best);
    $('start-best').textContent = formatDistance(this.best);
    $('res-record').hidden = !this.recordShown;
    this.el.again.disabled = true;
    this.el.pause.hidden = true;
    window.setTimeout(() => {
      if (this.state.phase !== 'crashed') return;
      this.el.result.hidden = false;
      this.overlayArmed = false;
      if (this.recordShown) this.sound.sfx('record');
    }, 300);
    window.setTimeout(() => {
      if (this.state.phase !== 'crashed') return;
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
        crash: sim.crash ? { id: sim.crash.id } : null, running, sceneT: this.qaSceneT ?? sim.t - sim.t0, seed: sim.seed,
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
