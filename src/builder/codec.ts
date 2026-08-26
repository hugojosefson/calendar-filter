/** @module Builder query encoding and decoding. */

import { RE2JS } from "re2js";
import {
  canCompile,
  canonicalText,
  isTextFlags,
  singletonText,
} from "./text.ts";
import type {
  BuilderAction,
  BuilderDiagnostic,
  BuilderQuery,
  BuilderRule,
  BuilderState,
} from "./types.ts";

const regexName = /^(include|exclude)-regex(?:-([a-z]+))?$/;

/** Decodes a builder query while retaining errors as displayable diagnostics. */
export function decodeBuilderQuery(search: URLSearchParams): BuilderState {
  const diagnostics: BuilderDiagnostic[] = [];
  const rules: BuilderRule[] = [];
  let input = "";
  let sawInput = false;
  let calendarName: string | undefined;
  for (const [name, value] of search) {
    if (name === "input") {
      if (sawInput) {
        diagnostics.push({
          name,
          value,
          message: "input may occur at most once",
        });
      } else {
        sawInput = true;
        input = value;
        if (value === "") {
          diagnostics.push({ name, value, message: "input must not be empty" });
        }
      }
      continue;
    }
    if (name === "calendar-name") {
      if (calendarName !== undefined) {
        diagnostics.push({
          name,
          value,
          message: "calendar-name may occur at most once",
        });
      } else {
        calendarName = value;
        if (value === "") {
          diagnostics.push({
            name,
            value,
            message: "calendar-name must not be empty",
          });
        }
      }
      continue;
    }
    if (name === "include") {
      rules.push({ kind: "all", action: "include" });
      continue;
    }
    const match = regexName.exec(name);
    if (match === null) {
      diagnostics.push({
        name,
        value,
        message: `Unknown query parameter: ${name}`,
      });
      continue;
    }
    const [, action, flags = ""] = match;
    const flagsError = validateFlags(flags);
    if (flagsError !== undefined) {
      diagnostics.push({ name, value, message: flagsError });
    }
    if (!canCompile(value, flags)) {
      diagnostics.push({ name, value, message: "Invalid regular expression" });
    }
    rules.push(patternRule(action as BuilderAction, value, flags, flagsError));
  }
  if (!sawInput) {
    diagnostics.push({
      name: "input",
      message: "Exactly one non-empty input is required",
    });
  }
  if (rules.length === 0) {
    diagnostics.push({ message: "At least one filter rule is required" });
  }
  return { input, calendarName, rules, diagnostics };
}

/** Encodes builder state into the public `/webcal` query format. */
export function encodeBuilderQuery(query: BuilderQuery): URLSearchParams {
  const result = new URLSearchParams();
  result.append("input", query.input);
  if (query.calendarName !== undefined) {
    result.append("calendar-name", query.calendarName);
  }
  for (const rule of query.rules) {
    if (rule.kind === "all") {
      result.append("include", "");
      continue;
    }
    const name = `${rule.action}-regex${
      rule.flags === "" ? "" : `-${rule.flags}`
    }`;
    result.append(
      name,
      rule.mode === "text" ? RE2JS.quote(rule.pattern) : rule.pattern,
    );
  }
  return result;
}

/** Builds a `/webcal` URL from a builder query, discarding any fragment. */
export function buildResultUrl(base: URL | string, query: BuilderQuery): URL {
  const url = new URL(base);
  url.pathname = "/webcal";
  url.search = encodeBuilderQuery(query).toString();
  url.hash = "";
  return url;
}

/** Imports a pasted result URL or returns a diagnostic state. */
export function parseResultUrl(value: string): BuilderState {
  try {
    const url = new URL(value);
    if (!["http:", "https:", "webcal:"].includes(url.protocol)) {
      return invalidUrl("Pasted URL must use http, https, or webcal");
    }
    if (url.pathname !== "/webcal") {
      return invalidUrl("Pasted URL must use /webcal");
    }
    return decodeBuilderQuery(url.searchParams);
  } catch {
    return invalidUrl("Pasted URL is invalid");
  }
}

/** Adds an empty diagnostic list to serializable builder state. */
export function createBuilderState(query: BuilderQuery): BuilderState {
  return { ...query, diagnostics: [] };
}

/** Creates a pattern rule and records text-mode conversion when possible. */
function patternRule(
  action: BuilderAction,
  source: string,
  flags: string,
  flagsError: string | undefined,
): BuilderRule {
  const text = flagsError === undefined && isTextFlags(flags)
    ? canonicalText(source, flags)
    : undefined;
  return describePattern(
    action,
    text === undefined ? "regex" : "text",
    text ?? source,
    flags,
  );
}

/** Calculates metadata used when the UI switches between text and regex modes. */
export function describePattern(
  action: BuilderAction,
  mode: "text" | "regex",
  pattern: string,
  flags: string,
): BuilderRule {
  return {
    action,
    kind: "pattern",
    mode,
    pattern,
    flags,
    canConvertToText: mode === "regex" &&
      singletonText(pattern, flags) !== undefined,
  };
}

/** Validates the builder's supported regex flag spelling. */
function validateFlags(flags: string): string | undefined {
  const seen = new Set<string>();
  for (const flag of flags) {
    if (!"imsu".includes(flag) || seen.has(flag)) {
      return "Regular expression flags must be unique i, m, s, or u";
    }
    seen.add(flag);
  }
  return undefined;
}

/** Creates a builder state containing one URL diagnostic. */
function invalidUrl(message: string): BuilderState {
  return { input: "", rules: [], diagnostics: [{ message }] };
}
