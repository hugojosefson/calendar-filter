import { assertEquals } from "@std/assert";

import { createCalendarFilterHandler } from "../mod.ts";

const validQuery = "input=https%3A%2F%2Fcalendar.example%2Ffeed.ics&include";

Deno.test("handler returns 501 only after a valid GET request parses", async () => {
  const handler = createCalendarFilterHandler();
  const response = await handler(
    new Request(`https://filter.example/webcal?${validQuery}`),
  );
  assertEquals(response.status, 501);
  assertEquals(
    (await response.json()).docs,
    "https://github.com/hugojosefson/calendar-filter#api",
  );
});

Deno.test("handler routes and handles HEAD, OPTIONS, methods, and URL size", async () => {
  const handler = createCalendarFilterHandler();
  const head = await handler(
    new Request(`https://filter.example/webcal?${validQuery}`, {
      method: "HEAD",
    }),
  );
  assertEquals(head.status, 501);
  assertEquals(await head.text(), "");
  const options = await handler(
    new Request("https://filter.example/webcal?bad", { method: "OPTIONS" }),
  );
  assertEquals(options.status, 204);
  assertEquals(
    options.headers.get("Access-Control-Allow-Methods"),
    "GET, HEAD, OPTIONS",
  );
  assertEquals(
    (await handler(new Request("https://filter.example/other"))).status,
    404,
  );
  assertEquals(
    (await handler(
      new Request(`https://filter.example/webcal?${validQuery}`, {
        method: "POST",
      }),
    )).status,
    405,
  );
  const limited = createCalendarFilterHandler({ maxRequestUrlBytes: 1 });
  assertEquals(
    (await limited(new Request(`https://filter.example/webcal?${validQuery}`)))
      .status,
    414,
  );
  const exactUrl = `https://filter.example/webcal?${validQuery}`;
  const exact = createCalendarFilterHandler({
    maxRequestUrlBytes: new TextEncoder().encode(exactUrl).byteLength,
  });
  assertEquals((await exact(new Request(exactUrl))).status, 501);
});
