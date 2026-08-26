/** @module Builder state types. */

/** Action selected when a builder rule matches. */
export type BuilderAction = "include" | "exclude";
/** Editing mode for a builder pattern. */
export type BuilderMode = "text" | "regex";

/** A catch-all include or a pattern rule with conversion metadata. */
export type BuilderRule =
  | { kind: "all"; action: "include" }
  | {
    action: BuilderAction;
    kind: "pattern";
    mode: BuilderMode;
    pattern: string;
    flags: string;
    canConvertToText: boolean;
  };

/** Non-fatal query diagnostic rendered by the builder page. */
export type BuilderDiagnostic = {
  name?: string;
  value?: string;
  message: string;
};

/** Serializable builder state used in a `/webcal` query string. */
export type BuilderQuery = {
  input: string;
  calendarName?: string;
  rules: readonly BuilderRule[];
};

/** Builder query plus diagnostics that must never reach the result URL. */
export type BuilderState = BuilderQuery & {
  diagnostics: readonly BuilderDiagnostic[];
};
