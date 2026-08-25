import { IcsError } from "./ics-error.ts";
import { type LogicalLine, parseLogicalLines } from "./ics-lines.ts";
import { evaluateRules, type EventFields, type FilterRule } from "./rules.ts";

type Range = { end: number; start: number; text: string };
type Event = { end: number; fields: EventFields; start: number };

const encoder = new TextEncoder();

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

function decodeUtf8(input: Uint8Array): string {
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(input);
    const hasBom = input[0] === 0xef && input[1] === 0xbb && input[2] === 0xbf;
    return hasBom ? `\uFEFF${decoded}` : decoded;
  } catch {
    throw new IcsError("Calendar is not valid UTF-8");
  }
}

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

function addEventField(fields: EventFields, name: string, value: string): void {
  const key = name.toLowerCase() as keyof EventFields;
  if (key !== "summary" && key !== "description" && key !== "location") {
    return;
  }
  const existing = fields[key] ?? [];
  fields[key] = [...existing, unescapeText(value)];
}

function unescapeText(value: string): string {
  return value.replace(/\\(.)/gs, (match, character: string) => {
    if (character === "n" || character === "N") return "\n";
    if (character === "\\" || character === "," || character === ";") {
      return character;
    }
    return match;
  });
}

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
