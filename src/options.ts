export type CalendarFilterOptions = {
  fetchImpl?: typeof fetch;
  upstreamTimeoutMs?: number;
  maxUpstreamRedirects?: number;
  maxUpstreamBytes?: number;
  upstreamCacheTtlMs?: number;
  maxUpstreamCacheBytes?: number;
  maxRequestUrlBytes?: number;
  maxFilterRules?: number;
  maxRegexBytes?: number;
  maxCalendarNameBytes?: number;
  allowPrivateUpstreams?: boolean;
};

export type ResolvedCalendarFilterOptions = Required<CalendarFilterOptions>;

const defaults: ResolvedCalendarFilterOptions = {
  fetchImpl: fetch,
  upstreamTimeoutMs: 10_000,
  maxUpstreamRedirects: 5,
  maxUpstreamBytes: 10_485_760,
  upstreamCacheTtlMs: 300_000,
  maxUpstreamCacheBytes: 52_428_800,
  maxRequestUrlBytes: 16_384,
  maxFilterRules: 64,
  maxRegexBytes: 2_048,
  maxCalendarNameBytes: 1_024,
  allowPrivateUpstreams: false,
};

const optionNames = new Set(Object.keys(defaults));

const positiveOptions = [
  "upstreamTimeoutMs",
  "maxUpstreamBytes",
  "maxRequestUrlBytes",
  "maxFilterRules",
  "maxRegexBytes",
  "maxCalendarNameBytes",
] as const;

const nonNegativeOptions = [
  "maxUpstreamRedirects",
  "upstreamCacheTtlMs",
  "maxUpstreamCacheBytes",
] as const;

export function resolveOptions(
  options: CalendarFilterOptions | undefined,
): ResolvedCalendarFilterOptions {
  if (
    options !== undefined && (options === null || typeof options !== "object")
  ) {
    throw new TypeError("options must be an object");
  }

  for (const name of Object.keys(options ?? {})) {
    if (!optionNames.has(name)) {
      throw new TypeError(`Unknown option: ${name}`);
    }
  }
  const specified = Object.fromEntries(
    Object.entries(options ?? {}).filter(([, value]) => value !== undefined),
  );
  const resolved = {
    ...defaults,
    ...specified,
  } as ResolvedCalendarFilterOptions;
  if (typeof resolved.fetchImpl !== "function") {
    throw new TypeError("fetchImpl must be a function");
  }
  if (typeof resolved.allowPrivateUpstreams !== "boolean") {
    throw new TypeError("allowPrivateUpstreams must be a boolean");
  }

  for (const name of positiveOptions) {
    validateInteger(name, resolved[name], false);
  }
  for (const name of nonNegativeOptions) {
    validateInteger(name, resolved[name], true);
  }
  return resolved;
}

function validateInteger(
  name: string,
  value: number,
  allowZero: boolean,
): void {
  if (
    !Number.isSafeInteger(value) || value < 0 || (!allowZero && value === 0)
  ) {
    throw new TypeError(
      `${name} must be a ${
        allowZero ? "non-negative" : "positive"
      } safe integer`,
    );
  }
}
