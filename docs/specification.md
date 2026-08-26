# HTTP specification

This document defines the `/webcal` contract.

## Request query

`GET` and `HEAD /webcal` filter a calendar. `OPTIONS /webcal` answers CORS
preflight requests.

| Parameter               | Required | Meaning                                                                  |
| ----------------------- | -------- | ------------------------------------------------------------------------ |
| `input`                 | yes      | One upstream `http`, `https`, or `webcal` URL. `webcal` becomes `https`. |
| `calendar-name`         | no       | One non-empty decoded display-name override.                             |
| `include-regex`         | no*      | Keep events matching the regex. Repeat for more rules.                   |
| `include-regex-<flags>` | no*      | Same rule with unique `i`, `m`, `s`, or `u` flags.                       |
| `exclude-regex`         | no*      | Remove events matching the regex.                                        |
| `exclude-regex-<flags>` | no*      | Same rule with flags.                                                    |
| `include`               | no*      | Keep every event reaching this rule. Its value is ignored.               |

At least one filter parameter is required. Rules keep their URL order; `input`
and `calendar-name` are not rules. Use one regex per occurrence, never a
comma-separated list. Unknown parameters, repeated `input`, or repeated
`calendar-name` produce `400`.

Default limits allow 64 rules, 2,048 UTF-8 bytes per decoded regex, and 1,024
UTF-8 bytes for a decoded `calendar-name`. Whitespace-only names are valid.
U+000A uses RFC 5545 TEXT newline escaping. Other control characters that RFC
TEXT cannot represent produce `400`. Before routing, the handler measures the
serialized `request.url` UTF-8 length, including percent encoding. The default
limit is 16,384 bytes and excess returns `414`.

See the [filter guide](guide.md) for rule evaluation and matching semantics.

## Upstream URL policy

The handler parses `input`, converts `webcal` to `https`, removes its fragment,
and uses the resulting `href` as the cache key. URL parsing lowercases scheme
and host and removes a default port. It performs no extra path or query
normalization, and preserves query parameter order. URL credentials return
`400`.

Every target must resolve only to globally routable unicast IP addresses. The
handler rejects loopback, private-use, link-local, carrier-grade NAT, multicast,
documentation, reserved, unspecified, and IPv4-mapped forms of those ranges. A
hostname with both public and non-public answers is rejected. It repeats this
check at redirects and revalidation.

`allowPrivateUpstreams: true` disables only this address-range check. It is a
handler option, never a query parameter, and applies to the initial URL and all
redirects. It does not allow credentials or non-HTTP schemes. Use it only in a
trusted local deployment. A public deployment must not enable it.

DNS can change after validation. Deployments that accept hostile clients also
need network-level egress controls.

## Accepted ICS

After HTTP content decoding, an accepted body:

- is at most the configured size, 10 MiB by default, and valid UTF-8; a leading
  UTF-8 BOM is allowed and preserved;
- contains exactly one `VCALENDAR`, with only blank lines before or after it;
  `VERSION` and `PRODID` are optional;
- has parseable content lines for every non-blank line inside `VCALENDAR`, using
  RFC 5545 folding and CRLF or LF, never a lone CR;
- has balanced `BEGIN` and `END` nesting with case-insensitive property and
  component names; and
- has every `VEVENT` as a direct `VCALENDAR` child. Its raw block includes
  balanced child components such as `VALARM`.

Unknown properties and balanced component types are accepted and preserved. The
upstream `Content-Type` does not determine whether a body is ICS.

## Responses and errors

A successful `GET` returns `200` and the filtered calendar with:

- `Content-Type: text/calendar; charset=utf-8`
- `Content-Disposition: inline; filename="calendar.ics"`
- a quoted strong `ETag`, the lowercase hexadecimal SHA-256 digest of exact
  response bytes
- `Cache-Control: no-cache`
- `Access-Control-Allow-Origin: *`
- `Access-Control-Expose-Headers: ETag, Content-Disposition`

Except for removed `VEVENT` blocks and an optional name override, the response
preserves decoded upstream bytes, including other `VCALENDAR` properties,
components, folding, and line endings. An empty filtered calendar remains a
`200` with its accepted envelope and non-event components. The handler does not
add omitted metadata.

