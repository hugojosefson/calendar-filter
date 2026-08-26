/** @module Ordered rule-card rendering for the builder page. */

import { RE2JS } from "re2js";
import { escapeHtml } from "./html.ts";
import { canCompile, singletonText } from "./text.ts";
import type { BuilderRule } from "./types.ts";

const guide =
  "https://github.com/hugojosefson/calendar-filter/blob/main/docs/guide.md";
const flagLabels: Record<string, string> = {
  i: "Ignore uppercase/lowercase differences (i)",
  m: "Let ^ and $ match each line (m)",
  s: "Let . match newline characters (s)",
  u: "Use Unicode compatibility mode (u)",
};

/** Renders the ordered rule cards and available additions. */
export function renderRules(rules: readonly BuilderRule[]): string {
  const hasCatchAll = rules.some((rule) => rule.kind === "all");
  const firstAll = firstCatchAll(rules);
  return `<input
          type="hidden"
          name="rule-count"
          value="${rules.length}"
        >
        <fieldset class="rules" data-rule-list>
          <legend>Rules, first match wins</legend>
          <p>
            <small>
              Rules match event summaries, descriptions, and locations.
              See the <a href="${guide}">filter guide</a> and
              <a href="https://github.com/google/re2/wiki/Syntax">RE2 syntax</a>.
            </small>
          </p>
          <div class="rule-list" data-rule-list-items>
            ${
    rules.map((rule, index) => renderRule(rule, index, rules.length, firstAll))
      .join("\n")
  }
          </div>
          <div class="actions">
            <button name="operation" value="add-text">
              Add include text filter
            </button>
            <button name="operation" value="add-exclude-text">
              Add exclude text filter
            </button>
            ${
    hasCatchAll ? "" : `<button name="operation" value="add-all">
              Add catch-all include
            </button>`
  }
          </div>
        </fieldset>`;
}

/** Renders one catch-all or pattern rule and its controls. */
function renderRule(
  rule: BuilderRule,
  index: number,
  count: number,
  firstAll: number | undefined,
): string {
  const prefix = `rule-${index}-`;
  const unreachable = firstAll !== undefined && index > firstAll
    ? `<p class="rule-note error">This rule has no effect. Rule ${
      firstAll + 1
    } matches every event first.</p>`
    : "";
  if (rule.kind === "all") {
    const tip = index < count - 1
      ? `<p class="rule-note">This rule matches every event. Move it to the end so later rules can run.</p>`
      : "";
    return `<section
            class="rule"
            data-rule="${index}"
            data-rule-index="${index}"
          >
            <header class="rule-heading">
              ${dragHandle(index)}
              <strong>Rule ${index + 1}</strong>
              <span>All events should be included.</span>
              ${actions(index, count)}
            </header>
            <input type="hidden" name="${prefix}kind" value="all">
            ${tip}
            ${unreachable}
          </section>`;
  }
  return patternRule(rule, index, count, unreachable);
}

