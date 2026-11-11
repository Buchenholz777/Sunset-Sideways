let csrf = '';

export class ApiError extends Error {
  constructor(public status: number, public data: Record<string, unknown>) { super(String(data.error ?? `Fehler ${status}`)); }
}

export async function boot(): Promise<void> {
  const r = await fetch('/admin/api/me', { credentials: 'same-origin', cache: 'no-store' });
  if (r.status === 401) { location.reload(); throw new ApiError(401, {}); }
  csrf = ((await r.json()) as { csrf: string }).csrf;
}

export async function api<T = unknown>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/admin/api${path}`, {
    method, credentials: 'same-origin', cache: 'no-store',
    headers: method === 'GET' ? {} : { 'content-type': 'application/json', 'x-csrf-token': csrf },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
  const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (r.status === 401) { location.reload(); throw new ApiError(401, data); }
  if (!r.ok) throw new ApiError(r.status, data);
  return data as T;
}
