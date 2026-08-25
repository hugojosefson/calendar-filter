# calendar-filter

[![JSR Version](https://jsr.io/badges/@hugojosefson/calendar-filter)](https://jsr.io/@hugojosefson/calendar-filter)
[![JSR Score](https://jsr.io/badges/@hugojosefson/calendar-filter/score)](https://jsr.io/@hugojosefson/calendar-filter/score)
[![CI](https://github.com/hugojosefson/calendar-filter/actions/workflows/release.yaml/badge.svg)](https://github.com/hugojosefson/calendar-filter/actions/workflows/release.yaml)

A stateless web server that filters iCalendar (ICS) subscription feeds with
regular expressions. Point your calendar app at this server instead of the
original feed, and only the events you want show up — for example, only your
kid's age group, from a club calendar that contains every group.

## Requirements

Requires [Deno](https://deno.com/) v2.9.5 or later.

_...or..._

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

1. Fetches the upstream calendar from `input`.
2. Decides for every `VEVENT` whether it is kept, using the filter parameters
   below.
3. Returns the calendar with only the kept events. Everything else — `VCALENDAR`
   properties, `VTIMEZONE` components, line folding, CRLF line endings — is
   preserved byte for byte.

### Filter pipeline

The filter parameters form an **ordered rule pipeline**. For each event, the
parameters are evaluated in the order they appear in the URL, and the first
parameter that matches the event decides its fate:

- `include-regex=R` — if `R` matches the event, the event is **included**, and
  evaluation stops.
- `exclude-regex=R` — if `R` matches the event, the event is **excluded**, and
  evaluation stops.
- `include` — a catch-all: any event that reaches this point is **included**,
  and evaluation stops.

The regex parameters also come in flagged forms, `include-regex-<flags>` and
`exclude-regex-<flags>` (for example `include-regex-iu`). They behave
identically to the plain forms; only the compilation flags differ (see
[Matching](#matching)). Flagged and plain parameters can be mixed freely in one
URL.

If an event matches no parameter, it is **excluded** (default deny).

So the classic "my group plus everything untagged" setup is:

```
include-regex=\bP15\b & exclude-regex=\b(P|F)\d+\b & include
```

- an event mentioning `P15` → included by the first rule;
- an event mentioning any other `P`/`F` group → excluded by the second rule;
- an event mentioning no group at all (senior team, club-wide, untagged) → falls
  through to `include`.

### Matching

- Each regex is a JavaScript regular expression compiled as
  `new RegExp(pattern, flags)`. The `pattern` is the **entire** parameter value
  — the server never interprets or rewrites it. The `flags` are the parameter
  name suffix, passed verbatim as the second `RegExp` argument (empty for the
  plain forms). No flags are enabled by default.
- If the `RegExp` constructor throws (invalid pattern or invalid flags), the
  request is a `400`.
- The `g` and `y` flags are rejected with `400`: matching uses
  `RegExp.prototype.test`, which is stateful for global and sticky regexes.
- A regex is **unanchored** (it may match anywhere) and case-sensitive unless
  `i` is given. An empty pattern matches everything, so `include-regex=` is
  equivalent to `include`.
- A regex is tested against the event's `SUMMARY`, `DESCRIPTION`, and `LOCATION`
  values, one field at a time (RFC 5545 unescaping applied). A match in any
  field counts.
- `VEVENT` blocks are found structurally (`BEGIN:VEVENT` … the matching
  `END:VEVENT`, including any nested `VALARM`), so line folding does not affect
  matching.

Useful flags:

| Flag | Effect                                                                                                         |
| ---- | -------------------------------------------------------------------------------------------------------------- |
| `i`  | Case-insensitive.                                                                                              |
| `u`  | Unicode: `\b`, `\B`, `\w`, and `\W` become unicode-aware, and `\p{…}` property escapes work.                   |
| `m`  | `^` and `$` match at line boundaries, not just the start/end of the field (field values may contain newlines). |
| `s`  | `.` also matches newlines.                                                                                     |

For example, `include-regex-iu` with the pattern `\bträning:? +P15\b` matches
`Träning: P15` and `träning: p15`, with word boundaries that understand Swedish
letters.

## API

### `GET /webcal`

The only API endpoint.

#### Query parameters

| Parameter               | Required | Description                                                                             |
| ----------------------- | -------- | --------------------------------------------------------------------------------------- |
| `input`                 | yes      | Upstream calendar URL. `http`, `https`, or `webcal` (normalized to `https`).            |
| `include-regex`         | no\*     | Include the event if the regex matches (no flags). Repeat the parameter for more rules. |
| `include-regex-<flags>` | no\*     | Same, but compiled with the given flags, e.g. `include-regex-iu`.                       |
| `exclude-regex`         | no\*     | Exclude the event if the regex matches (no flags).                                      |
| `exclude-regex-<flags>` | no\*     | Same, but compiled with the given flags.                                                |
| `include`               | no\*     | Include any event that reaches this point. Value is ignored.                            |

\* at least one filter parameter is required.

- **Order matters**: the parameters form the pipeline in the order they appear
  in the URL. `input` is not part of the pipeline; its position is irrelevant.
- One regex per occurrence; repeat the parameter name for multiple rules. No
  comma separation.
- Exactly one `input` is allowed.
- Any other (unknown) query parameter → `400`.

#### Response

- `200` with the filtered calendar:
  - `Content-Type: text/calendar; charset=utf-8`
  - `Content-Disposition: inline; filename="calendar.ics"`
  - `ETag` (strong, content-based). Re-polling with `If-None-Match` returns
    `304 Not Modified`.
  - `Cache-Control: no-cache`
  - `Access-Control-Allow-Origin: *`
- If all events are filtered out, the response is a valid **empty calendar**
  (the `VCALENDAR` wrapper and `VTIMEZONE` components are kept, no `VEVENT`s),
  still `200`.
- The calendar's display name is the upstream's `X-WR-CALNAME` (or the URL, if
  the upstream has none).

#### Errors

Errors are JSON: `{"error": "<message>", "docs": "<link to this README>"}`.

| Status | When                                                                                                                                                                                                                    |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400`  | `input` missing or empty; no filter parameters; unknown parameter; more than one `input`; `input` is not an `http(s)`/`webcal` URL; the `RegExp` constructor rejects the pattern or flags (including the `g`/`y` flags) |
| `404`  | Any other path.                                                                                                                                                                                                         |
| `405`  | Any method other than `GET`/`HEAD` on `/webcal`.                                                                                                                                                                        |
| `502`  | Upstream unreachable, non-`2xx` response, or not a parseable ICS.                                                                                                                                                       |
| `504`  | Upstream fetch timed out.                                                                                                                                                                                               |

#### Caching and limits

- Upstream responses are cached in memory per `input` URL for up to 5 minutes
  (or the upstream's `max-age`, if shorter). Conditional revalidation
  (`ETag`/`Last-Modified`) is used, so the upstream is not re-downloaded unless
  it changed. Event data can therefore be up to 5 minutes stale.
- Upstream fetch: 10-second timeout, at most 5 redirects, at most 10 MiB.
- Concurrent requests for the same `input` share one upstream fetch.
- The server is stateless and logs nothing. Note that the `input` URL (including
  any query string it has) is part of your subscription URL.

## Examples

### Your kid's group, out of a club calendar

[`readme/example-calendar.ics`](example-calendar.ics) is a fictional club
calendar in the style of real club exports: most events are tagged
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

- `calendarFilterHandler: (request: Request) => Promise<Response>` — ready to
  use.
- `createCalendarFilterHandler(options?)` — returns a handler with options:
  - `fetchImpl?: typeof fetch` — injectable fetch (for tests).
  - `upstreamTimeoutMs?: number` — default `10000`.
  - `maxUpstreamBytes?: number` — default `10485760` (10 MiB).
  - `upstreamCacheTtlMs?: number` — default `300000` (5 minutes).

To deploy on Deno Deploy, the whole app is:

```ts
// deno-deploy.ts
import { calendarFilterHandler } from "@hugojosefson/calendar-filter";

export const default = calendarFilterHandler;
```

```sh
deno deploy --project calendar-filter deno-deploy.ts
```

## Installation

```sh
"@@include(./install.sh)";
```

## Example usage

```typescript
"@@include(./example-usage.ts)";
```

You may run the above example with:

```sh
deno run --allow-net --allow-env jsr:@hugojosefson/calendar-filter/example-usage
```

For further usage examples, see the tests:

- [test/placeholder.test.ts](test/placeholder.test.ts)
