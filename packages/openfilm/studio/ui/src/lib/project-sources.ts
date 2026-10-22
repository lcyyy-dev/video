/** Local project folders: browsing, opening and locating moved projects. */
export type BrowseFolder = { name: string; path: string; film: boolean };
export type BrowseListing = {
  path: string;
  root: string;
  parent: string | null;
  name: string;
  film: boolean;
  folders: BrowseFolder[];
  more: boolean;
  places: { id: string; path: string }[];
  recent: string[];
};
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
  browse: (path?: string | null) => call<BrowseListing>(`browse${path ? `?path=${encodeURIComponent(path)}` : ''}`),
  openExisting: (path: string) => call<{ project: { id: string } }>('projects', 'POST', { path, create: false }).then((r) => r.project),
  locate: (id: string, path: string) => call<{ project: { id: string } }>(`projects/${encodeURIComponent(id)}/locate`, 'POST', { path }).then((r) => r.project),
};

export function pathCrumbs(path: string, root: string, rootName = '~'): { name: string; path: string }[] {
  const sep = path.includes('\\') && !path.includes('/') ? '\\' : '/';
  const trim = (p: string) => (p.length > 1 && (p.endsWith('/') || p.endsWith('\\')) ? p.slice(0, -1) : p);
  const at = trim(path);
  const top = trim(root);
  const inside = at === top || at.startsWith(top === sep ? top : `${top}${sep}`);
  if (!inside) return [{ name: at, path: at }];
  const crumbs = [{ name: rootName, path: top }];
  let walked = top;
  for (const part of at.slice(top.length).split(sep).filter(Boolean)) {
    walked = `${walked}${sep}${part}`;
    crumbs.push({ name: part, path: walked });
  }
  return crumbs;
}
