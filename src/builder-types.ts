export type BuilderAction = "include" | "exclude";
export type BuilderMode = "text" | "regex";

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

export type BuilderDiagnostic = {
  name?: string;
  value?: string;
  message: string;
};

export type BuilderQuery = {
  input: string;
  calendarName?: string;
  rules: readonly BuilderRule[];
};

export type BuilderState = BuilderQuery & {
  diagnostics: readonly BuilderDiagnostic[];
};
