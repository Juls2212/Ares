/**
 * Memory-only store of Main-held snapshots addressed by an opaque reference. Entries expire, the store
 * is bounded (the oldest entry is evicted first) and every entry can be taken exactly once.
 */
export type ExpiringStore<T> = {
  put: (value: T) => string;
  /** Removes and returns the entry; a second call, or a call after expiry, returns undefined. */
  take: (reference: unknown) => T | undefined;
  clear: () => void;
  size: () => number;
};

type ExpiringStoreOptions = {
  lifetimeMs: number;
  maximumEntries: number;
  now: () => number;
  generateIdentifier: () => string;
};

export const createExpiringStore = <T>(options: ExpiringStoreOptions): ExpiringStore<T> => {
  const entries = new Map<string, { value: T; expiresAt: number }>();

  const dropExpired = (): void => {
    const now = options.now();
    for (const [reference, entry] of entries) {
      if (entry.expiresAt <= now) entries.delete(reference);
    }
  };

  return {
    put: (value) => {
      dropExpired();
      while (entries.size >= options.maximumEntries) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
      const reference = options.generateIdentifier();
      entries.set(reference, { value, expiresAt: options.now() + options.lifetimeMs });
      return reference;
    },
    take: (reference) => {
      if (typeof reference !== "string") return undefined;
      const entry = entries.get(reference);
      entries.delete(reference);
      return entry && entry.expiresAt > options.now() ? entry.value : undefined;
    },
    clear: () => entries.clear(),
    size: () => {
      dropExpired();
      return entries.size;
    }
  };
};
