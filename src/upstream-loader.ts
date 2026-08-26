import type { ResolvedCalendarFilterOptions } from "./options.ts";
import { type CacheEntry, UpstreamCache } from "./upstream-cache.ts";
import { cacheEntry, merge304, validators } from "./upstream-cache-policy.ts";
import { Deadline, DeadlineExceeded } from "./upstream-deadline.ts";
import { UpstreamError } from "./upstream-error.ts";
import { assertUpstreamUrl, type ResolveAddresses } from "./upstream-policy.ts";

export type UpstreamLoaderDependencies = {
  fetchImpl: typeof fetch;
  now: () => number;
  resolver: ResolveAddresses;
};

export type UpstreamBody = { body: Uint8Array; url: URL };

type FetchResult = {
  finalUrl: URL;
  response: Response;
  validatorsSent: boolean;
};

export function createUpstreamLoader(
  options: ResolvedCalendarFilterOptions,
  dependencies: Partial<UpstreamLoaderDependencies> = {},
): (url: URL) => Promise<UpstreamBody> {
  const deps: UpstreamLoaderDependencies = {
    fetchImpl: dependencies.fetchImpl ?? options.fetchImpl,
    now: dependencies.now ?? Date.now,
    resolver: dependencies.resolver ?? resolvePublicAddresses,
  };
  const cache = new UpstreamCache(options.maxUpstreamCacheBytes);
  const active = new Map<string, Promise<UpstreamBody>>();
  return (url: URL): Promise<UpstreamBody> => {
    const key = url.href;
    const existing = active.get(key);
    if (existing !== undefined) return existing;
    const loading = load(url, key, options, deps, cache).finally(() =>
      active.delete(key)
    );
    active.set(key, loading);
    return loading;
  };
}

async function load(
  initial: URL,
  key: string,
  options: ResolvedCalendarFilterOptions,
  deps: UpstreamLoaderDependencies,
  cache: UpstreamCache,
): Promise<UpstreamBody> {
  const cached = cache.get(key);
  if (cached !== undefined && cached.expiresAt > deps.now()) {
    return { body: cached.body, url: new URL(cached.finalUrl) };
  }
  const deadline = new Deadline(options.upstreamTimeoutMs);
  try {
    const result = await fetchFollowingRedirects(
      initial,
      cached,
      options,
      deps,
      deadline,
    );
    const { response } = result;
    if (response.status === 304) {
      cancelBody(response);
      if (cached === undefined || !result.validatorsSent) {
        throw new UpstreamError(502, "Unexpected upstream 304 response");
      }
      const merged = merge304(
        cached,
        response.headers,
        deps.now(),
        options.upstreamCacheTtlMs,
      );
      if (merged === undefined) {
        cache.delete(key);
        return { body: cached.body, url: result.finalUrl };
      }
      cache.set(key, merged);
      return { body: merged.body, url: new URL(merged.finalUrl) };
    }
    if (!response.ok) {
      cancelBody(response);
      throw new UpstreamError(502, `Upstream returned HTTP ${response.status}`);
    }
    const body = await readBody(
      response,
      options.maxUpstreamBytes,
      deadline,
    );
    const entry = cacheEntry(
      body,
      response.headers,
      deps.now(),
      options.upstreamCacheTtlMs,
      result.finalUrl.href,
    );
    if (entry === undefined) cache.delete(key);
    else cache.set(key, entry);
    return { body, url: result.finalUrl };
  } catch (error) {
    if (
      error instanceof DeadlineExceeded || deadline.signal.aborted ||
      (error instanceof DOMException && error.name === "AbortError")
    ) {
      throw new UpstreamError(504, "Upstream request timed out");
    }
    if (error instanceof UpstreamError) throw error;
    throw new UpstreamError(502, "Upstream request failed");
  } finally {
    deadline.close();
  }
}

async function fetchFollowingRedirects(
  initial: URL,
  cached: CacheEntry | undefined,
  options: ResolvedCalendarFilterOptions,
  deps: UpstreamLoaderDependencies,
  deadline: Deadline,
): Promise<FetchResult> {
  let url = initial;
  for (let redirects = 0;; redirects++) {
    await deadline.race(assertUpstreamUrl(
      url,
      deps.resolver,
      options.allowPrivateUpstreams,
      redirects === 0,
    ));
    const headers = cached !== undefined && url.href === cached.finalUrl
      ? validators(cached)
      : undefined;
    const response = await deadline.race(deps.fetchImpl(url, {
      headers,
      redirect: "manual",
      signal: deadline.signal,
    }));
    if (!isRedirect(response.status)) {
      return { finalUrl: url, response, validatorsSent: headers !== undefined };
    }
    if (redirects >= options.maxUpstreamRedirects) {
      cancelBody(response);
      throw new UpstreamError(502, "Too many upstream redirects");
    }
    const location = response.headers.get("Location");
    if (location === null) {
      cancelBody(response);
      throw new UpstreamError(502, "Redirect has no Location header");
    }
    try {
      const next = new URL(location, url);
      cancelBody(response);
      url = next;
    } catch {
      cancelBody(response);
      throw new UpstreamError(502, "Redirect Location is invalid");
    }
  }
}

async function readBody(
  response: Response,
  maximum: number,
  deadline: Deadline,
): Promise<Uint8Array> {
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await deadline.race(reader.read());
      if (done) break;
      length += value.byteLength;
      if (length > maximum) {
        throw new UpstreamError(502, "Upstream body is too large");
      }
      chunks.push(value);
    }
  } catch (error) {
    cancelReader(reader);
    throw error;
  }
  reader.releaseLock();
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function cancelBody(response: Response): void {
  try {
    if (response.body !== null) cancelReader(response.body.getReader());
  } catch {
    // A failed cleanup must not replace the upstream error.
  }
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  let cancellation: Promise<void>;
  try {
    cancellation = reader.cancel();
  } catch {
    return;
  }
  void cancellation.catch(() => {
    // A failed cleanup must not replace the upstream error.
  });
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 ||
    status === 308;
}

async function resolvePublicAddresses(hostname: string): Promise<string[]> {
  const results = await Promise.allSettled([
    Deno.resolveDns(hostname, "A"),
    Deno.resolveDns(hostname, "AAAA"),
  ]);
  return results.flatMap((result) =>
    result.status === "fulfilled" ? result.value : []
  );
}
