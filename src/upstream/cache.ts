/** @module Byte-bounded least-recently-used upstream cache. */

/** Cached upstream bytes, validators, and metadata needed for revalidation. */
export type CacheEntry = {
  body: Uint8Array;
  etag?: string;
  expiresAt: number;
  finalUrl: string;
  lastModified?: string;
  headers: Headers;
};

/** In-memory LRU cache whose total body bytes never exceed maximumBytes. */
export class UpstreamCache {
  #entries = new Map<string, CacheEntry>();
  #bytes = 0;
  /** Creates a cache with a maximum total body size. */
  constructor(readonly maximumBytes: number) {}
  /** Reads and promotes an entry to most-recently-used. */
  get(key: string): CacheEntry | undefined {
    const entry = this.#entries.get(key);
    if (entry === undefined) {
      return undefined;
    }
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return entry;
  }
  /** Stores an entry after evicting least-recently-used entries as needed. */
  set(key: string, entry: CacheEntry): void {
    this.delete(key);
    if (entry.body.byteLength > this.maximumBytes) {
      return;
    }
    while (this.#bytes + entry.body.byteLength > this.maximumBytes) {
      const oldest = this.#entries.keys().next().value as string | undefined;
      if (oldest === undefined) {
        break;
      }
      this.delete(oldest);
    }
    this.#entries.set(key, entry);
    this.#bytes += entry.body.byteLength;
  }
  /** Removes an entry and returns its body bytes to the cache budget. */
  delete(key: string): void {
    const entry = this.#entries.get(key);
    if (entry !== undefined) {
      this.#bytes -= entry.body.byteLength;
    }
    this.#entries.delete(key);
  }
}
