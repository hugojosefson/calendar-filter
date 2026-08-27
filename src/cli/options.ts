/** @module Command-line option parsing. */

import type { CalendarFilterOptions } from "../server/options.ts";

/** Numeric handler options that the CLI may configure. */
type HandlerLimitName = Exclude<
  keyof CalendarFilterOptions,
  "fetchImpl" | "allowPrivateUpstreams"
>;

/** CLI-provided subset of handler configuration. */
type HandlerLimits = Pick<CalendarFilterOptions, HandlerLimitName>;

/** Parsed server address and handler limits from the CLI. */
export type CliOptions = {
  hostname: string;
  port: number;
  handlerOptions: HandlerLimits & { allowPrivateUpstreams?: boolean };
};

/** Either a help request or validated server options. */
export type CliParseResult =
  | { kind: "help" }
  | { kind: "serve"; options: CliOptions };

/** Reports invalid CLI syntax and causes an exit status of two. */
export class CliUsageError extends Error {
  /** Creates a usage error that the CLI reports with status two. */
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

const numericFlags = {
  "upstream-timeout-ms": "upstreamTimeoutMs",
  "max-upstream-redirects": "maxUpstreamRedirects",
  "max-upstream-bytes": "maxUpstreamBytes",
  "upstream-cache-ttl-ms": "upstreamCacheTtlMs",
  "max-upstream-cache-bytes": "maxUpstreamCacheBytes",
  "max-request-url-bytes": "maxRequestUrlBytes",
  "max-filter-rules": "maxFilterRules",
  "max-regex-bytes": "maxRegexBytes",
  "max-calendar-name-bytes": "maxCalendarNameBytes",
} as const satisfies Record<string, HandlerLimitName>;

const zeroAllowed = new Set<HandlerLimitName>([
  "maxUpstreamRedirects",
  "upstreamCacheTtlMs",
  "maxUpstreamCacheBytes",
]);

/** Help text printed for `--help` and invalid command lines. */
export const cliUsage = `Usage: calendar-filter [options]

Options:
  -h, --help                         Show this help
  --host <hostname>                  Listen host (default: 0.0.0.0)
  --port <1..65535>                  Listen port (default: 9000)
  --allow-private-upstreams          Allow non-public upstream addresses
  --upstream-timeout-ms <number>
  --max-upstream-redirects <number>
  --max-upstream-bytes <number>
  --upstream-cache-ttl-ms <number>
  --max-upstream-cache-bytes <number>
  --max-request-url-bytes <number>
  --max-filter-rules <number>
  --max-regex-bytes <number>
  --max-calendar-name-bytes <number>`;

/** Parses command-line arguments and rejects repeated or invalid options. */
export function parseCliOptions(args: readonly string[]): CliParseResult {
  const options: CliOptions = {
    hostname: "0.0.0.0",
    port: 9000,
    handlerOptions: {},
  };
  const seen = new Set<string>();

  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "-h" || argument === "--help") {
      markSeen(seen, "help");
      continue;
    }
    if (!argument.startsWith("--")) {
      throw new CliUsageError(`Unexpected argument: ${argument}`);
    }

    const [name, inlineValue] = splitLongOption(argument);
    if (name === "allow-private-upstreams") {
      if (inlineValue !== undefined) {
        throw new CliUsageError(
          "--allow-private-upstreams does not take a value",
        );
      }
      markSeen(seen, name);
      options.handlerOptions.allowPrivateUpstreams = true;
      continue;
    }

    const handlerName = numericFlags[name as keyof typeof numericFlags];
    if (name !== "host" && name !== "port" && handlerName === undefined) {
      throw new CliUsageError(`Unknown option: --${name}`);
    }
    const value = inlineValue ?? nextValue(args, index, name);
    if (inlineValue === undefined) {
      index++;
    }
    markSeen(seen, name);
    if (name === "host") {
      if (value.length === 0) {
        throw new CliUsageError("--host must not be empty");
      }
      options.hostname = value;
      continue;
    }
    if (name === "port") {
      options.port = parseInteger(name, value, false, 1, 65_535);
      continue;
    }
    options.handlerOptions[handlerName] = parseInteger(
      name,
      value,
      zeroAllowed.has(handlerName),
    );
  }

  return seen.has("help") ? { kind: "help" } : { kind: "serve", options };
}

/** Separates a long option name from an optional inline value. */
function splitLongOption(argument: string): [string, string | undefined] {
  const equalsIndex = argument.indexOf("=");
  if (equalsIndex === -1) {
    return [argument.slice(2), undefined];
  }
  return [argument.slice(2, equalsIndex), argument.slice(equalsIndex + 1)];
}

/** Reads the following argument as an option value. */
function nextValue(
  args: readonly string[],
  index: number,
  name: string,
): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("-")) {
    throw new CliUsageError(`--${name} requires a value`);
  }
  return value;
}

/** Rejects duplicate options while recording the first occurrence. */
function markSeen(seen: Set<string>, name: string): void {
  if (seen.has(name)) {
    throw new CliUsageError(`Option repeated: --${name}`);
  }
  seen.add(name);
}

/** Parses a bounded safe integer for a numeric CLI option. */
function parseInteger(
  name: string,
  value: string,
  allowZero: boolean,
  minimum?: number,
  maximum?: number,
): number {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new CliUsageError(`--${name} must be an integer`);
  }
  const number = Number(value);
  if (
    !Number.isSafeInteger(number) ||
    number < (minimum ?? (allowZero ? 0 : 1)) ||
    (maximum !== undefined && number > maximum)
  ) {
    throw new CliUsageError(`--${name} is out of range`);
  }
  return number;
}
