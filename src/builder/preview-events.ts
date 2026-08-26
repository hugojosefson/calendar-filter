/** @module Small event previews for the builder. */

import { parseLogicalLines } from "../calendar/lines.ts";
import { unescapeIcsText } from "../calendar/text.ts";

/** Safe-to-render subset of an event used by the builder preview. */
export type PreviewEvent = { summary: string; start: string; location: string };

/** Counts direct VEVENTs and retains at most `maximum` display fields. */
export function previewEvents(source: string, maximum = 50): {
  count: number;
  events: PreviewEvent[];
} {
  const events: PreviewEvent[] = [];
  let count = 0;
  let depth = 0;
  let event: PreviewEvent | undefined;
  for (const line of parseLogicalLines(source)) {
    const name = line.name.toUpperCase();
    if (name === "BEGIN" && line.value.toUpperCase() === "VEVENT") {
      depth++;
      if (depth === 1) {
        event = { summary: "", start: "", location: "" };
      }
      continue;
    }
    if (name === "END" && line.value.toUpperCase() === "VEVENT") {
      if (depth === 1 && event !== undefined) {
        count++;
        if (events.length < maximum) {
          events.push(event);
        }
        event = undefined;
      }
      depth--;
      continue;
    }
    if (depth !== 1 || event === undefined) {
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
  return { count, events };
}
