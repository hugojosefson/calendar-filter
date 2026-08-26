# calendar-filter

[![JSR Version](https://jsr.io/badges/@hugojosefson/calendar-filter)](https://jsr.io/@hugojosefson/calendar-filter)
[![JSR Score](https://jsr.io/badges/@hugojosefson/calendar-filter/score)](https://jsr.io/@hugojosefson/calendar-filter/score)
[![CI](https://github.com/hugojosefson/calendar-filter/actions/workflows/release.yaml/badge.svg)](https://github.com/hugojosefson/calendar-filter/actions/workflows/release.yaml)

A web handler that filters iCalendar (ICS) subscription feeds with regular
expressions. Point your calendar app at this handler to keep selected events.
For example, keep your kid's age group from a club calendar that contains every
group.

## Requirements

Requires [Deno](https://deno.com/) v2.9.5 or later. The downloaded script can
install Deno when these tools are available:

- `/bin/sh`
- `unzip`
- `curl`

## How it works

The server sits between your calendar app and a public ICS feed:

```
calendar app ──subscribe──▶ calendar-filter ──fetch──▶ upstream .ics
       ▲                           │
       └─────── filtered .ics ◀───┘
```

On every request the server:

1. Gets the upstream calendar from its bounded process-local cache or fetches it
   from `input`.
2. Decides for every `VEVENT` whether it is kept, using the filter parameters
   below.
3. Returns the calendar with only the kept events.

Apart from removed `VEVENT` blocks, the response preserves the decoded upstream
body byte for byte. The optional `calendar-name` parameter is the one exception:
it replaces or inserts `X-WR-CALNAME` as described below. The handler preserves
all other `VCALENDAR` properties, components such as `VTIMEZONE`, line folding,
and line endings.

### Filter pipeline

The filter parameters form an **ordered rule pipeline**. For each event, the
parameters are evaluated in the order they appear in the URL, and the first
parameter that matches the event decides its fate:

- `include-regex=R`: if `R` matches the event, the event is **included**, and
  evaluation stops.
- `exclude-regex=R`: if `R` matches the event, the event is **excluded**, and
  evaluation stops.
- `include`: a catch-all. Any event that reaches this point is **included**, and
  evaluation stops.

The regex parameters also come in flagged forms, `include-regex-<flags>` and
`exclude-regex-<flags>` (for example `include-regex-iu`). They behave
identically to the plain forms; only the matching flags differ. Flagged and
plain parameters may be mixed in one URL.

If an event matches no parameter, it is **excluded** (default deny).

A common setup keeps one group and all untagged events:

```
include-regex=\bP15\b & exclude-regex=\b(P|F)\d+\b & include
```

- an event mentioning `P15` → included by the first rule;
- an event mentioning any other `P`/`F` group → excluded by the second rule;
- an event mentioning no group at all (senior team, club-wide, untagged) → falls
  through to `include`.

### Matching

- Patterns use [Google RE2 syntax](https://github.com/google/re2/wiki/Syntax),
  which guarantees linear-time matching. Backreferences and lookaround are not
  supported. A pattern that RE2 rejects makes the request a `400`.
- The pattern is the entire decoded parameter value. The server does not rewrite
  it.
- A flagged parameter suffix may contain `i`, `m`, `s`, and `u`, in any order,
  at most once each. Any other flag or a duplicate flag makes the request a
  `400`. The handler runs RE2 in UTF-8 mode for every pattern, so `u` is
  accepted for familiarity but does not change matching.
- A regex is **unanchored** (it may match anywhere) and case-sensitive unless
  `i` is given. An empty pattern matches everything, so `include-regex=` is
  equivalent to `include`.
- A regex is tested against every `SUMMARY`, `DESCRIPTION`, and `LOCATION`
  property directly on the event, one value at a time. Properties in `VALARM`
  and other child components do not participate. A match in any value counts.
- Before matching, the handler unfolds the content line and applies RFC 5545
  TEXT unescaping for `\\`, `\,`, `\;`, and `\n` or `\N`. It leaves unknown
  backslash sequences unchanged.
- `VEVENT` blocks are found structurally (`BEGIN:VEVENT` … the matching
  `END:VEVENT`, including any nested `VALARM`), so line folding does not affect
  matching.
- RE2's `\w`, `\W`, `\b`, and `\B` use ASCII word characters. Use Unicode
  properties such as `\p{L}` when a pattern needs Unicode character classes.

Useful flags:

| Flag | Effect                                                                                                         |
| ---- | -------------------------------------------------------------------------------------------------------------- |
| `i`  | Case-insensitive.                                                                                              |
| `u`  | Accepted as a no-op. Unicode mode and `\p{…}` property escapes are always enabled.                             |
| `m`  | `^` and `$` match at line boundaries, not just the start/end of the field (field values may contain newlines). |
| `s`  | `.` also matches newlines.                                                                                     |

For example, `include-regex-iu` with the pattern `\bträning:? +P15\b` matches
`Träning: P15` and `träning: p15`.

## API

### `/webcal`

`GET` and `HEAD` filter a calendar. `OPTIONS` answers CORS preflight requests.

#### Query parameters

| Parameter               | Required | Description                                                                          |
| ----------------------- | -------- | ------------------------------------------------------------------------------------ |
| `input`                 | yes      | Upstream calendar URL. `http`, `https`, or `webcal`, which is normalized to `https`. |
| `calendar-name`         | no       | Display-name override. It must contain at least one decoded character. At most one.  |
| `include-regex`         | no\*     | Include the event if the regex matches. Repeat the parameter for more rules.         |
| `include-regex-<flags>` | no\*     | Same, with unique `i`, `m`, `s`, or `u` flags, for example `include-regex-iu`.       |
| `exclude-regex`         | no\*     | Exclude the event if the regex matches.                                              |
| `exclude-regex-<flags>` | no\*     | Same, with flags.                                                                    |
| `include`               | no\*     | Include any event that reaches this point. The value is ignored.                     |

\* at least one filter parameter is required.

- Filter parameters form the pipeline in URL order. `input` and `calendar-name`
  are not rules, so their positions do not matter.
- One regex per occurrence; repeat the parameter name for multiple rules. No
  comma separation.
- Exactly one `input` is required. `calendar-name` may occur at most once.
- Unknown query parameters make the request a `400`.
- With default options, a request may contain at most 64 filter rules. Each
  decoded regex may contain at most 2,048 UTF-8 bytes. A decoded `calendar-name`
  may contain at most 1,024 UTF-8 bytes. A whitespace-only name is valid. U+000A
  uses RFC TEXT newline escaping; control characters that RFC TEXT cannot
  represent make the request a `400`.
- Before routing or parsing, the handler measures the UTF-8 byte length of the
  serialized `request.url` string, including percent encoding. The default
  maximum is 16,384 bytes; exceeding the configured maximum makes the request a
  `414`.

#### Upstream URL policy

The handler parses `input` with the standard URL parser, converts `webcal` to
`https`, removes the fragment, and uses the resulting `href` as the cache key.
The URL parser lowercases the scheme and host and removes a default port. After
parsing, the handler applies no extra path or query normalization. The
serialized query keeps its parameter order. URL credentials make the request a
`400`.

By default, every fetch target must resolve only to globally routable unicast IP
addresses. The check rejects loopback, private-use, link-local, carrier-grade
NAT, multicast, documentation, reserved, unspecified, and IPv4-mapped forms of
those addresses. A hostname with a mix of public and non-public answers is also
rejected. The handler repeats this check at every redirect and revalidation.

`allowPrivateUpstreams: true` disables only the address-range check for a
trusted local deployment. It is a handler option, never a query parameter, and
it applies to the initial URL and every redirect. It does not permit URL
credentials or non-HTTP schemes. The packaged localhost example enables this
option. A public deployment should not.

DNS can change between validation and connection. A deployment exposed to
hostile clients must also enforce network-level egress controls.

#### Accepted ICS input

The body after HTTP content decoding must meet these rules:

- It does not exceed the configured byte limit, 10 MiB by default, and is valid
  UTF-8. A leading UTF-8 BOM is allowed and preserved.
- It contains exactly one `VCALENDAR`, with only blank lines before or after it.
  `VERSION` and `PRODID` are not required.
- Every non-blank line inside `VCALENDAR` is a parseable content line. Folding
  follows RFC 5545. Physical lines may end with CRLF or LF, but not a lone CR.
- `BEGIN` and `END` nesting is balanced. Property and component names are
  case-insensitive.
- Every `VEVENT` is a direct child of `VCALENDAR`. Its whole raw block includes
  any balanced child components such as `VALARM`.

Unknown properties and balanced component types are accepted and preserved. The
upstream `Content-Type` does not decide whether the body is an ICS.

#### Response

- `200` with the filtered calendar:
  - `Content-Type: text/calendar; charset=utf-8`
  - `Content-Disposition: inline; filename="calendar.ics"`
  - A quoted strong `ETag`: the lowercase hexadecimal SHA-256 digest of the
    exact response bytes.
  - `Cache-Control: no-cache`
  - `Access-Control-Allow-Origin: *`
  - `Access-Control-Expose-Headers: ETag, Content-Disposition`
- If all events are filtered out, the response keeps the accepted `VCALENDAR`
  envelope and components such as `VTIMEZONE`, but has no `VEVENT`s. It is still
  a `200`. If the upstream omitted optional or normally required metadata, the
  handler does not add it.
- Without `calendar-name`, all upstream `X-WR-CALNAME` properties remain
  unchanged. No fallback name is added.
- With `calendar-name`, the handler emits exactly one top-level `X-WR-CALNAME`.
  It RFC 5545 TEXT-escapes the value and folds the line at 75 octets. It
  replaces the first existing logical property in place, including its
  parameters and folded continuation lines, and removes any others. Property
  name matching is case-insensitive. If none exists, it inserts the property
  before the first top-level calendar component, or before `END:VCALENDAR` if
  the calendar has no components. The new property starts with `X-WR-CALNAME:`.
  Each physical line contains at most 75 UTF-8 octets; a continuation starts
  with one space, and a fold never splits a UTF-8 code point. The property uses
  the line ending from `BEGIN:VCALENDAR`; all other retained bytes stay
  unchanged.
- `HEAD` performs the same validation, fetch, filtering, and ETag calculation as
  `GET`, and returns the same representation headers without a body.
- `If-None-Match` follows HTTP semantics, including validator lists, weak
  comparison, and `*`. A match after normal processing returns a bodyless `304`
  with `ETag`, `Cache-Control`, and CORS headers.
- `OPTIONS /webcal` returns a bodyless `204` without validating the query or
  fetching upstream. It includes:
  - `Access-Control-Allow-Methods: GET, HEAD, OPTIONS`
  - `Access-Control-Allow-Headers: If-None-Match`

#### Errors

Errors use `application/json; charset=utf-8` and this schema:

```json
{
  "error": "<non-empty human-readable message>",
  "docs": "https://github.com/hugojosefson/calendar-filter#api"
}
```

The message wording is not API-stable.

| Status | When                                                                                                                                                                                                                 |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400`  | Missing, repeated, empty, unknown, or invalid query data; a rule or decoded-value limit is exceeded; RE2 rejects a pattern or flags; the initial URL has the wrong scheme, credentials, or a non-public destination. |
| `404`  | Any other path.                                                                                                                                                                                                      |
| `405`  | Any method other than `GET`, `HEAD`, or `OPTIONS` on `/webcal`.                                                                                                                                                      |
| `414`  | The encoded request URL exceeds the configured limit.                                                                                                                                                                |
| `500`  | An unexpected handler failure.                                                                                                                                                                                       |
| `502`  | DNS or connection failure; unsafe or excessive redirect; non-`2xx` upstream response; upstream body over the configured limit; invalid UTF-8; or malformed ICS.                                                      |
| `504`  | The fetch, including redirects and body reading, exceeds the configured deadline.                                                                                                                                    |

Every response includes `Access-Control-Allow-Origin: *` and
`Access-Control-Expose-Headers: ETag, Content-Disposition`. Errors also include
`Cache-Control: no-store`. A `405` includes `Allow: GET, HEAD, OPTIONS`. Error
responses to `HEAD` have the same status and representation headers as `GET`
errors but no body.

#### Caching and limits

- The handler keeps upstream bodies in a process-local LRU cache keyed by the
  normalized initial URL. The budget, 50 MiB by default, counts stored body
  bytes. It evicts least-recently-used entries before storing a new one. A
  response larger than the configured cache budget is still served but not
  retained.
- One handler instance shares this cache across its requests, so upstream
  shared-cache directives apply.
- The configured cache TTL, five minutes by default, is a ceiling. `s-maxage`
  takes precedence over `max-age`; either may shorten the TTL, and a valid `Age`
  reduces the remaining freshness. `no-cache` and zero max-age store the body
  but require immediate revalidation. `no-store` and `private` responses are not
  retained. `Expires` and malformed cache directives are ignored.
  `must-revalidate` adds no behavior because the handler never serves stale
  content.
- Stale cache entries revalidate with the upstream `ETag` and `Last-Modified`
  when available. A `304` reuses the body. Headers present on the `304` replace
  the stored `ETag`, `Last-Modified`, `Cache-Control`, `Date`, and `Age`; absent
  fields keep their stored values. The handler recalculates freshness at
  receipt. Without validators, it fetches the full body again.
- Revalidation failures return `502` or `504`; the handler never serves stale
  content after an error.
- By default, upstream fetches have a 10-second timeout and a 10 MiB
  decoded-body limit. The handler follows at most five redirects. Every hop must
  use HTTP or HTTPS and pass the address policy. Exceeding the configured
  redirect count is a `502`.
- Concurrent requests for the same normalized URL share one active fetch, even
  when the completed response cannot be cached. Filters and `calendar-name` do
  not affect the upstream cache key.
- The handler has no persistent storage and logs nothing. The process-local
  cache disappears when the instance stops. The full `input` URL, including its
  query string, remains part of the calendar subscription URL.

## Examples

### Your kid's group, out of a club calendar

[`readme/example-calendar.ics`](readme/example-calendar.ics) is a fictional club
calendar in the style of real club exports. Most events are tagged
`// P15 - BK Exempel`, `// F15 - BK Exempel`, and so on, while a few events
(senior team, club-wide) have no group tag at all.

To try it locally:

```sh
# 1. start the filter server (listens on :9000)
deno run --allow-net --allow-env jsr:@hugojosefson/calendar-filter/example-usage

# 2. serve the example calendar on :8000
python3 -m http.server 8000 --directory readme
```

Then subscribe with the URL (unencoded form):

```
http://localhost:9000/webcal?input=http://localhost:8000/example-calendar.ics&include-regex=\bP15\b&exclude-regex=\b(P|F)\d+\b&include
```

URL-encoded form (paste this into your calendar app):

```
webcal://localhost:9000/webcal?input=http%3A%2F%2Flocalhost%3A8000%2Fexample-calendar.ics&include-regex=%5CbP15%5Cb&exclude-regex=%5Cb%28P%7CF%29%5Cd%2B%5Cb&include
```

Expect **8 of the 13 events**: the five `P15` events (including
`Gemensam träning // P15 & F15`, which mentions two groups and is included
because `P15` is mentioned), plus the untagged senior-team and club-wide events.
The `P14` and `F15` events are gone.

### FIFA World Cup 2026: one group plus the knockout stage

The public feed
[world-cup-2026.ics](https://raw.githubusercontent.com/thatbritguy/world-cup-ics/master/ics/world-cup-2026.ics)
tags every match in its title: group matches as `[A1]` … `[L3]`, knockouts as
`[R32]`, `[R16]`, `[QF1]` …, `[SF1]` …, `[3RD]`, `[FINAL]`.

Keep only the group F matches plus every knockout match:

```
input         = https://raw.githubusercontent.com/thatbritguy/world-cup-ics/master/ics/world-cup-2026.ics
include-regex = \[F[123]\]
exclude-regex = ^\[[A-L][123]\]
include
```

URL-encoded form:

```
webcal://calendar-filter.se.deno.net/webcal?input=https%3A%2F%2Fraw.githubusercontent.com%2Fthatbritguy%2Fworld-cup-ics%2Fmaster%2Fics%2Fworld-cup-2026.ics&include-regex=%5C%5BF%5B123%5D%5C%5D&exclude-regex=%5E%5C%5B%5BA-L%5D%5B123%5D%5C%5D&include
```

Expect **38 of the 104 events**: the six group F matches and all 32 knockout
matches.

### Sunrise only, out of a sunrise/sunset calendar

[sun.ics](https://www.averychan.site/sun-calendar/sun.ics) alternates
`🌅 Sunrise` and `🌇 Sunset` events. A single rule is enough, because the
default is deny:

```
input         = https://www.averychan.site/sun-calendar/sun.ics
include-regex = Sunrise
```

URL-encoded form:

```
webcal://calendar-filter.se.deno.net/webcal?input=https%3A%2F%2Fwww.averychan.site%2Fsun-calendar%2Fsun.ics&include-regex=Sunrise
```

Expect **7 of the 14 events**.

## Library

The package exports the handler, so you can run it on
[Deno Deploy](https://deno.com/deploy), `Deno.serve`, or any adapter that
accepts a `(request: Request) => Promise<Response>` function:

- `calendarFilterHandler: (request: Request) => Promise<Response>` uses the
  defaults below.
- `createCalendarFilterHandler(options?)` returns a configured handler.

| Option                            | Default    | Meaning                                                                   |
| --------------------------------- | ---------- | ------------------------------------------------------------------------- |
| `fetchImpl?: typeof fetch`        | `fetch`    | Injectable upstream fetch function.                                       |
| `upstreamTimeoutMs?: number`      | `10000`    | Deadline for redirects and body reading.                                  |
| `maxUpstreamRedirects?: number`   | `5`        | Maximum followed redirects. Zero disables redirects.                      |
| `maxUpstreamBytes?: number`       | `10485760` | Maximum decoded upstream body bytes.                                      |
| `upstreamCacheTtlMs?: number`     | `300000`   | Freshness ceiling. Zero requires immediate revalidation.                  |
| `maxUpstreamCacheBytes?: number`  | `52428800` | LRU body-byte budget. Zero disables the completed-response cache.         |
| `maxRequestUrlBytes?: number`     | `16384`    | Maximum encoded request URL bytes.                                        |
| `maxFilterRules?: number`         | `64`       | Maximum filter rules per request.                                         |
| `maxRegexBytes?: number`          | `2048`     | Maximum UTF-8 bytes per decoded pattern.                                  |
| `maxCalendarNameBytes?: number`   | `1024`     | Maximum UTF-8 bytes in the decoded name override.                         |
| `allowPrivateUpstreams?: boolean` | `false`    | Allow non-public upstream addresses on every hop. Trusted local use only. |

`createCalendarFilterHandler` validates options synchronously. Numeric options
must be finite safe integers. Timeouts and byte, URL, rule, regex, and name
limits must be positive. Redirect count, cache TTL, and cache bytes may be zero.
An invalid option throws `TypeError`.

## CLI

Run the packaged server with only network permission:

```sh
deno run --allow-net jsr:@hugojosefson/calendar-filter/cli
```

It listens on `http://0.0.0.0:9000/webcal`. `deno task serve` does the same in a
checkout. Use `--host` and `--port` to change the endpoint. The numeric handler
limits use their option names in kebab case, such as `--max-filter-rules=32`.
Run `--help` for the full list.

`--allow-private-upstreams` permits localhost and other non-public upstream
addresses. Use it only in a trusted local deployment. On a public server, it can
turn the service into a route to private network resources.

For Deno Deploy, use `jsr:@hugojosefson/calendar-filter/serve` as the
entrypoint. It invokes `serveCalendarFilter()` with safe defaults. The CLI and
Deploy entrypoint share the same startup code.

## Installation

```sh
# Add the package to your project.
deno add jsr:@hugojosefson/calendar-filter

# Or download the source.

# Create and enter its directory.
mkdir -p "calendar-filter"
cd "calendar-filter"

# Download and extract the source into the current directory.
curl -fsSL "https://github.com/hugojosefson/calendar-filter/tarball/main" \
  | tar -xzv --strip-components=1
```

## Example usage

```typescript
import { createCalendarFilterHandler } from "@hugojosefson/calendar-filter";

const port = Number(Deno.env.get("PORT") ?? 9000);
const handler = createCalendarFilterHandler({
  // The demo may fetch from localhost. Never enable this on a public server.
  allowPrivateUpstreams: true,
});

Deno.serve({ port }, handler);
console.log(`calendar-filter listening on http://localhost:${port}/webcal`);
```

Run the example with:

```sh
deno run --allow-net --allow-env jsr:@hugojosefson/calendar-filter/example-usage
```

## Acceptance criteria

The implementation must pass `deno task all` and cover these behaviors without
live network access:

- Query parsing preserves rule order across repeated and flagged parameters.
  Tests cover default deny, empty patterns, every field, invalid RE2 syntax and
  flags, duplicate inputs, unknown parameters, `calendar-name`, and every
  request limit.
- ICS fixtures cover CRLF and LF, folding, UTF-8, TEXT escapes, repeated fields,
  nested `VALARM`, balanced unknown components, malformed envelopes, empty
  calendars, and byte-for-byte preservation of retained data.
- Name override tests cover replacement, duplicate removal, insertion, escaping,
  UTF-8 folding, and line-ending preservation.
- HTTP tests cover `GET`, `HEAD`, `OPTIONS`, `304`, `404`, `405`, `414`, CORS,
  error JSON, content headers, and exact SHA-256 ETags.
- Mocked upstream tests cover timeout, redirect limits and policy, public and
  private address checks, decoded-body limits, non-`2xx` responses, conditional
  revalidation, restrictive cache directives, `Age`, LRU eviction, failed
  revalidation, and shared active fetches.
