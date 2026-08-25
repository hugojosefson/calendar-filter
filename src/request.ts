import { ApiError } from "./api-error.ts";
import type { ResolvedCalendarFilterOptions } from "./options.ts";
import { compileRule, type FilterRule } from "./rules.ts";

export type ParsedRequest = {
  calendarName?: string;
  inputUrl: URL;
  rules: FilterRule[];
};

const encoder = new TextEncoder();
const regexName = /^(include|exclude)-regex(?:-([a-z]+))?$/;

export function assertRequestUrlLength(
  request: Request,
  maximum: number,
): void {
  if (encoder.encode(request.url).byteLength > maximum) {
    throw new ApiError(414, "Request URL is too long");
  }
}

export function parseRequest(
  request: Request,
  options: ResolvedCalendarFilterOptions,
): ParsedRequest {
  const url = new URL(request.url);
  const inputValues: string[] = [];
  let calendarName: string | undefined;
  const rules: FilterRule[] = [];

  for (const [name, value] of url.searchParams) {
    if (name === "input") {
      inputValues.push(value);
      continue;
    }
    if (name === "calendar-name") {
      if (calendarName !== undefined) {
        throw new ApiError(400, "calendar-name may occur at most once");
      }
      validateCalendarName(value, options.maxCalendarNameBytes);
      calendarName = value;
      continue;
    }
    if (name === "include") {
      assertRuleCapacity(rules, options.maxFilterRules);
      rules.push({ action: "include", kind: "all" });
      continue;
    }
    const match = regexName.exec(name);
    if (match === null) {
      throw new ApiError(400, `Unknown query parameter: ${name}`);
    }
    const [, matchedAction, flags = ""] = match;
    const action = matchedAction as "include" | "exclude";
    validateFlags(flags);
    validateRegexLength(value, options.maxRegexBytes);
    assertRuleCapacity(rules, options.maxFilterRules);
    rules.push(compileRule(action, value, flags));
  }

  if (inputValues.length !== 1 || inputValues[0] === "") {
    throw new ApiError(400, "Exactly one non-empty input is required");
  }
  if (rules.length === 0) {
    throw new ApiError(400, "At least one filter rule is required");
  }
  return { calendarName, inputUrl: normalizeInputUrl(inputValues[0]), rules };
}

function assertRuleCapacity(
  rules: readonly FilterRule[],
  maximum: number,
): void {
  if (rules.length >= maximum) {
    throw new ApiError(400, "Too many filter rules");
  }
}

function validateCalendarName(value: string, maximum: number): void {
  if (value === "") {
    throw new ApiError(400, "calendar-name must not be empty");
  }
  if (encoder.encode(value).byteLength > maximum) {
    throw new ApiError(400, "calendar-name is too long");
  }
  if (containsInvalidCalendarNameControlCharacter(value)) {
    throw new ApiError(
      400,
      "calendar-name contains an invalid control character",
    );
  }
}

function containsInvalidCalendarNameControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (
      (code >= 0 && code <= 9) || (code >= 11 && code <= 31) || code === 127
    ) {
      return true;
    }
  }
  return false;
}

function validateRegexLength(value: string, maximum: number): void {
  if (encoder.encode(value).byteLength > maximum) {
    throw new ApiError(400, "Regular expression is too long");
  }
}

function validateFlags(flags: string): void {
  const seen = new Set<string>();
  for (const flag of flags) {
    if (!"imsu".includes(flag) || seen.has(flag)) {
      throw new ApiError(
        400,
        "Regular expression flags must be unique i, m, s, or u",
      );
    }
    seen.add(flag);
  }
}

function normalizeInputUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input.replace(/^webcal:/i, "https:"));
  } catch {
    throw new ApiError(400, "input must be a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ApiError(400, "input must use http, https, or webcal");
  }
  if (url.username !== "" || url.password !== "") {
    throw new ApiError(400, "input must not contain credentials");
  }
  url.hash = "";
  return url;
}
