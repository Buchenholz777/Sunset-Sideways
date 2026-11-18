/**
 * Anzeigename der Weltrangliste (gemeinsam für Spiel und Server). 3–16 Zeichen, nur Buchstaben, Ziffern, Leerzeichen, Punkt, Bindestrich und Unterstrich;
 * keine Steuerzeichen und kein HTML (Zeichen wie < > & " ' / sind nicht erlaubt). Einfache Prüfung gegen offensichtliche Beleidigungen
 * (Kleinschreibung, Leetspeak, wiederholte Buchstaben normalisiert) – bewusst kein vollständiger Filter; Meldungen und Sperren laufen über den Admin.
 */
export const NAME_MIN = 3;
export const NAME_MAX = 16;

/** Längere Begriffe: Teilstring-Treffer im normalisierten Namen. */
const BLOCK_SUB = ['arschloch', 'wichser', 'hurensohn', 'fotze', 'schlampe', 'scheisse', 'scheiße', 'kanake', 'neger', 'nigger', 'nigga', 'fuck', 'bitch', 'asshole', 'faggot', 'hitler', 'nazi', 'vergewaltig', 'mongo', 'spast', 'cunt', 'whore', 'dickhead', 'motherfucker', 'schwuchtel', 'missgeburt'];
/** Kurze Begriffe: nur als ganzes Wort. */
const BLOCK_WORD = ['fick', 'shit', 'hure', 'nutte', 'sau', 'kz', 'ss', 'sex', 'porn', 'porno', 'penis', 'anal', 'rape', 'nsdap', 'afd', 'idiot', 'depp', 'trottel', 'pisser', 'arsch'];

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i', 'ä': 'a', 'ö': 'o', 'ü': 'u', 'ß': 'ss' };

function squash(s: string): string {
  const low = s.toLowerCase().replace(/[013457@$!äöüß]/g, (c) => LEET[c] ?? c);
  return low.replace(/[^a-z]/g, '').replace(/(.)\1+/g, '$1');
}

/** Wahr, wenn der Name offensichtlich beleidigend ist. */
export function isOffensive(name: string): boolean {
  const flat = squash(name);
  const flatKeep = name.toLowerCase().replace(/[013457@$!äöüß]/g, (c) => LEET[c] ?? c).replace(/[^a-z]/g, '');
  if (BLOCK_SUB.some((w) => flatKeep.includes(w.replace(/(.)\1+/g, '$1')) || flat.includes(w.replace(/(.)\1+/g, '$1')))) return true;
  const words = name.toLowerCase().split(/[^a-z0-9äöüß@$]+/).filter(Boolean).map((w) => w.replace(/[013457@$!äöüß]/g, (c) => LEET[c] ?? c).replace(/(.)\1+/g, '$1'));
  return words.some((w) => BLOCK_WORD.some((b) => w === b.replace(/(.)\1+/g, '$1')));
}

export type NameCheck = { ok: true; name: string } | { ok: false; error: string };

/** Prüft und bereinigt einen Namen (Unicode-Normalform, Leerzeichen zusammengefasst). */
export function cleanName(raw: unknown): NameCheck {
  if (typeof raw !== 'string') return { ok: false, error: 'Bitte einen Namen eingeben.' };
  const name = raw.normalize('NFKC').replace(/\s+/g, ' ').trim();
  const len = [...name].length;
  if (len < NAME_MIN) return { ok: false, error: `Der Name braucht mindestens ${NAME_MIN} Zeichen.` };
  if (len > NAME_MAX) return { ok: false, error: `Der Name darf höchstens ${NAME_MAX} Zeichen haben.` };
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u.test(name)) return { ok: false, error: 'Erlaubt sind Buchstaben, Ziffern, Leerzeichen sowie . _ -' };
  if ((name.match(/[\p{L}\p{N}]/gu) ?? []).length < 2) return { ok: false, error: 'Bitte einen Namen mit Buchstaben oder Ziffern wählen.' };
  if (isOffensive(name)) return { ok: false, error: 'Dieser Name ist nicht erlaubt. Bitte einen anderen wählen.' };
  return { ok: true, name };
}
