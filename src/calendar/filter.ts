/** @module iCalendar filtering and calendar-name rewriting. */

import { IcsError } from "./error.ts";
import { type LogicalLine, parseLogicalLines } from "./lines.ts";
import { unescapeIcsText } from "./text.ts";
import {
  evaluateRules,
  type EventFields,
  type FilterRule,
} from "../filter/rules.ts";

/** Source replacement range used to preserve unedited calendar bytes. */
type Range = { end: number; start: number; text: string };
/** Direct VEVENT bounds and the fields available to filter rules. */
type Event = { end: number; fields: EventFields; start: number };

const encoder = new TextEncoder();

/** Filters direct VEVENTs and optionally replaces top-level X-WR-CALNAME. @throws {IcsError} For malformed UTF-8 or calendar structure. */
export function filterCalendar(
  input: Uint8Array,
  rules: readonly FilterRule[],
  calendarName?: string,
): Uint8Array {
  const source = decodeUtf8(input);
  const lines = parseLogicalLines(source);
  const calendar = inspectCalendar(lines);
  const edits = calendar.events.filter((event) =>
    !evaluateRules(rules, event.fields)
  ).map((event) => ({ end: event.end, start: event.start, text: "" }));
  if (calendarName !== undefined) {
    addCalendarNameEdit(edits, calendar, calendarName);
  }
  return encoder.encode(applyEdits(source, edits));
}

/** Decodes strict UTF-8 while retaining a leading BOM in source offsets. */
function decodeUtf8(input: Uint8Array): string {
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(input);
    const hasBom = input[0] === 0xef && input[1] === 0xbb && input[2] === 0xbf;
    return hasBom ? `\uFEFF${decoded}` : decoded;
  } catch {
    throw new IcsError("Calendar is not valid UTF-8");
  }
}

/** Validates one VCALENDAR envelope and records event and name edit ranges. */
function inspectCalendar(lines: readonly LogicalLine[]): {
  endStart: number;
  events: Event[];
  nameRanges: Range[];
  nameEnding: string;
  firstComponentStart?: number;
} {
  const stack: string[] = [];
  const events: Event[] = [];
  const nameRanges: Range[] = [];
  let activeEvent: Event | undefined;
  let calendarEnded = false;
  let calendarStarted = false;
  let endStart = -1;
  let firstComponentStart: number | undefined;
  let nameEnding = "";

  for (const line of lines) {
    const name = line.name.toUpperCase();
    if (stack.length === 0) {
      if (line.raw === "") {
        continue;
      }
      if (
        calendarEnded || name !== "BEGIN" ||
        line.value.toUpperCase() !== "VCALENDAR"
      ) {
        throw new IcsError("Expected one VCALENDAR envelope");
      }
      calendarStarted = true;
      stack.push("VCALENDAR");
      nameEnding = line.ending;
      continue;
    }
    if (line.raw === "") {
      continue;
    }
    if (name === "BEGIN") {
      const component = line.value.toUpperCase();
      if (component === "VCALENDAR" || component === "") {
        throw new IcsError("Invalid component nesting");
      }
      if (component === "VEVENT" && stack.length !== 1) {
        throw new IcsError("VEVENT must be a direct VCALENDAR child");
      }
      if (stack.length === 1 && firstComponentStart === undefined) {
        firstComponentStart = line.start;
      }
      stack.push(component);
      if (component === "VEVENT") {
        activeEvent = { end: -1, fields: {}, start: line.start };
      }
      continue;
    }
    if (name === "END") {
      const component = line.value.toUpperCase();
      if (stack.at(-1) !== component) {
        throw new IcsError("Unbalanced component nesting");
      }
      stack.pop();
      if (component === "VEVENT") {
        if (activeEvent === undefined) {
          throw new IcsError("Invalid VEVENT");
        }
        activeEvent.end = line.end;
        events.push(activeEvent);
        activeEvent = undefined;
      }
      if (component === "VCALENDAR") {
        calendarEnded = true;
        endStart = line.start;
      }
      continue;
    }
    if (stack.length === 1 && name === "X-WR-CALNAME") {
      nameRanges.push({ end: line.end, start: line.start, text: "" });
    }
    if (
      stack.length === 2 && stack[1] === "VEVENT" && activeEvent !== undefined
    ) {
      addEventField(activeEvent.fields, name, line.value);
    }
  }
  if (
    !calendarStarted || !calendarEnded || stack.length !== 0 || endStart === -1
  ) {
    throw new IcsError("Unbalanced VCALENDAR envelope");
  }
  if (nameEnding === "") {
    throw new IcsError("VCALENDAR begin line must have an ending");
  }
  return { endStart, events, firstComponentStart, nameEnding, nameRanges };
}

/** Adds filterable direct VEVENT properties after RFC TEXT unescaping. */
function addEventField(fields: EventFields, name: string, value: string): void {
  const key = name.toLowerCase() as keyof EventFields;
  if (key !== "summary" && key !== "description" && key !== "location") {
    return;
  }
  const existing = fields[key] ?? [];
  fields[key] = [...existing, unescapeIcsText(value)];
}

/** Replaces every top-level calendar name or inserts one before components. */
function addCalendarNameEdit(
  edits: Range[],
  calendar: ReturnType<typeof inspectCalendar>,
  name: string,
): void {
  const property = foldCalendarName(name, calendar.nameEnding);
  const first = calendar.nameRanges[0];
  if (first !== undefined) {
    edits.push({ ...first, text: property });
    edits.push(...calendar.nameRanges.slice(1));
    return;
  }
  edits.push({
    end: calendar.firstComponentStart ?? calendar.endStart,
    start: calendar.firstComponentStart ?? calendar.endStart,
    text: property,
  });
}

/** Escapes and folds a replacement name without splitting UTF-8 characters. */
function foldCalendarName(name: string, ending: string): string {
  const value = name.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(
    /;/g,
    "\\;",
  ).replace(/\n/g, "\\n");
  const chunks: string[] = [];
  let chunk = "";
  let limit = 75;
  for (const character of `X-WR-CALNAME:${value}`) {
    if (encoder.encode(chunk + character).byteLength > limit) {
      chunks.push(chunk);
      chunk = ` ${character}`;
      limit = 75;
      continue;
    }
    chunk += character;
  }
  chunks.push(chunk);
  return chunks.join(ending) + ending;
}

/** Applies sorted, non-overlapping source edits and rejects unsafe overlap. */
function applyEdits(source: string, edits: Range[]): string {
  const sorted = edits.toSorted((left, right) =>
    left.start - right.start || left.end - right.end
  );
  let cursor = 0;
  let result = "";
  for (const edit of sorted) {
    if (edit.start < cursor) {
      throw new IcsError("Overlapping calendar edits");
    }
    result += source.slice(cursor, edit.start) + edit.text;
    cursor = edit.end;
  }
  return result + source.slice(cursor);
}
