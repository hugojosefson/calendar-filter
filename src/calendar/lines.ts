/** @module Strict iCalendar content-line parsing. */

import { IcsError } from "./error.ts";

/** Parsed iCalendar property name and raw value. */
export type ContentLine = {
  name: string;
  value: string;
};

/** Unfolded content line with source offsets retained for lossless edits. */
export type LogicalLine = ContentLine & {
  end: number;
  ending: string;
  raw: string;
  start: number;
};

/** A source line before RFC 5545 folding is applied. */
type PhysicalLine = {
  end: number;
  ending: string;
  start: number;
  text: string;
};

const propertyName = /^[A-Za-z0-9-]+$/;

/** Parses strict physical lines and unfolds their content-line values. */
export function parseLogicalLines(source: string): LogicalLine[] {
  const physicalLines = parsePhysicalLines(source);
  const logicalLines: LogicalLine[] = [];
  for (const line of physicalLines) {
    if (line.text.startsWith(" ") || line.text.startsWith("\t")) {
      const previous = logicalLines.at(-1);
      if (previous === undefined || previous.raw === "") {
        throw new IcsError("Invalid content-line folding");
      }
      previous.raw += line.text.slice(1);
      previous.end = line.end;
      previous.ending = line.ending;
      continue;
    }
    const raw = line.start === 0 && line.text.startsWith("\uFEFF")
      ? line.text.slice(1)
      : line.text;
    const content = parseContentLine(raw);
    logicalLines.push({
      ...content,
      end: line.end,
      ending: line.ending,
      raw,
      start: line.start,
    });
  }
  return logicalLines.map((line) => ({
    ...line,
    ...parseContentLine(line.raw),
  }));
}

/** Splits CRLF or LF source while rejecting lone carriage returns. */
function parsePhysicalLines(source: string): PhysicalLine[] {
  const lines: PhysicalLine[] = [];
  let start = 0;
  for (let index = 0; index < source.length; index++) {
    if (source[index] === "\r") {
      if (source[index + 1] !== "\n") {
        throw new IcsError("Lone carriage return");
      }
      lines.push(makePhysicalLine(source, start, index, "\r\n"));
      start = index + 2;
      index++;
      continue;
    }
    if (source[index] === "\n") {
      lines.push(makePhysicalLine(source, start, index, "\n"));
      start = index + 1;
    }
  }
  if (start < source.length) {
    lines.push(makePhysicalLine(source, start, source.length, ""));
  }
  return lines;
}

/** Records one physical line and its source range. */
function makePhysicalLine(
  source: string,
  start: number,
  contentEnd: number,
  ending: string,
): PhysicalLine {
  return {
    end: contentEnd + ending.length,
    ending,
    start,
    text: source.slice(start, contentEnd),
  };
}

/** Parses and validates one unfolded RFC 5545 content line. */
function parseContentLine(raw: string): ContentLine {
  if (raw === "") {
    return { name: "", value: "" };
  }
  const separator = valueSeparator(raw);
  if (separator === -1) {
    throw new IcsError("Content line has no value separator");
  }
  const [name, ...parameters] = splitOutsideQuotes(
    raw.slice(0, separator),
    ";",
  );
  if (!propertyName.test(name)) {
    throw new IcsError("Invalid property name");
  }
  for (const parameter of parameters) {
    validateParameter(parameter);
  }
  return { name, value: raw.slice(separator + 1) };
}

/** Finds the first unquoted value separator. */
function valueSeparator(raw: string): number {
  let quoted = false;
  for (let index = 0; index < raw.length; index++) {
    if (raw[index] === '"') {
      quoted = !quoted;
      continue;
    }
    if (raw[index] === ":" && !quoted) {
      return index;
    }
  }
  if (quoted) {
    throw new IcsError("Unterminated quoted parameter");
  }
  return -1;
}

/** Validates one semicolon-delimited property parameter. */
function validateParameter(parameter: string): void {
  const assignment = parameter.indexOf("=");
  if (assignment <= 0 || !propertyName.test(parameter.slice(0, assignment))) {
    throw new IcsError("Invalid property parameter");
  }
  const values = splitOutsideQuotes(parameter.slice(assignment + 1), ",");
  if (
    values.length === 0 || values.some((value) => !validParameterValue(value))
  ) {
    throw new IcsError("Invalid property parameter value");
  }
}

/** Checks one unquoted or quoted parameter value. */
function validParameterValue(value: string): boolean {
  if (value.startsWith('"')) {
    if (!value.endsWith('"')) {
      return false;
    }
    return !containsControlOrQuote(value.slice(1, -1));
  }
  return value !== "" && !/[":;]/.test(value) && !containsControl(value);
}

/** Reports C0 and DEL controls in a parameter value. */
function containsControl(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

/** Reports controls or quotes that are forbidden inside quoted values. */
function containsControlOrQuote(value: string): boolean {
  return value.includes('"') || containsControl(value);
}

/** Splits a value while preserving separators inside quoted sections. */
function splitOutsideQuotes(value: string, separator: string): string[] {
  const parts: string[] = [];
  let quoted = false;
  let start = 0;
  for (let index = 0; index < value.length; index++) {
    if (value[index] === '"') {
      quoted = !quoted;
      continue;
    }
    if (value[index] === separator && !quoted) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  if (quoted) {
    throw new IcsError("Unterminated quoted parameter");
  }
  parts.push(value.slice(start));
  return parts;
}
