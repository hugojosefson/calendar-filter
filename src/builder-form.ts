import { createBuilderState, describePattern } from "./builder-codec.ts";
import {
  addBuilderRule,
  moveBuilderRule,
  removeBuilderRule,
  setBuilderRuleFlags,
  setBuilderRuleMode,
} from "./builder-transform.ts";
import type {
  BuilderAction,
  BuilderRule,
  BuilderState,
} from "./builder-types.ts";

export function builderStateFromForm(params: URLSearchParams): BuilderState {
  const count = number(params.get("rule-count"));
  const rules: BuilderRule[] = [];
  for (let index = 0; index < count; index++) {
    const prefix = `rule-${index}-`;
    if (params.get(`${prefix}kind`) === "all") {
      rules.push({ kind: "all", action: "include" });
      continue;
    }
    const action: BuilderAction = params.get(`${prefix}action`) === "exclude"
      ? "exclude"
      : "include";
    const flags = "imsu".split("").filter((flag) =>
      params.has(`${prefix}flag-${flag}`)
    ).join("");
    const requestedMode = params.has(`${prefix}mode`) ? "regex" : "text";
    const originalMode = params.get(`${prefix}original-mode`);
    const rule = describePattern(
      action,
      originalMode === "regex" ? "regex" : "text",
      params.get(`${prefix}pattern`) ?? "",
      originalMode === "text" && flags.includes("i") ? "i" : "",
    );
    const withFlags = setBuilderRuleFlags(
      createBuilderState({ input: "", rules: [rule] }),
      0,
      flags,
    ).rules[0];
    rules.push(
      originalMode !== undefined && withFlags.kind === "pattern" &&
        requestedMode !== withFlags.mode
        ? setBuilderRuleMode(
          createBuilderState({ input: "", rules: [withFlags] }),
          0,
          requestedMode,
        ).rules[0]
        : withFlags,
    );
  }
  const name = params.get("calendar-name") ?? "";
  return createBuilderState({
    input: params.get("input") ?? "",
    calendarName: name === "" ? undefined : name,
    rules,
  });
}

export function applyBuilderOperation(
  state: BuilderState,
  operation: string | null,
): BuilderState {
  if (operation === "add-text") {
    return addBuilderRule(state);
  }
  if (operation === "add-exclude-text") {
    return addBuilderRule(state, describePattern("exclude", "text", "", ""));
  }
  if (operation === "add-all") {
    return addBuilderRule(state, { kind: "all", action: "include" });
  }
  const match = /^(remove|up|down|mode-text|mode-regex)-(\d+)$/.exec(
    operation ?? "",
  );
  if (match === null) {
    return state;
  }
  const index = Number(match[2]);
  switch (match[1]) {
    case "remove":
      return removeBuilderRule(state, index);
    case "up":
      return moveBuilderRule(state, index, index - 1);
    case "down":
      return moveBuilderRule(state, index, index + 1);
    case "mode-text":
      return setBuilderRuleMode(state, index, "text");
    default:
      return setBuilderRuleMode(state, index, "regex");
  }
}

function number(value: string | null): number {
  const result = Number(value);
  return Number.isSafeInteger(result) && result >= 0 ? Math.min(result, 64) : 0;
}
