/** @module Small event previews for the builder. */

import { parseLogicalLines } from "../calendar/lines.ts";
import { unescapeIcsText } from "../calendar/text.ts";

/** Safe-to-render subset of an event used by the builder preview. */
export type PreviewEvent = { summary: string; start: string; location: string };

/** Safe metadata read from the source VCALENDAR, before filtering changes it. */
export type PreviewCalendar = {
  calendarName?: string;
  count: number;
  events: PreviewEvent[];
};

/** Counts direct VEVENTs and retains at most `maximum` display fields. */
export function previewEvents(source: string, maximum = 50): PreviewCalendar {
  const events: PreviewEvent[] = [];
  let count = 0;
  let componentDepth = 0;
  let calendarName: string | undefined;
  let event: PreviewEvent | undefined;
  for (const line of parseLogicalLines(source)) {
    const name = line.name.toUpperCase();
    const value = line.value.toUpperCase();
    if (name === "BEGIN") {
      componentDepth++;
      if (value === "VEVENT" && componentDepth === 2) {
        event = { summary: "", start: "", location: "" };
      }
      continue;
    }
    if (name === "END") {
      if (value === "VEVENT" && componentDepth === 2 && event !== undefined) {
        count++;
        if (events.length < maximum) {
          events.push(event);
        }
        event = undefined;
      }
      componentDepth--;
      continue;
    }
    if (componentDepth === 1 && name === "X-WR-CALNAME") {
      calendarName ??= unescapeIcsText(line.value);
    }
    if (componentDepth !== 2 || event === undefined) {
      continue;
    }
    if (name === "SUMMARY") {
      event.summary ||= unescapeIcsText(line.value);
    }
    if (name === "DTSTART") {
      event.start ||= line.value;
    }
    if (name === "LOCATION") {
      event.location ||= unescapeIcsText(line.value);
    }
  }
  return { calendarName, count, events };
}
