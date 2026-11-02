/**
 * Repeticiones guardadas en este navegador (IndexedDB, sin servidor) y archivos `.lbreplay`
 * (la repetición comprimida con gzip) para pasarla a otro equipo. Se guardan las últimas
 * `KEEP` automáticamente; las marcadas con estrella no se borran solas.
 */
import { decodeReplay, encodeReplay, type Replay, type ReplayHeader } from './format';

export const KEEP = 12;
const DB = 'labbot-replays';
const STORE = 'replays';

export interface SavedReplay {
  id: string;
  header: ReplayHeader;
  /** Bytes de `encodeReplay`, comprimidos si el navegador puede. */
  bytes: Uint8Array;
  starred: boolean;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** Comprime con gzip (si no hay `CompressionStream`, va sin comprimir; `unpack` acepta los dos). */
export async function pack(r: Replay): Promise<Uint8Array> {
  const raw = encodeReplay(r);
  return typeof CompressionStream === 'function' ? pipe(raw, new CompressionStream('gzip')) : raw;
}

export async function unpack(bytes: Uint8Array): Promise<Replay> {
  const gz = bytes[0] === 0x1f && bytes[1] === 0x8b;
  return decodeReplay(gz ? await pipe(bytes, new DecompressionStream('gzip')) : bytes);
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** Todas las guardadas, la más nueva primero. */
export async function listReplays(): Promise<SavedReplay[]> {
  try {
    const all = await tx('readonly', (s) => s.getAll() as IDBRequest<SavedReplay[]>);
    return all.sort((a, b) => b.header.createdAt.localeCompare(a.header.createdAt));
  } catch {
    return [];
  }
}

/** Comprime, guarda y borra las más viejas sin estrella si pasan de `KEEP`. Devuelve el id (null si no hay almacenamiento). */
export async function storeReplay(r: Replay): Promise<string | null> {
  try {
    // Una transacción de IndexedDB no puede esperar a otra cosa: se comprime antes
    const bytes = await pack(r);
    const id = `${r.header.createdAt}-${Math.random().toString(36).slice(2, 7)}`;
    const saved: SavedReplay = { id, header: r.header, bytes, starred: false };
    await tx('readwrite', (s) => s.put(saved));
    const all = await listReplays();
    for (const old of all.filter((x) => !x.starred).slice(KEEP)) await deleteReplay(old.id);
    return id;
  } catch {
    return null;
  }
}

export async function loadReplay(id: string): Promise<Replay | null> {
  const s = await tx('readonly', (st) => st.get(id) as IDBRequest<SavedReplay | undefined>);
  return s ? unpack(s.bytes) : null;
}

export async function deleteReplay(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id));
}

export async function setStarred(id: string, starred: boolean): Promise<void> {
  const s = await tx('readonly', (st) => st.get(id) as IDBRequest<SavedReplay | undefined>);
  if (s) await tx('readwrite', (st) => st.put({ ...s, starred }));
}

/** Descarga la repetición como `.lbreplay`. */
export async function downloadReplay(r: Replay): Promise<void> {
  const blob = new Blob([(await pack(r)) as BlobPart], { type: 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `labbot-${r.header.createdAt.replace(/[:.]/g, '-')}.lbreplay`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Abre un `.lbreplay` elegido por el usuario. */
export async function readReplayFile(f: File): Promise<Replay> {
  return unpack(new Uint8Array(await f.arrayBuffer()));
}
