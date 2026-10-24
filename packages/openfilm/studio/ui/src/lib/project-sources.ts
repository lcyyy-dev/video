/** Local project folders: browsing, opening and locating moved projects. */
export class SourceError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function call<T>(path: string, method = 'GET', json?: unknown): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    method,
    ...(json === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(json) }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new SourceError(String(body.error ?? `Studio answered ${res.status}`), res.status, typeof body.code === 'string' ? body.code : null);
  return body as T;
}

export const sourcesApi = {
  openExisting: (path: string) => call<{ project: { id: string } }>('projects', 'POST', { path, create: false }).then((r) => r.project),
  locate: (id: string, path: string) => call<{ project: { id: string } }>(`projects/${encodeURIComponent(id)}/locate`, 'POST', { path }).then((r) => r.project),
};
