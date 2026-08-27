import { assertEquals, assertThrows } from "@std/assert";

import {
  type CalendarFilterOptions,
  createCalendarFilterHandler,
} from "../mod.ts";
import { resolveOptions } from "../src/server/options.ts";

Deno.test("options use documented defaults when omitted or undefined", () => {
  assertEquals(resolveOptions(undefined).maxFilterRules, 64);
  assertEquals(
    resolveOptions({ maxFilterRules: undefined }).maxFilterRules,
    64,
  );
  assertEquals(
    resolveOptions({ allowPrivateUpstreams: undefined }).allowPrivateUpstreams,
    false,
  );
});

Deno.test("options reject invalid values and unknown keys synchronously", () => {
  for (
    const option of [
      "upstreamTimeoutMs",
      "maxUpstreamBytes",
      "maxRequestUrlBytes",
      "maxFilterRules",
      "maxRegexBytes",
      "maxCalendarNameBytes",
    ]
  ) {
    assertThrows(() =>
      createCalendarFilterHandler({ [option]: 0 } as CalendarFilterOptions)
    );
  }
  for (
    const option of [
      "maxUpstreamRedirects",
      "upstreamCacheTtlMs",
      "maxUpstreamCacheBytes",
    ]
  ) {
    assertThrows(() =>
      createCalendarFilterHandler({ [option]: -1 } as CalendarFilterOptions)
    );
  }
  assertThrows(() => createCalendarFilterHandler({ maxRegexBytes: 1.5 }));
  assertThrows(() =>
    createCalendarFilterHandler(
      { allowPrivateUpstreams: "yes" } as unknown as CalendarFilterOptions,
    )
  );
  assertThrows(() =>
    createCalendarFilterHandler(
      { extra: true } as unknown as CalendarFilterOptions,
    )
  );
  assertThrows(() =>
    createCalendarFilterHandler(
      { extra: undefined } as unknown as CalendarFilterOptions,
    )
  );
});
