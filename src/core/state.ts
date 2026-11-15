export type Phase = 'preview' | 'briefing' | 'running' | 'paused' | 'crashed';

/** Minimale Zustandsmaschine; erlaubte Übergänge zentral. */
const ALLOWED: Record<Phase, Phase[]> = {
  preview: ['briefing', 'running'],
  briefing: ['running', 'paused'],
  running: ['paused', 'crashed'],
  paused: ['running', 'briefing'],
  crashed: ['briefing', 'running'],
};

export class GameState {
  phase: Phase = 'preview';
  /** Wird nach jedem erlaubten Übergang gerufen (z. B. um die Phase am Dokument zu spiegeln). */
  onChange: ((p: Phase) => void) | null = null;
  go(next: Phase): boolean {
    if (!ALLOWED[this.phase].includes(next)) return false;
    this.phase = next;
    this.onChange?.(next);
    return true;
  }
}
