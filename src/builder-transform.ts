import { RE2JS } from "re2js";
import { describePattern } from "./builder-codec.ts";
import { isTextFlags, singletonText } from "./builder-text.ts";
import type {
  BuilderAction,
  BuilderRule,
  BuilderState,
} from "./builder-types.ts";

export function addBuilderRule(
  state: BuilderState,
  rule: BuilderRule = emptyTextRule(),
  index = state.rules.length,
): BuilderState {
  const rules = [...state.rules];
  rules.splice(Math.max(0, Math.min(index, rules.length)), 0, rule);
  return { ...state, rules };
}

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

function emptyTextRule(): BuilderRule {
  return describePattern("include", "text", "", "");
}

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
