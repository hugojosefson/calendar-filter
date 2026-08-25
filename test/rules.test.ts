import { assert, assertThrows } from "@std/assert";

import { compileRule, evaluateRules } from "../src/rules.ts";

Deno.test("RE2JS maps all supported flags and keeps u as a no-op", () => {
  const cases: Array<[string, string, string]> = [
    ["i", "a", "A"],
    ["m", "^a$", "x\na\ny"],
    ["s", "a.b", "a\nb"],
    ["u", "\\p{L}+", "träning"],
    ["imsu", "^a.b$", "A\nB"],
    ["usmi", "^a.b$", "A\nB"],
  ];
  for (const [flags, pattern, value] of cases) {
    assert(
      evaluateRules([compileRule("include", pattern, flags)], {
        summary: [value],
      }),
    );
  }
});

Deno.test("RE2JS rejects unsupported syntax and accepts Unicode properties", () => {
  assertThrows(() => compileRule("include", "(?=x)", ""));
  assertThrows(() => compileRule("include", "(?<=x)", ""));
  assertThrows(() => compileRule("include", "(x)\\1", ""));
  assert(
    evaluateRules([compileRule("include", "\\p{L}+", "u")], { summary: ["å"] }),
  );
});

Deno.test("rules are unanchored, ordered, default deny, and inspect each event field", () => {
  const includeP15 = compileRule("include", "\\bP15\\b", "i");
  const excludeTagged = compileRule("exclude", "\\b[PF]\\d+\\b", "");
  assert(
    evaluateRules([includeP15, excludeTagged], { summary: ["training p15"] }),
  );
  assert(!evaluateRules([includeP15, excludeTagged], { description: ["P14"] }));
  assert(
    evaluateRules([compileRule("include", "place", "")], {
      location: ["a place"],
    }),
  );
  assert(!evaluateRules([includeP15], { summary: ["other"] }));
  assert(evaluateRules([compileRule("include", "", "")], {}));
  assert(
    !evaluateRules([compileRule("exclude", "P15", ""), includeP15], {
      summary: ["P15"],
    }),
  );
});
