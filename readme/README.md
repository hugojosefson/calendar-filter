# calendar-filter

[![JSR Version](https://jsr.io/badges/@hugojosefson/calendar-filter)](https://jsr.io/@hugojosefson/calendar-filter)
[![JSR Score](https://jsr.io/badges/@hugojosefson/calendar-filter/score)](https://jsr.io/@hugojosefson/calendar-filter/score)
[![CI](https://github.com/hugojosefson/calendar-filter/actions/workflows/release.yaml/badge.svg)](https://github.com/hugojosefson/calendar-filter/actions/workflows/release.yaml)

A web handler that filters iCalendar (ICS) subscription feeds with regular
expressions. Point a calendar app at the handler to keep selected events, such
as one age group from a club calendar that contains every group.

Use the hosted [calendar filter builder](https://calendar-filter.se.deno.net/)
to create and preview a filtered subscription URL.

Requires [Deno](https://deno.com/) v2.9.5 or later.

## How it works

```
calendar app ──subscribe──▶ calendar-filter ──fetch──▶ upstream .ics
       ▲                           │
       └─────── filtered .ics ◀───┘
```

The handler fetches the `input` feed, applies URL-ordered rules to each event,
and returns the retained calendar. Retained decoded bytes stay unchanged except
for removed `VEVENT` blocks and an optional `calendar-name` override.

## Quick start

Run the server:

```sh
deno run --allow-net jsr:@hugojosefson/calendar-filter/cli
```

Then subscribe to a `/webcal` URL with one upstream `input` and one or more
filter rules:

```
webcal://localhost:9000/webcal?input=https%3A%2F%2Fexample.com%2Fcalendar.ics&include-regex=Practice
```

The default is deny, so this keeps events whose summary, description, or
location matches `Practice`.

Open `http://localhost:9000/` to build the URL interactively and preview
retained events. The builder works without JavaScript; JavaScript adds debounced
updates, browser history, and a syntax-highlighted RE2 editor. Browser assets
are served locally by calendar-filter.

## Rules

Rules are evaluated in their URL order. The first matching rule wins:

1. `include-regex=R` keeps a matching event.
2. `exclude-regex=R` removes a matching event.
3. `include` keeps events that reach it.

An event matching no rule is removed. Regex rules support RE2 syntax and flagged
forms such as `include-regex-iu`.

```text
include-regex=\bP15\b&exclude-regex=\b(P|F)\d+\b&include
```

This keeps P15 and untagged events while removing other P and F groups. Read the
[filter guide](../docs/guide.md) for matching details and runnable examples.

## API

`GET` and `HEAD /webcal` filter a calendar. `OPTIONS /webcal` answers CORS
preflight requests. `GET /` serves the URL builder. `input` accepts one `http`,
`https`, or `webcal` URL; add filter rules and optionally `calendar-name`. The
[HTTP specification](../docs/specification.md) defines the query, responses,
errors, caching, and accepted ICS input.

Successful requests return `text/calendar` with an ETag. The handler preserves
the calendar envelope and non-event components even when no events remain.

## Run, deploy, and use as a library

Run a checkout with `deno task serve`. For Deno Deploy, use
`jsr:@hugojosefson/calendar-filter/serve` as the entrypoint.

The packaged CLI serves the builder at `http://0.0.0.0:9000/` and the API at
`http://0.0.0.0:9000/webcal` by default:

```sh
deno run --allow-net jsr:@hugojosefson/calendar-filter/cli --port=9001
```

```typescript
import { createCalendarFilterHandler } from "@hugojosefson/calendar-filter";

Deno.serve(createCalendarFilterHandler());
```

Use `deno add jsr:@hugojosefson/calendar-filter` to add the library. The
[deployment and library reference](../docs/deployment.md) has requirements,
source download, CLI flags, all options, and server examples.

## Security

The handler rejects non-public upstream addresses by default. Do not enable
`--allow-private-upstreams` on a public server. It is trusted-local only and can
otherwise expose private network resources.

Treat an exposed deployment as a service that fetches URLs supplied by clients.

## Detailed documentation

- [Filter guide](../docs/guide.md)
- [HTTP specification](../docs/specification.md)
- [Deployment and library reference](../docs/deployment.md)
