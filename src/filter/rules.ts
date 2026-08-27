/** @module Ordered calendar event filter rules. */

import { RE2JS } from "re2js";

import { ApiError } from "../http/api-error.ts";

/** First-match event rule compiled to an RE2 pattern when needed. */
export type FilterRule =
  | { action: "include" | "exclude"; kind: "all" }
  | { action: "include" | "exclude"; kind: "regex"; pattern: RE2JS };

/** Event fields considered by filter rules. */
export type EventFields = {
  summary?: readonly string[];
  description?: readonly string[];
  location?: readonly string[];
};

/** Compiles a user pattern without exposing RE2 implementation errors as 500s. */
export function compileRule(
  action: "include" | "exclude",
  source: string,
  flags: string,
): FilterRule {
  if (source === "") {
    return { action, kind: "all" };
  }
  try {
    return {
      action,
      kind: "regex",
      pattern: RE2JS.compile(source, re2Flags(flags)),
    };
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : "";
    throw new ApiError(400, `Invalid regular expression${detail}`);
  }
}

/** Returns the action of the first matching rule, or excludes by default. */
export function evaluateRules(
  rules: readonly FilterRule[],
  fields: EventFields,
): boolean {
  const values = [
    ...(fields.summary ?? []),
    ...(fields.description ?? []),
    ...(fields.location ?? []),
  ];
  for (const rule of rules) {
    if (
      rule.kind === "all" || values.some((value) => rule.pattern.test(value))
    ) {
      return rule.action === "include";
    }
  }
  return false;
}

/** Translates validated public flag characters to RE2JS bit flags. */
function re2Flags(flags: string): number {
  const flagsByName = {
    i: RE2JS.CASE_INSENSITIVE,
    m: RE2JS.MULTILINE,
    s: RE2JS.DOTALL,
    u: 0,
  } as const;
  let result = 0;
  for (const flag of flags) {
    result |= flagsByName[flag as keyof typeof flagsByName];
  }
  return result;
}
