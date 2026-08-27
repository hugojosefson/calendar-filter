/** @module iCalendar TEXT value helpers. */

/** Decodes the RFC 5545 TEXT escapes relevant to filter matching. */
export function unescapeIcsText(value: string): string {
  return value.replace(/\\(.)/gs, (match, character: string) => {
    if (character === "n" || character === "N") {
      return "\n";
    }
    if (character === "\\" || character === "," || character === ";") {
      return character;
    }
    return match;
  });
}
