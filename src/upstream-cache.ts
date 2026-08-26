export type CacheEntry = {
  body: Uint8Array;
  etag?: string;
  expiresAt: number;
  finalUrl: string;
  lastModified?: string;
  headers: Headers;
};

export class UpstreamCache {
  #entries = new Map<string, CacheEntry>();
  #bytes = 0;
  constructor(readonly maximumBytes: number) {}
  get(key: string): CacheEntry | undefined {
    const entry = this.#entries.get(key);
    if (entry === undefined) return undefined;
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return entry;
  }
  set(key: string, entry: CacheEntry): void {
    this.delete(key);
    if (entry.body.byteLength > this.maximumBytes) return;
    while (this.#bytes + entry.body.byteLength > this.maximumBytes) {
      const oldest = this.#entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.delete(oldest);
    }
    this.#entries.set(key, entry);
    this.#bytes += entry.body.byteLength;
  }
  delete(key: string): void {
    const entry = this.#entries.get(key);
    if (entry !== undefined) this.#bytes -= entry.body.byteLength;
    this.#entries.delete(key);
  }
}
