export const SUMMARY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry<T> {
  data: T;
  cachedAt: number;
}

const STORAGE_PREFIX = 'hatly_summary_cache_v1:';
const memoryCache = new Map<string, CacheEntry<unknown>>();

function isEntryFresh(cachedAt: number, ttlMs: number): boolean {
  return Date.now() - cachedAt < ttlMs;
}

export function getCachedSummary<T>(
  key: string,
  ttlMs: number = SUMMARY_CACHE_TTL_MS
): { data: T; cachedAt: number } | null {
  const memEntry = memoryCache.get(key) as CacheEntry<T> | undefined;
  if (memEntry) {
    if (isEntryFresh(memEntry.cachedAt, ttlMs)) {
      return memEntry;
    }
    memoryCache.delete(key);
  }

  if (typeof window === 'undefined' || !window.sessionStorage) {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(`${STORAGE_PREFIX}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry<T>;
    if (
      !parsed ||
      typeof parsed.cachedAt !== 'number' ||
      !isEntryFresh(parsed.cachedAt, ttlMs)
    ) {
      window.sessionStorage.removeItem(`${STORAGE_PREFIX}${key}`);
      return null;
    }
    memoryCache.set(key, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export function setCachedSummary<T>(key: string, data: T): number {
  const cachedAt = Date.now();
  const entry: CacheEntry<T> = { data, cachedAt };
  memoryCache.set(key, entry);

  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      window.sessionStorage.setItem(
        `${STORAGE_PREFIX}${key}`,
        JSON.stringify(entry)
      );
    } catch {
      // Ignore storage quota errors cleanly
    }
  }

  return cachedAt;
}

export function invalidateSummaryCache(keyPrefix?: string): void {
  for (const key of Array.from(memoryCache.keys())) {
    if (!keyPrefix || key.startsWith(keyPrefix)) {
      memoryCache.delete(key);
    }
  }

  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      const toRemove: string[] = [];
      for (let i = 0; i < window.sessionStorage.length; i += 1) {
        const storageKey = window.sessionStorage.key(i);
        if (!storageKey || !storageKey.startsWith(STORAGE_PREFIX)) continue;
        const cleanKey = storageKey.slice(STORAGE_PREFIX.length);
        if (!keyPrefix || cleanKey.startsWith(keyPrefix)) {
          toRemove.push(storageKey);
        }
      }
      toRemove.forEach((k) => window.sessionStorage.removeItem(k));
    } catch {
      // Ignore storage access errors
    }
  }
}
