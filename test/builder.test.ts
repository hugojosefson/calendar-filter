import { assert, assertEquals } from "@std/assert";
import {
  addBuilderRule,
  moveBuilderRule,
  removeBuilderRule,
  setBuilderRuleAction,
  setBuilderRuleFlags,
  setBuilderRuleMode,
  setBuilderRulePattern,
} from "../src/builder/transform.ts";
import {
  buildResultUrl,
  createBuilderState,
  decodeBuilderQuery,
  encodeBuilderQuery,
  parseResultUrl,
} from "../src/builder/codec.ts";
import { previewEvents } from "../src/builder/preview-events.ts";
import { explainRegex } from "../src/builder/regex-explanation.ts";

const decode = (query: string) =>
  decodeBuilderQuery(new URLSearchParams(query));

Deno.test("builder keeps canonical text mode across a URL reload", () => {
  for (
    const [query, pattern] of [
      ["input=https%3A%2F%2Fa.example&include-regex=foo", "foo"],
      ["input=x&include-regex=foo%5C.bar", "foo.bar"],
      ["input=x&include-regex-i=%21", "!"],
    ]
  ) {
    const rule = decode(query).rules[0];
    assertEquals(rule, {
      action: "include",
      kind: "pattern",
      mode: "text",
      pattern,
      flags: query.includes("-i=") ? "i" : "",
      canConvertToText: false,
    });
  }
  for (
    const query of [
      "input=x&include-regex=(foo)",
      "input=x&include-regex=(%3F%3Af%5Bo%5D)%7B1%7D",
      "input=x&include-regex=foo%7Cfoo",
      "input=x&include-regex=%5Cx66oo",
      "input=x&include-regex-m=foo",
      "input=x&include-regex-s=foo",
      "input=x&include-regex-u=foo",
    ]
  ) {
    assertEquals(
      (decode(query).rules[0] as { mode: string }).mode,
      "regex",
      query,
    );
  }
});

Deno.test("builder converts singleton regex languages to canonical text", () => {
  for (
    const [source, text] of [
      ["foo", "foo"],
      ["foo\\.bar", "foo.bar"],
      ["(foo)", "foo"],
      ["(f(o)o)", "foo"],
      ["(?:f[o]){1}", "fo"],
      ["foo|foo", "foo"],
      ["\\x66oo", "foo"],
      ["\\x{0066}oo", "foo"],
      ["f{2}", "ff"],
      ["f{2,2}", "ff"],
    ]
  ) {
    const state = decode(`input=x&include-regex=${encodeURIComponent(source)}`);
    const converted = setBuilderRuleMode(state, 0, "text").rules[0];
    assertEquals(converted, {
      action: "include",
      kind: "pattern",
      mode: "text",
      pattern: text,
      flags: "",
      canConvertToText: false,
    }, source);
  }
  for (
    const query of [
      "input=x&include-regex=foo%2B", // variable repetition
      "input=x&include-regex=%5Bfo%5D",
      "input=x&include-regex=%5Efoo%24",
      "input=x&include-regex-i=foo",
    ]
  ) {
    const state = decode(query);
    assert(
      !(state.rules[0] as { canConvertToText: boolean }).canConvertToText,
      query,
    );
    assertEquals(setBuilderRuleMode(state, 0, "text"), state, query);
  }
  const punctuation = decode("input=x&include-regex-i=(%21)");
  assert(
    (punctuation.rules[0] as { canConvertToText: boolean }).canConvertToText,
  );
  assertEquals(
    (setBuilderRuleMode(punctuation, 0, "text").rules[0] as { pattern: string })
      .pattern,
    "!",
  );
});

