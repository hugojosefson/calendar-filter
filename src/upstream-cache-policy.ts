import type { CacheEntry } from "./upstream-cache.ts";

export function validators(entry: CacheEntry): Headers | undefined {
  const headers = new Headers();
  if (entry.etag !== undefined) headers.set("If-None-Match", entry.etag);
  if (entry.lastModified !== undefined) {
    headers.set("If-Modified-Since", entry.lastModified);
  }
  return [...headers].length === 0 ? undefined : headers;
}

export function cacheEntry(
  body: Uint8Array,
  headers: Headers,
  now: number,
  ceilingMs: number,
  finalUrl: string,
): CacheEntry | undefined {
  const directives = parseCacheControl(headers.get("Cache-Control"));
  if (directives.has("no-store") || directives.has("private")) return undefined;
  const age = validAge(headers.get("Age"));
  const lifetime = directiveSeconds(directives, "s-maxage") ??
    directiveSeconds(directives, "max-age");
  const freshnessMs = lifetime === undefined
    ? Math.max(0, ceilingMs - age * 1000)
    : Math.min(ceilingMs, Math.max(0, lifetime - age) * 1000);
  const expiresAt = directives.has("no-cache") ? now : now + freshnessMs;
  return {
    body,
    etag: headers.get("ETag") ?? undefined,
    expiresAt,
    finalUrl,
    headers: new Headers(headers),
    lastModified: headers.get("Last-Modified") ?? undefined,
  };
}

export function merge304(
  entry: CacheEntry,
  headers: Headers,
  now: number,
  ceilingMs: number,
): CacheEntry | undefined {
  const merged = new Headers(entry.headers);
  for (
    const name of ["ETag", "Last-Modified", "Cache-Control", "Date", "Age"]
  ) {
    const value = headers.get(name);
    if (value !== null) merged.set(name, value);
  }
  return cacheEntry(entry.body, merged, now, ceilingMs, entry.finalUrl);
}

function parseCacheControl(value: string | null): Map<string, string | true> {
  const directives = new Map<string, string | true>();
  if (value === null) return directives;
  for (const raw of splitCacheControl(value)) {
    const directive = raw.trim().toLowerCase();
    const assignment = directive.indexOf("=");
    const name = assignment === -1
      ? directive
      : directive.slice(0, assignment).trim();
    const parameter = assignment === -1
      ? undefined
      : directive.slice(assignment + 1).trim();
    if (name === "no-store" && parameter === undefined) {
      directives.set(name, true);
      continue;
    }
    if (
      (name === "private" || name === "no-cache") &&
      (parameter === undefined || /^"(?:[^"\\]|\\.)*"$/.test(parameter))
    ) {
      directives.set(name, true);
      continue;
    }
    if (
      (name === "s-maxage" || name === "max-age") &&
      parameter !== undefined && /^\d+$/.test(parameter)
    ) {
      directives.set(name, parameter);
    }
  }
  return directives;
}

function splitCacheControl(value: string): string[] {
  const directives: string[] = [];
  let quoted = false;
  let start = 0;
  for (let index = 0; index < value.length; index++) {
    if (value[index] === "\\" && quoted) index++;
    else if (value[index] === '"') quoted = !quoted;
    else if (value[index] === "," && !quoted) {
      directives.push(value.slice(start, index));
      start = index + 1;
    }
  }
  directives.push(value.slice(start));
  return directives;
}

function directiveSeconds(
  directives: Map<string, string | true>,
  name: string,
): number | undefined {
  const value = directives.get(name);
  if (typeof value !== "string" || !/^\d+$/.test(value)) return undefined;
  return Number(value);
}

function validAge(value: string | null): number {
  if (value === null || !/^\d+$/.test(value)) return 0;
  const age = Number(value);
  return Number.isSafeInteger(age) ? age : Number.MAX_SAFE_INTEGER;
}