/** Renders one text or regular-expression rule card. */
function patternRule(
  rule: Exclude<BuilderRule, { kind: "all" }>,
  index: number,
  count: number,
  unreachable: string,
): string {
  const prefix = `rule-${index}-`;
  const regex = rule.mode === "regex";
  const invalid = regex && !canCompile(rule.pattern, rule.flags);
  const flags = (flag: string) => rule.flags.includes(flag) ? " checked" : "";
  const disabled = regex && !rule.canConvertToText ? " disabled" : "";
  const extraFlags = regex
    ? ["m", "s", "u"].map((flag) => flagCheck(prefix, flag, flags(flag))).join(
      "",
    )
    : "";
  const displayedPattern = regex
    ? unwrapGeneratedTextRegex(rule.pattern)
    : rule.pattern;
  const storedPattern = displayedPattern === rule.pattern
    ? ""
    : ` data-stored-pattern="${escapeHtml(rule.pattern)}"`;
  const patternLabel = regex
    ? "All events that match"
    : "All events that include";
  const placeholder = regex ? "this RE2 regex pattern" : "this exact string";
  return `<section
            class="rule"
            data-rule="${index}"
            data-rule-index="${index}"
          >
            <header class="rule-heading">
              ${dragHandle(index)}
              <strong>Rule ${index + 1}</strong>
              ${actions(index, count)}
            </header>
            <input
              type="hidden"
              name="${prefix}original-mode"
              value="${rule.mode}"
            >
            <div class="rule-fields">
              <label class="rule-pattern">
                ${patternLabel}
                <input
                  name="${prefix}pattern"
                  data-editable${regex ? " data-regex" : ""}${storedPattern}
                  value="${escapeHtml(displayedPattern)}"
                  placeholder="${placeholder}"${
    invalid ? ' aria-invalid="true"' : ""
  }
                >
                <small class="error" data-regex-error${
    invalid ? "" : " hidden"
  }>Invalid RE2 expression</small>
              </label>
              <label class="rule-action">
                should be
                <select name="${prefix}action">
                <option value="include"${
    rule.action === "include" ? " selected" : ""
  }>included</option>
                <option value="exclude"${
    rule.action === "exclude" ? " selected" : ""
  }>excluded</option>
                </select>
              </label>
              <label class="rule-mode">
                <input
                  type="checkbox"
                  role="switch"
                  name="${prefix}mode"
                  value="regex"${regex ? " checked" : ""}${disabled}
                >
                Use an RE2 regular expression for advanced matching
              </label>
              <fieldset class="rule-flags">
                <legend>RE2 flags</legend>
                ${flagCheck(prefix, "i", flags("i"))}
                ${extraFlags}
              </fieldset>
            </div>
            ${unreachable}
          </section>`;
}

/** Renders one regex flag with its effect. */
function flagCheck(prefix: string, flag: string, checked: string): string {
  return `<label>
                <input
                  type="checkbox"
                  name="${prefix}flag-${flag}"${checked}
                >
                ${flagLabels[flag]}
              </label>`;
}

/** Renders the mouse drag handle while arrow buttons retain keyboard access. */
function dragHandle(index: number): string {
  return `<span
                class="drag-handle"
                draggable="true"
                data-drag-handle
                aria-label="Drag rule ${index + 1} to reorder"
                title="Drag to reorder"
              >≡</span>`;
}

/** Renders movement and removal controls for one rule. */
function actions(index: number, count: number): string {
  return `<div class="actions">
              <button
                class="icon-button"
                name="operation"
                value="up-${index}"
                aria-label="Move rule ${index + 1} up"
                title="Move up"${index === 0 ? " disabled" : ""}
              >↑</button>
              <button
                class="icon-button"
                name="operation"
                value="down-${index}"
                aria-label="Move rule ${index + 1} down"
                title="Move down"${index === count - 1 ? " disabled" : ""}
              >↓</button>
              <button
                class="icon-button"
                name="operation"
                value="remove-${index}"
                aria-label="Remove rule ${index + 1}"
                title="Remove rule"
              >🗑</button>
            </div>`;
}

/** Returns the first catch-all index, if the state contains one. */
function firstCatchAll(rules: readonly BuilderRule[]): number | undefined {
  const index = rules.findIndex((rule) => rule.kind === "all");
  return index === -1 ? undefined : index;
}

/** Hides one whole literal-text capture group produced by mode conversion. */
function unwrapGeneratedTextRegex(pattern: string): string {
  if (!pattern.startsWith("(") || !pattern.endsWith(")")) {
    return pattern;
  }
  const inner = pattern.slice(1, -1);
  if (!outerCaptureOnly(pattern) || !isQuotedText(inner)) {
    return pattern;
  }
  return inner;
}

/** Checks that the first capturing parenthesis closes at the final character. */
function outerCaptureOnly(pattern: string): boolean {
  let depth = 0;
  let characterClass = false;
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index];
    if (character === "\\") {
      index++;
      continue;
    }
    if (character === "[") {
      characterClass = true;
    }
    if (character === "]") {
      characterClass = false;
    }
    if (characterClass) {
      continue;
    }
    if (character === "(") {
      depth++;
    }
    if (character === ")" && --depth === 0) {
      return index === pattern.length - 1;
    }
  }
  return false;
}

/** Accepts only the exact literal spelling emitted by RE2JS.quote. */
function isQuotedText(pattern: string): boolean {
  const text = singletonText(pattern, "");
  return text !== undefined && RE2JS.quote(text) === pattern;
}
