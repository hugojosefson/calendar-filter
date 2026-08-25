import { assertEquals, assertThrows } from "@std/assert";

import { ApiError } from "../src/api-error.ts";
import { resolveOptions } from "../src/options.ts";
import { parseRequest } from "../src/request.ts";

const request = (query: string): Request =>
  new Request(`https://filter.example/webcal?${query}`);

const statusOf = (action: () => unknown): number => {
  try {
    action();
  } catch (error) {
    if (error instanceof ApiError) {
      return error.status;
    }
    throw error;
  }
  throw new Error("Expected API error");
};

Deno.test("query parsing preserves rule order and normalizes input URLs", () => {
  const parsed = parseRequest(
    request(
      "include-regex-i=one&input=webcal%3A%2F%2FEXAMPLE.com%2Ffeed%23part&exclude-regex=two&include",
    ),
    resolveOptions(undefined),
  );
  assertEquals(parsed.inputUrl.href, "https://example.com/feed");
  assertEquals(parsed.rules.map((rule) => rule.action), [
    "include",
    "exclude",
    "include",
  ]);
  assertEquals(parsed.calendarName, undefined);
});

Deno.test("query parsing enforces singleton parameters and rejects unknown data", () => {
  for (
    const query of [
      "include",
      "input=&include",
      "input=https%3A%2F%2Fa.example&input=https%3A%2F%2Fb.example&include",
      "input=https%3A%2F%2Fa.example&calendar-name=a&calendar-name=b&include",
      "input=https%3A%2F%2Fa.example&include&unknown=x",
      "input=ftp%3A%2F%2Fa.example&include",
      "input=https%3A%2F%2Fuser%3Apass%40a.example&include",
    ]
  ) {
    assertEquals(
      statusOf(() => parseRequest(request(query), resolveOptions(undefined))),
      400,
      query,
    );
  }
});

Deno.test("query parsing validates flags and decoded value limits", () => {
  for (const flags of ["ii", "x", "imms", ""]) {
    assertEquals(
      statusOf(() =>
        parseRequest(
          request(`input=https%3A%2F%2Fa.example&include-regex-${flags}=x`),
          resolveOptions(undefined),
        )
      ),
      400,
    );
  }
  const regexOptions = resolveOptions({ maxRegexBytes: 2 });
  assertEquals(
    parseRequest(
      request("input=https%3A%2F%2Fa.example&include-regex=%C3%A5"),
      regexOptions,
    ).rules.length,
    1,
  );
  assertEquals(
    statusOf(() =>
      parseRequest(
        request("input=https%3A%2F%2Fa.example&include-regex=%C3%A5%C3%A5"),
        regexOptions,
      )
    ),
    400,
  );
  const nameOptions = resolveOptions({ maxCalendarNameBytes: 2 });
  assertEquals(
    parseRequest(
      request("input=https%3A%2F%2Fa.example&calendar-name=%C3%A5&include"),
      nameOptions,
    ).calendarName,
    "å",
  );
  assertEquals(
    statusOf(() =>
      parseRequest(
        request(
          "input=https%3A%2F%2Fa.example&calendar-name=%C3%A5%C3%A5&include",
        ),
        nameOptions,
      )
    ),
    400,
  );
});

Deno.test("calendar names accept newlines but reject other controls", () => {
  const options = resolveOptions(undefined);
  assertEquals(
    parseRequest(
      request("input=https%3A%2F%2Fa.example&calendar-name=%0A&include"),
      options,
    ).calendarName,
    "\n",
  );
  for (const encodedControl of ["%09", "%0D", "%7F"]) {
    assertEquals(
      statusOf(() =>
        parseRequest(
          request(
            `input=https%3A%2F%2Fa.example&calendar-name=${encodedControl}&include`,
          ),
          options,
        )
      ),
      400,
    );
  }
});

Deno.test("rule capacity rejects an excess rule before it is compiled", () => {
  const options = resolveOptions({ maxFilterRules: 1 });
  assertEquals(
    statusOf(() =>
      parseRequest(
        request(
          "input=https%3A%2F%2Fa.example&include&include-regex=%28%3F%3Dx%29",
        ),
        options,
      )
    ),
    400,
  );
  assertThrows(() =>
    parseRequest(
      request("input=https%3A%2F%2Fa.example&include-regex=%28%3F%3Dx%29"),
      options,
    )
  );
});
