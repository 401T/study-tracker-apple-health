/**
 * Access to claude.ai artifact runtime capabilities (db, user, sample, downloads).
 * Outside a claude.ai artifact (GitHub Pages, local dev) `window.claude` is absent
 * and every capability resolves null; the app then falls back to local storage
 * and hides the Claude features.
 */

/* Minimal local typings for the parts of the runtime this app uses. */
export interface DbSnap {
  id: string;
  exists: boolean;
  data(): Record<string, unknown> | undefined;
  metadata: { fromCache: boolean; hasPendingWrites: boolean };
}
export interface DbQuerySnap {
  docs: DbSnap[];
  size: number;
}
export interface DbDoc {
  id: string;
  path: string;
  get(): Promise<DbSnap>;
  set(data: Record<string, unknown>): Promise<void>;
  delete(): Promise<void>;
  onSnapshot(next: (s: DbSnap) => void, error?: (e: { code: string; message: string }) => void): () => void;
  collection(path: string): DbCollection;
}
export interface DbQuery {
  where(field: string, op: string, value: unknown): DbQuery;
  orderBy(field: string, dir?: "asc" | "desc"): DbQuery;
  limit(n: number): DbQuery;
  get(): Promise<DbQuerySnap>;
}
export interface DbCollection extends DbQuery {
  path: string;
  doc(id?: string): DbDoc;
}
export interface Db {
  doc(path: string): DbDoc;
  collection(path: string): DbCollection;
}
export interface UserCap {
  id(): Promise<string | null>;
}
export interface SampleCap {
  (input: string | { role: "user" | "assistant"; content: string }[], opts?: {
    onText?: (u: { text: string; delta: string }) => void;
    signal?: AbortSignal;
    modelTier?: "quick" | "default" | "complex";
    cache?: boolean;
    tools?: { name: string; description: string; inputSchema?: Record<string, unknown>; execute(input: Record<string, unknown>): unknown }[];
  }): Promise<{ text: string; truncated?: boolean }>;
  limits?(): Promise<{ tools?: unknown; maxInputBytes?: number } & Record<string, unknown>>;
}
export interface DownloadsCap {
  save(req: { filename: string; data: string | Blob }): Promise<unknown>;
}

interface ClaudeGlobal {
  use(name: string): Promise<unknown>;
}

export function inClaudeArtifact(): boolean {
  return typeof (window as unknown as { claude?: ClaudeGlobal }).claude?.use === "function";
}

const cache = new Map<string, Promise<unknown>>();

export function capability<T>(name: "db" | "user" | "sample" | "downloads"): Promise<T | null> {
  const c = (window as unknown as { claude?: ClaudeGlobal }).claude;
  if (!c?.use) return Promise.resolve(null);
  if (!cache.has(name)) cache.set(name, c.use(name).catch(() => null));
  return cache.get(name) as Promise<T | null>;
}