Without `calendar-name`, upstream `X-WR-CALNAME` properties remain unchanged.
With it, the handler writes exactly one top-level `X-WR-CALNAME`: it RFC 5545
TEXT-escapes and folds it at 75 UTF-8 octets, replaces the first existing
logical property in place, including parameters and folded continuation lines,
and removes others. Property-name matching is case-insensitive. If absent, it
inserts `X-WR-CALNAME:` before the first top-level component, or before
`END:VCALENDAR`. The property uses the `BEGIN:VCALENDAR` line ending. Each
physical line is at most 75 UTF-8 octets. A fold starts with one space and never
splits a UTF-8 code point.

`HEAD` performs the same work as `GET` and sends the same representation headers
without a body. `If-None-Match` follows HTTP validator-list, weak-comparison,
and `*` semantics. A match after processing returns bodyless `304` with `ETag`,
`Cache-Control`, and CORS headers. `OPTIONS` returns bodyless `204` without
query validation or an upstream fetch, plus:

- `Access-Control-Allow-Methods: GET, HEAD, OPTIONS`
- `Access-Control-Allow-Headers: If-None-Match`

Errors use `application/json; charset=utf-8`:

```json
{
  "error": "<non-empty human-readable message>",
  "docs": "https://github.com/hugojosefson/calendar-filter#api"
}
```

Error wording is not stable.

| Status | Condition                                                                                                                                  |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `400`  | Invalid, missing, repeated, empty required, unknown, or over-limit query data; invalid regex or flags; invalid initial URL or destination. |
| `404`  | Any path other than `/webcal`.                                                                                                             |
| `405`  | A method other than `GET`, `HEAD`, or `OPTIONS` on `/webcal`.                                                                              |
| `414`  | Encoded request URL exceeds its configured limit.                                                                                          |
| `500`  | Unexpected handler failure.                                                                                                                |
| `502`  | DNS, connection, unsafe or excessive redirect, non-`2xx` upstream, oversized body, invalid UTF-8, or malformed ICS.                        |
| `504`  | Fetch, redirects, or body read exceeds the deadline.                                                                                       |

Every response has the two CORS headers above. Errors set `Cache-Control` to
`no-store`. `405` adds `Allow: GET, HEAD, OPTIONS`. `HEAD` errors have GET's
status and representation headers without a body.

## Caching

The handler has a process-local LRU cache keyed by normalized initial URL. Its
default 50 MiB budget counts stored body bytes. It evicts least-recently-used
entries before storing; bodies larger than the budget are served but not kept.
One handler instance shares the cache.

The configured five-minute TTL is a ceiling. `s-maxage` overrides `max-age`,
either may shorten freshness, and valid `Age` reduces it. `no-cache` and zero
max-age store then immediately revalidate. `no-store` and `private` responses
are not retained. `Expires` and malformed directives are ignored.
`must-revalidate` changes nothing because stale content is never served.

Stale entries revalidate with `ETag` and `Last-Modified`. A `304` reuses the
body and replaces stored `ETag`, `Last-Modified`, `Cache-Control`, `Date`, and
`Age` only when those headers are present. Without validators, the handler
fetches the body again. Revalidation failures return `502` or `504`; stale data
is never served after an error.

Upstream defaults are a 10-second deadline, 10 MiB decoded body limit, and five
redirects. Every hop must use HTTP or HTTPS and pass the address policy.
Concurrent requests for one normalized URL share an active fetch, even when the
result cannot be cached. Filters and `calendar-name` do not affect the cache
key. The handler has no persistent storage or logging. The full `input` URL,
including its query, remains in the subscription URL.

## Acceptance criteria

`deno task all` must pass without live network access. Tests cover query order,
default deny, fields, invalid patterns and flags, duplicate and unknown query
data, name overrides, and each request limit. ICS fixtures cover line endings,
folding, UTF-8, TEXT escapes, repeated fields, nested `VALARM`, unknown balanced
components, malformed envelopes, empty calendars, and retained-byte fidelity.
They also cover name replacement, removal, insertion, escaping, UTF-8 folding,
and line endings; HTTP methods, conditional responses, CORS, error JSON,
headers, and exact ETags; and mocked timeout, redirects, address policy, body
limits, revalidation, cache directives and age, LRU eviction, fetch sharing, and
failed revalidation.
