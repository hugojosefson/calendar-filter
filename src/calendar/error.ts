/** @module Errors raised while parsing or rewriting iCalendar data. */

/** Signals malformed iCalendar input or an unsafe rewrite. */
export class IcsError extends Error {
  /** Creates an error for malformed calendar input or edits. */
  constructor(message: string) {
    super(message);
    this.name = "IcsError";
  }
}
