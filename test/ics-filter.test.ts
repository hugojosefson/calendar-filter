import { assertEquals, assertThrows } from "@std/assert";
import fixture from "./fixtures/folded-calendar.ics" with { type: "text" };

import { IcsError } from "../src/calendar/error.ts";
import { filterCalendar } from "../src/calendar/filter.ts";
import { compileRule } from "../src/filter/rules.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
const include = (pattern: string) => [compileRule("include", pattern, "")];
const filter = (
  calendar: string,
  rules = include("keep"),
  name?: string,
): string =>
  decoder.decode(filterCalendar(encoder.encode(calendar), rules, name));

Deno.test("filters direct VEVENT blocks while retaining raw calendar bytes", () => {
  const source =
    "BEGIN:VCALENDAR\r\nX-KEEP:✓\r\nBEGIN:VEVENT\r\nSUMMARY:keep\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nSUMMARY:drop\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
  const expected =
    "BEGIN:VCALENDAR\r\nX-KEEP:✓\r\nBEGIN:VEVENT\r\nSUMMARY:keep\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
  assertEquals(filter(source), expected);
  assertEquals(
    filter(source, []),
    "BEGIN:VCALENDAR\r\nX-KEEP:✓\r\nEND:VCALENDAR\r\n",
  );
});

Deno.test("fixture retains unknown properties and components", () => {
  assertEquals(filter(fixture, include("Practice, P15")), fixture);
  assertEquals(
    filter(fixture, include("absent")),
    "BEGIN:VCALENDAR\nX-UNKNOWN:retained\nBEGIN:VTODO\nX-UNKNOWN:component\nEND:VTODO\nEND:VCALENDAR\n",
  );
});

Deno.test("matches unfolded direct fields with RFC TEXT unescaping", () => {
  const source =
    'BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY;ALTREP="https://a:b":unfo\n lded\\, name\\; x\\nsecond\\q\nDESCRIPTION:other; value\nBEGIN:VALARM\nDESCRIPTION:keep\nEND:VALARM\nEND:VEVENT\nEND:VCALENDAR\n';
  assertEquals(
    filter(source, include("unfolded, name; x\nsecond\\\\q")),
    source,
  );
  assertEquals(filter(source, include("other; value")), source);
  assertEquals(filter(source, include("name; x")), source);
  assertEquals(
    filter(source, include("keep")),
    "BEGIN:VCALENDAR\nEND:VCALENDAR\n",
  );
  const quotedText =
    'BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:He said "keep\nEND:VEVENT\nEND:VCALENDAR\n';
  assertEquals(filter(quotedText), quotedText);
});

Deno.test("preserves a UTF-8 BOM and supports mixed CRLF and LF input", () => {
  const source =
    "\uFEFFBEGIN:VCALENDAR\r\nBEGIN:VEVENT\nLOCATION:keep\r\nEND:VEVENT\nEND:VCALENDAR\r\n";
  assertEquals(filter(source), source);
});

Deno.test("validates strict calendar envelopes, lines, folding, and components", () => {
  const invalid = [
    "text\nBEGIN:VCALENDAR\nEND:VCALENDAR\n",
    "BEGIN:VCALENDAR\nEND:VCALENDAR\ntext\n",
    "BEGIN:VCALENDAR\nBEGIN:VCALENDAR\nEND:VCALENDAR\nEND:VCALENDAR\n",
    "BEGIN:VCALENDAR\n SUMMARY:x\nEND:VCALENDAR\n",
    "BEGIN:VCALENDAR\rEND:VCALENDAR\n",
    "BEGIN:VCALENDAR\nBEGIN:VEVENT\nBEGIN:VALARM\nBEGIN:VEVENT\nEND:VEVENT\nEND:VALARM\nEND:VEVENT\nEND:VCALENDAR\n",
    "BEGIN:VCALENDAR\nBEGIN:VEVENT\nEND:VALARM\nEND:VEVENT\nEND:VCALENDAR\n",
    "BEGIN:VCALENDAR\nSUMMARY\nEND:VCALENDAR\n",
    "BEGIN:VCALENDAR\nSUMMARY;BROKEN:value\nEND:VCALENDAR\n",
    'BEGIN:VCALENDAR\nSUMMARY;X="ok"junk:value\nEND:VCALENDAR\n',
  ];
  for (const source of invalid) {
    assertThrows(() => filter(source), IcsError);
  }
  assertThrows(() => filterCalendar(new Uint8Array([0xff]), []), IcsError);
});

Deno.test("replaces all top-level calendar names and leaves nested names alone", () => {
  const source =
    "BEGIN:VCALENDAR\nX-WR-CALNAME:old\nBEGIN:VEVENT\nX-WR-CALNAME:nested\nSUMMARY:keep\nEND:VEVENT\nX-WR-CALNAME:other\nEND:VCALENDAR\n";
  const expected =
    "BEGIN:VCALENDAR\nX-WR-CALNAME:new\\,\\;\\\\name\\nline\nBEGIN:VEVENT\nX-WR-CALNAME:nested\nSUMMARY:keep\nEND:VEVENT\nEND:VCALENDAR\n";
  assertEquals(filter(source, include("keep"), "new,;\\name\nline"), expected);
});

Deno.test("inserts a folded UTF-8 calendar name before the first component", () => {
  const source =
    "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nSUMMARY:keep\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
  const name = "å".repeat(40);
  const result = filter(source, include("keep"), name);
  const lines = result.split("\r\n").filter((line) =>
    line.startsWith("X-WR") || line.startsWith(" ")
  );
  assertEquals(lines[0].startsWith("X-WR-CALNAME:"), true);
  assertEquals(
    lines.every((line) => encoder.encode(line).byteLength <= 75),
    true,
  );
  assertEquals(result.includes("VERSION:2.0\r\nX-WR-CALNAME:"), true);
  assertEquals(result.includes("\r\nBEGIN:VEVENT"), true);
});

Deno.test("folds four-byte calendar-name characters without splitting them", () => {
  const source = "BEGIN:VCALENDAR\nEND:VCALENDAR\n";
  const name = `${"a".repeat(60)}${"😀".repeat(8)}`;
  const result = filter(source, [], name);
  const propertyLines = result.split("\n").filter((line) =>
    line.startsWith("X-WR") || line.startsWith(" ")
  );
  assertEquals(
    propertyLines.every((line) => encoder.encode(line).byteLength <= 75),
    true,
  );
  assertEquals(
    propertyLines.map((line, index) => index === 0 ? line : line.slice(1)).join(
      "",
    ),
    `X-WR-CALNAME:${name}`,
  );
});

Deno.test("preserves exact BOM and non-ASCII bytes around removed events", () => {
  const source = encoder.encode(
    "\uFEFFBEGIN:VCALENDAR\nX-NAME:räksmörgås\nBEGIN:VEVENT\nSUMMARY:drop\nEND:VEVENT\nEND:VCALENDAR\n",
  );
  const expected = encoder.encode(
    "\uFEFFBEGIN:VCALENDAR\nX-NAME:räksmörgås\nEND:VCALENDAR\n",
  );
  assertEquals(filterCalendar(source, include("absent")), expected);
});

Deno.test("inserts a calendar name before END:VCALENDAR without components", () => {
  const source = "BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR\n";
  assertEquals(
    filter(source, [], "name"),
    "BEGIN:VCALENDAR\nVERSION:2.0\nX-WR-CALNAME:name\nEND:VCALENDAR\n",
  );
});
