import { locale } from '../i18n';

/** Streckenanzeige in der gewählten Sprache: unter 1 km ganze Meter, sonst km mit zwei Nachkommastellen. */
export function formatDistance(meters: number): string {
  const m = Math.max(0, Math.floor(meters));
  if (m < 1000) return `${m} m`;
  return `${(m / 1000).toLocaleString(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km`;
}
