/** @module Immutable builder rule edits. */

import { RE2JS } from "re2js";
import { describePattern } from "./codec.ts";
import { isTextFlags, singletonText } from "./text.ts";
import type { BuilderAction, BuilderRule, BuilderState } from "./types.ts";

/** Inserts a rule at a clamped position without mutating current state. */
export function addBuilderRule(
  state: BuilderState,
  rule: BuilderRule = emptyTextRule(),
  index = state.rules.length,
): BuilderState {
  const rules = [...state.rules];
  rules.splice(Math.max(0, Math.min(index, rules.length)), 0, rule);
  return { ...state, rules };
}

/** Removes a rule when its index is in range. */
export function removeBuilderRule(
  state: BuilderState,
  index: number,
): BuilderState {
  if (index < 0 || index >= state.rules.length) {
    return state;
  }
  return {
    ...state,
    rules: state.rules.filter((_, current) => current !== index),
  };
}

/** Moves a rule to a clamped position when its source index is valid. */
export function moveBuilderRule(
  state: BuilderState,
  index: number,
  destination: number,
): BuilderState {
  if (index < 0 || index >= state.rules.length) {
    return state;
  }
  const rules = [...state.rules];
  const [rule] = rules.splice(index, 1);
  rules.splice(Math.max(0, Math.min(destination, rules.length)), 0, rule);
  return { ...state, rules };
}

/** Changes the action of a pattern rule. */
export function setBuilderRuleAction(
  state: BuilderState,
  index: number,
  action: BuilderAction,
): BuilderState {
  return changeRule(
    state,
    index,
    (rule) => rule.kind === "all" ? rule : { ...rule, action },
  );
}

/** Changes flags and promotes text to regex when flags require it. */
export function setBuilderRuleFlags(
  state: BuilderState,
  index: number,
  flags: string,
): BuilderState {
  return changeRule(state, index, (rule) => {
    if (rule.kind === "all") {
      return rule;
    }
    if (rule.mode === "text" && !isTextFlags(flags)) {
      return describePattern(
        rule.action,
        "regex",
        `(${RE2JS.quote(rule.pattern)})`,
        flags,
      );
    }
    return describePattern(rule.action, rule.mode, rule.pattern, flags);
  });
}

/** Switches modes only when the rule has an equivalent text representation. */
export function setBuilderRuleMode(
  state: BuilderState,
  index: number,
  mode: "text" | "regex",
): BuilderState {
  return changeRule(state, index, (rule) => {
    if (rule.kind === "all" || rule.mode === mode) {
      return rule;
    }
    if (mode === "regex") {
      return describePattern(
        rule.action,
        "regex",
        `(${RE2JS.quote(rule.pattern)})`,
        rule.flags,
      );
    }
    const text = singletonText(rule.pattern, rule.flags);
    return text === undefined
      ? rule
      : describePattern(rule.action, "text", text, rule.flags);
  });
}

/** Replaces a pattern while recalculating its conversion metadata. */
export function setBuilderRulePattern(
  state: BuilderState,
  index: number,
  pattern: string,
): BuilderState {
  return changeRule(
    state,
    index,
    (rule) =>
      rule.kind === "all"
        ? rule
        : describePattern(rule.action, rule.mode, pattern, rule.flags),
  );
}

/** Creates the default empty include-text rule. */
function emptyTextRule(): BuilderRule {
  return describePattern("include", "text", "", "");
}

/** Applies one immutable rule update when its index is valid. */
function changeRule(
  state: BuilderState,
  index: number,
  change: (rule: BuilderRule) => BuilderRule,
): BuilderState {
  if (index < 0 || index >= state.rules.length) {
    return state;
  }
  return {
    ...state,
    rules: state.rules.map((rule, current) =>
      current === index ? change(rule) : rule
    ),
  };
}
