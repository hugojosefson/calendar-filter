# Filter guide

## URL builder

Open a deployment's root URL to build a subscription URL and preview its event
cards. The builder's address-bar query is the exact ordered `/webcal` API query,
so a page can be bookmarked or shared without separate UI state. It accepts an
existing `http`, `https`, or `webcal` result URL for further editing.

The forms remain usable when JavaScript is unavailable. With JavaScript, text
edits update after a short delay without adding history entries, while rule
additions, removals, reordering, mode changes, and submitted updates add history
entries. Back and forward reload server-rendered state. Once an automatic update
succeeds, the builder removes the corresponding manual Update preview or Load
URL button. A failed automatic update keeps the current page and restores a
manual retry button.

Numbered rule cards show evaluation order. Drag a card by its handle, or use its
arrow buttons, to reorder it. A catch-all should normally be last because rules
after it cannot run. The builder warns about unreachable rules, offers only one
catch-all button, and inserts newly added text filters before an existing
catch-all.

Text mode quotes its value as a literal RE2 expression and exposes only the `i`
flag. Regex mode supports `i`, `m`, `s`, and `u`, validates with RE2
immediately, uses a syntax-highlighted CodeMirror editor, and shows a
plain-English description beneath the field. A blank regex is described as
matching everything. A syntax error stays in the editor without requesting a
preview until it is submitted explicitly. A regex can switch to text mode only
when it recognizes exactly one literal string. The editor hides the redundant
capture group used to preserve regex mode during automatic pattern updates.
Editing another field or submitting the form allows canonical literal patterns
to return to text mode.

## Rule pipeline

Filter parameters are an ordered pipeline. For each `VEVENT`, the first matching
rule decides whether to keep it:

1. `include-regex=R` keeps a matching event.
2. `exclude-regex=R` removes a matching event.
3. `include` keeps every event that reaches it. Its value is ignored.

Flagged forms, `include-regex-<flags>` and `exclude-regex-<flags>`, use the same
rules with different matching flags. Plain and flagged rules may be mixed.
Events that match no rule are removed.

This pipeline keeps P15 and untagged events:

```
include-regex=\bP15\b & exclude-regex=\b(P|F)\d+\b & include
```

The first rule keeps P15. The second removes other P and F groups. The final
rule keeps events without a group tag.

## Matching rules

- Patterns use [Google RE2 syntax](https://github.com/google/re2/wiki/Syntax),
  with linear-time matching. Backreferences and lookaround are unsupported.
- The whole decoded parameter value is the pattern. A rejected pattern returns
  `400`.
- A flagged suffix may contain `i`, `m`, `s`, and `u`, in any order and once
  each. Other or repeated flags return `400`. RE2 always uses UTF-8, so `u` is
  accepted but changes nothing.
- Matching is unanchored and case-sensitive unless `i` is present. An empty
  pattern matches every value, so `include-regex=` is equivalent to `include`.
- The handler tests each direct `SUMMARY`, `DESCRIPTION`, and `LOCATION` value
  on the event. Values in `VALARM` and other child components do not match.
- Before matching, it unfolds content lines and RFC 5545 TEXT-unescapes `\\`,
  `\,`, `\;`, and `\n` or `\N`. Unknown backslash sequences remain unchanged.
- It locates `VEVENT` blocks structurally, including nested `VALARM` blocks, so
  folding does not affect event boundaries.
- RE2 `\w`, `\W`, `\b`, and `\B` use ASCII word characters. Use Unicode
  properties such as `\p{L}` for Unicode classes.

| Flag | Effect                                                                    |
| ---- | ------------------------------------------------------------------------- |
| `i`  | Case-insensitive matching.                                                |
| `u`  | Accepted as a no-op. Unicode mode and `\p{…}` escapes are always enabled. |
| `m`  | `^` and `$` also match field line boundaries.                             |
| `s`  | `.` also matches newlines.                                                |

For example, `include-regex-iu=\bträning:? +P15\b` matches `Träning: P15` and
`träning: p15`.

## Worked examples

### Your kid's group from a club calendar

[`readme/example-calendar.ics`](../readme/example-calendar.ics) is a fictional
club calendar. Most events have tags such as `// P15 - BK Exempel` or
`// F15 - BK Exempel`; senior-team and club-wide events have no group tag.

Try it locally:

```sh
# 1. Start the filter server on :9000.
deno run --allow-net --allow-env jsr:@hugojosefson/calendar-filter/example-usage

# 2. Serve the example calendar on :8000.
python3 -m http.server 8000 --directory readme
```

Subscribe with this unencoded URL:

```
http://localhost:9000/webcal?input=http://localhost:8000/example-calendar.ics&include-regex=\bP15\b&exclude-regex=\b(P|F)\d+\b&include
```

Or use this encoded URL in a calendar app:

```
webcal://localhost:9000/webcal?input=http%3A%2F%2Flocalhost%3A8000%2Fexample-calendar.ics&include-regex=%5CbP15%5Cb&exclude-regex=%5Cb%28P%7CF%29%5Cd%2B%5Cb&include
```

It keeps 8 of 13 events: five P15 events, including the mixed P15/F15 event,
plus untagged senior-team and club-wide events. P14 and F15 events are removed.

### FIFA World Cup 2026

The public
[world-cup-2026.ics](https://raw.githubusercontent.com/thatbritguy/world-cup-ics/master/ics/world-cup-2026.ics)
feed labels group matches as `[A1]` through `[L3]` and knockout matches as
`[R32]`, `[R16]`, `[QF1]` through `[FINAL]`. Keep group F and every knockout:

```
input         = https://raw.githubusercontent.com/thatbritguy/world-cup-ics/master/ics/world-cup-2026.ics
include-regex = \[F[123]\]
exclude-regex = ^\[[A-L][123]\]
include
```

```
webcal://calendar-filter.se.deno.net/webcal?input=https%3A%2F%2Fraw.githubusercontent.com%2Fthatbritguy%2Fworld-cup-ics%2Fmaster%2Fics%2Fworld-cup-2026.ics&include-regex=%5C%5BF%5B123%5D%5C%5D&exclude-regex=%5E%5C%5B%5BA-L%5D%5B123%5D%5C%5D&include
```

It keeps 38 of 104 events: six group F matches and 32 knockout matches.

### Sunrise only

[sun.ics](https://www.averychan.site/sun-calendar/sun.ics) alternates `Sunrise`
and `Sunset` events. Default deny means one rule is enough:

```
input         = https://www.averychan.site/sun-calendar/sun.ics
include-regex = Sunrise
```

```
webcal://calendar-filter.se.deno.net/webcal?input=https%3A%2F%2Fwww.averychan.site%2Fsun-calendar%2Fsun.ics&include-regex=Sunrise
```

It keeps 7 of 14 events.
