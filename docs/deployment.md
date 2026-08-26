# Deployment and library reference

## Requirements and installation

Requires [Deno](https://deno.com/) v2.9.5 or later. The executable CLI can
install Deno when `/bin/sh`, `unzip`, and `curl` are available. The source
download command also needs `tar`.

```sh
# Add the package to a project.
deno add jsr:@hugojosefson/calendar-filter

# Or download source.
mkdir -p "calendar-filter"
cd "calendar-filter"
curl -fsSL "https://github.com/hugojosefson/calendar-filter/tarball/main" \
  | tar -xzv --strip-components=1
```

## Library

The package exports `calendarFilterHandler`, which uses defaults, and
`createCalendarFilterHandler(options?)`, which creates a configured
`(request: Request) => Promise<Response>` handler. `serveCalendarFilter()`
starts `Deno.serve` and accepts separate `serverOptions` and `filterOptions`.

| Option                            |    Default | Meaning                                                         |
| --------------------------------- | ---------: | --------------------------------------------------------------- |
| `fetchImpl?: typeof fetch`        |    `fetch` | Upstream fetch implementation.                                  |
| `upstreamTimeoutMs?: number`      |    `10000` | Deadline for redirects and body reading.                        |
| `maxUpstreamRedirects?: number`   |        `5` | Followed redirect limit. Zero disables redirects.               |
| `maxUpstreamBytes?: number`       | `10485760` | Decoded upstream body limit.                                    |
| `upstreamCacheTtlMs?: number`     |   `300000` | Cache freshness ceiling. Zero revalidates immediately.          |
| `maxUpstreamCacheBytes?: number`  | `52428800` | LRU body-byte budget. Zero disables completed-response caching. |
| `maxRequestUrlBytes?: number`     |    `16384` | Encoded request URL limit.                                      |
| `maxFilterRules?: number`         |       `64` | Filter rules per request.                                       |
| `maxRegexBytes?: number`          |     `2048` | Decoded regex UTF-8 byte limit.                                 |
| `maxCalendarNameBytes?: number`   |     `1024` | Decoded name UTF-8 byte limit.                                  |
| `allowPrivateUpstreams?: boolean` |    `false` | Allows non-public addresses on every hop. Trusted-local only.   |

Option validation is synchronous. Numeric values must be finite safe integers.
Timeouts and byte, URL, rule, regex, and name limits must be positive. Redirect
count, cache TTL, and cache budget may be zero. Invalid options throw
`TypeError`.

```typescript
import { createCalendarFilterHandler } from "@hugojosefson/calendar-filter";

const port = Number(Deno.env.get("PORT") ?? 9000);
const handler = createCalendarFilterHandler({
  // Local demo only. Never enable this on a public server.
  allowPrivateUpstreams: true,
});

Deno.serve({ port }, handler);
```

Run the packaged demo with:

```sh
deno run --allow-net --allow-env jsr:@hugojosefson/calendar-filter/example-usage
```

## CLI

The packaged server needs only network permission:

```sh
deno run --allow-net jsr:@hugojosefson/calendar-filter/cli
```

It serves the builder at `http://0.0.0.0:9000/` and the API at
`http://0.0.0.0:9000/webcal`. In a checkout, `deno task serve` does the same.
Pass values as `--flag value` or `--flag=value`; options cannot repeat.

```
Usage: calendar-filter [options]

  -h, --help
  --host <hostname>                  Default: 0.0.0.0
  --port <1..65535>                  Default: 9000
  --allow-private-upstreams
  --upstream-timeout-ms <number>
  --max-upstream-redirects <number>
  --max-upstream-bytes <number>
  --upstream-cache-ttl-ms <number>
  --max-upstream-cache-bytes <number>
  --max-request-url-bytes <number>
  --max-filter-rules <number>
  --max-regex-bytes <number>
  --max-calendar-name-bytes <number>
```

The numeric flags map to library option names in kebab case. Their values are
safe integers. Redirect count, cache TTL, and cache bytes may be zero; all other
numeric flags must be positive. `--allow-private-upstreams` permits localhost
and other non-public upstreams. Use it only in a trusted local deployment. On a
public server it can route requests to private network resources.

## Deno Deploy

Set the Deno Deploy entrypoint to `jsr:@hugojosefson/calendar-filter/serve`. It
calls `serveCalendarFilter()` with safe defaults. The Deploy entrypoint and CLI
use the same startup code.