Deno.test("builder transformations preserve action and rule order", () => {
  let state = createBuilderState({
    input: "https://a.example",
    rules: [{ action: "include", kind: "all" }],
  });
  state = addBuilderRule(state);
  state = setBuilderRuleAction(state, 1, "exclude");
  state = setBuilderRulePattern(state, 1, "a.b");
  state = setBuilderRuleFlags(state, 1, "m");
  assertEquals((state.rules[1] as { mode: string }).mode, "regex");
  state = setBuilderRuleFlags(state, 1, "i");
  state = setBuilderRuleMode(state, 1, "regex");
  assertEquals(state.rules[1], {
    action: "exclude",
    kind: "pattern",
    mode: "regex",
    pattern: "(a\\.b)",
    flags: "i",
    canConvertToText: false,
  });
  state = moveBuilderRule(state, 1, 0);
  assertEquals(state.rules.map((rule) => rule.action), ["exclude", "include"]);
  state = removeBuilderRule(state, 1);
  assertEquals(state.rules.length, 1);
});

Deno.test("catch-all rules stay included and cannot change action", () => {
  const state = decode("input=x&include");
  const changed = setBuilderRuleAction(state, 0, "exclude");
  assertEquals(changed.rules[0], { kind: "all", action: "include" });
  assertEquals(encodeBuilderQuery(changed).toString(), "input=x&include=");
});

Deno.test("RE2JS exact zero and optional empty patterns are singleton", () => {
  for (const source of ["a{0}", "a{0,0}", "(?:){0,1}", "(?:a{0})?"]) {
    const state = decode(`input=x&include-regex=${encodeURIComponent(source)}`);
    const converted = setBuilderRuleMode(state, 0, "text").rules[0];
    assertEquals(converted, {
      action: "include",
      kind: "pattern",
      mode: "text",
      pattern: "",
      flags: "",
      canConvertToText: false,
    }, source);
  }
});

Deno.test("builder explains blank and ordinary regexes", () => {
  assertEquals(explainRegex(""), "Matches everything.");
  const explanation = explainRegex("\\bP15\\b");
  assert(explanation.startsWith("Matches "));
  assert(explanation.includes("P"));
});

Deno.test("builder encodes and parses /webcal result URLs", () => {
  const state = decode(
    "input=https%3A%2F%2Fa.example%2Ffeed&calendar-name=Work&exclude-regex=one&include&include-regex-i=two",
  );
  const url = buildResultUrl(
    "https://filter.example/build?old=yes#drop",
    state,
  );
  assertEquals(
    url.href,
    "https://filter.example/webcal?input=https%3A%2F%2Fa.example%2Ffeed&calendar-name=Work&exclude-regex=one&include=&include-regex-i=two",
  );
  assertEquals(parseResultUrl(url.href).rules.map((rule) => rule.action), [
    "exclude",
    "include",
    "include",
  ]);
  assertEquals(
    parseResultUrl("https://filter.example/build?input=x").diagnostics,
    [{ message: "Pasted URL must use /webcal" }],
  );
});

Deno.test("builder retains invalid query rules and reports malformed API data", () => {
  const state = decode(
    "input=x&input=y&calendar-name=&calendar-name=z&include-regex-ii=%28&include-regex=&unknown=q",
  );
  assertEquals(state.input, "x");
  assertEquals(state.rules.length, 2);
  assertEquals(state.rules[1], {
    action: "include",
    kind: "pattern",
    mode: "text",
    pattern: "",
    flags: "",
    canConvertToText: false,
  });
  assertEquals(state.diagnostics.length, 6);
  assertEquals((state.rules[0] as { mode: string }).mode, "regex");
  assertEquals(
    state.diagnostics.filter((diagnostic) =>
      diagnostic.message === "Invalid regular expression"
    ).length,
    1,
  );
});

Deno.test("preview reads only the top-level source calendar name", () => {
  const preview = previewEvents(
    "BEGIN:VCALENDAR\nX-WR-CALNAME:Top\\, level\nBEGIN:VTIMEZONE\nX-WR-CALNAME:Nested\nEND:VTIMEZONE\nBEGIN:VEVENT\nSUMMARY:Event\nEND:VEVENT\nEND:VCALENDAR\n",
  );
  assertEquals(preview.calendarName, "Top, level");
  assertEquals(preview.count, 1);
});
