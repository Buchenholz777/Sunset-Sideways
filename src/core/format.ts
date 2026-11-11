/** Deutsche Streckenanzeige: unter 1 km ganze Meter, sonst km mit zwei Nachkommastellen. */
export function formatDistance(meters: number): string {
  const m = Math.max(0, Math.floor(meters));
  if (m < 1000) return `${m} m`;
  return `${(m / 1000).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km`;
}
