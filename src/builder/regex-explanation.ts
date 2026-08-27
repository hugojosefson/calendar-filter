/** @module Plain-language summaries for regex patterns in the builder. */

import { regexToEnglish } from "@vikrant_kadam/regex-simplifier";

/** Explains a valid RE2 pattern without exposing package failures to the UI. */
export function explainRegex(pattern: string): string {
  if (pattern === "") {
    return "Matches everything.";
  }
  try {
    return `Matches ${regexToEnglish(pattern)}.`;
  } catch {
    return "This valid RE2 expression cannot be explained.";
  }
}
