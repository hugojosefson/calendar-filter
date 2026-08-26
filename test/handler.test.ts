import { assertEquals } from "@std/assert";

import { createCalendarFilterHandler } from "../mod.ts";

const source =
  "BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:keep\nEND:VEVENT\nBEGIN:VEVENT\nSUMMARY:drop\nEND:VEVENT\nEND:VCALENDAR\n";
const output =
  "BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:keep\nEND:VEVENT\nEND:VCALENDAR\n";
const digest =
  '"38f95b2ad256d58c46b9b0fc18a38cff7480bdf73bca5a7144c6308ffe338a8b"';
const validQuery =
  "input=https%3A%2F%2Fcalendar.example%2Ffeed.ics&include-regex=keep";

function handler(
  fetchImpl: typeof fetch = () => Promise.resolve(new Response(source)),
) {
  return createCalendarFilterHandler({
    allowPrivateUpstreams: true,
    fetchImpl,
  });
}

function request(method = "GET", extraHeaders?: HeadersInit): Request {
  return new Request(`https://filter.example/webcal?${validQuery}`, {
    headers: extraHeaders,
    method,
  });
}

Deno.test("handler loads, filters, and sets exact representation headers", async () => {
  const response = await handler()(request());
  assertEquals(response.status, 200);
  assertEquals(await response.text(), output);
  assertEquals(
    response.headers.get("Content-Type"),
    "text/calendar; charset=utf-8",
  );
  assertEquals(
    response.headers.get("Content-Disposition"),
    'inline; filename="calendar.ics"',
  );
  assertEquals(response.headers.get("ETag"), digest);
  assertEquals(response.headers.get("Cache-Control"), "no-cache");
  assertEquals(response.headers.get("Access-Control-Allow-Origin"), "*");
  assertEquals(
    response.headers.get("Access-Control-Expose-Headers"),
    "ETag, Content-Disposition",
  );
});

Deno.test("handler uses one upstream loader and produces bodyless HEAD responses", async () => {
  let calls = 0;
  const calendarHandler = handler(() => {
    calls++;
    return Promise.resolve(new Response(source));
  });
  const head = await calendarHandler(request("HEAD"));
  assertEquals(head.status, 200);
  assertEquals(await head.text(), "");
  assertEquals(head.headers.get("ETag"), digest);
  assertEquals((await calendarHandler(request())).status, 200);
  assertEquals(calls, 1);
});

Deno.test("handler weakly compares If-None-Match lists and wildcard", async () => {
  const calendarHandler = handler();
  for (const value of [`"other", W/${digest}`, "*"]) {
    const response = await calendarHandler(
      request("GET", { "If-None-Match": value }),
    );
    assertEquals(response.status, 304);
    assertEquals(await response.text(), "");
    assertEquals(response.headers.get("ETag"), digest);
    assertEquals(response.headers.get("Cache-Control"), "no-cache");
    assertEquals(response.headers.get("Content-Type"), null);
  }
});

Deno.test("handler maps upstream and malformed ICS failures to JSON errors", async () => {
  const upstreamFailure = await handler(() =>
    Promise.resolve(new Response(null, { status: 503 }))
  )(request());
  assertEquals(upstreamFailure.status, 502);
  assertEquals(
    (await upstreamFailure.json()).docs,
    "https://github.com/hugojosefson/calendar-filter#api",
  );
  const malformed = await handler(() =>
    Promise.resolve(new Response("not a calendar"))
  )(request("HEAD"));
  assertEquals(malformed.status, 502);
  assertEquals(await malformed.text(), "");
  assertEquals(
    malformed.headers.get("Content-Type"),
    "application/json; charset=utf-8",
  );

  const rejectedAddress = await createCalendarFilterHandler({
    fetchImpl: () => Promise.resolve(new Response(source)),
  })(
    new Request(
      "https://filter.example/webcal?input=http%3A%2F%2F127.0.0.1%2Ffeed.ics&include",
    ),
  );
  assertEquals(rejectedAddress.status, 400);

  const timeout = await createCalendarFilterHandler({
    allowPrivateUpstreams: true,
    fetchImpl: () => new Promise<Response>(() => {}),
    upstreamTimeoutMs: 1,
  })(request());
  assertEquals(timeout.status, 504);
});

Deno.test("handler preserves routing, OPTIONS, methods, URL size, and CORS", async () => {
  const calendarHandler = handler();
  const options = await calendarHandler(
    new Request("https://filter.example/webcal?bad", { method: "OPTIONS" }),
  );
  assertEquals(options.status, 204);
  assertEquals(
    options.headers.get("Access-Control-Allow-Methods"),
    "GET, HEAD, OPTIONS",
  );
  assertEquals(
    (await calendarHandler(new Request("https://filter.example/other"))).status,
    404,
  );
  const method = await calendarHandler(request("POST"));
  assertEquals(method.status, 405);
  assertEquals(method.headers.get("Allow"), "GET, HEAD, OPTIONS");
  const limited = createCalendarFilterHandler({
    allowPrivateUpstreams: true,
    fetchImpl: () => Promise.resolve(new Response(source)),
    maxRequestUrlBytes: 1,
  });
  assertEquals((await limited(request())).status, 414);
});
