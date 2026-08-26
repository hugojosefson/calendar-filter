import { assert, assertEquals, assertMatch } from "@std/assert";
import { createCalendarFilterHandler } from "../mod.ts";

const source =
  "BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:Keep\\, me\nDTSTART:20260101\nLOCATION:Here\\nNow\nEND:VEVENT\nBEGIN:VEVENT\nSUMMARY:Drop\nEND:VEVENT\nEND:VCALENDAR\n";

function handler(
  fetchImpl: typeof fetch = () => Promise.resolve(new Response(source)),
) {
  return createCalendarFilterHandler({
    allowPrivateUpstreams: true,
    fetchImpl,
  });
}

Deno.test("empty root is a secure builder page without an upstream request", async () => {
  let calls = 0;
  const response = await handler(() => {
    calls++;
    return Promise.resolve(new Response(source));
  })(new Request("https://filter.example/"));
  assertEquals(response.status, 200);
  assertMatch(await response.text(), /<form method=get action=\/build>/);
  assertEquals(calls, 0);
  assertEquals(response.headers.get("Cache-Control"), "no-store");
  assertEquals(response.headers.get("X-Content-Type-Options"), "nosniff");
  assertEquals(
    response.headers.get("Content-Security-Policy"),
    "default-src 'none'; style-src 'self' https://cdn.jsdelivr.net; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  );
});

Deno.test("root preview shares its upstream cache and escapes event text", async () => {
  let calls = 0;
  const response = await handler(() => {
    calls++;
    return Promise.resolve(new Response(source));
  })(
    new Request(
      "https://filter.example/?input=https%3A%2F%2Fcalendar.example%2Ffeed&include-regex=Keep",
    ),
  );
  const body = await response.text();
  assertMatch(body, /1 of 2 events kept/);
  assert(body.includes("Keep, me"));
  assertEquals(calls, 1);
});

Deno.test("builder makes a neutral update the first submit control", async () => {
  const body = await (await handler()(
    new Request(
      "https://filter.example/?input=https%3A%2F%2Fcalendar.example%2Ffeed&include-regex=keep",
    ),
  )).text();
  assert(
    body.indexOf("class=implicit-submit") < body.indexOf("value=up-"),
  );
  assert(
    body.indexOf("class=implicit-submit") < body.indexOf("value=add-text"),
  );
});

Deno.test("build canonicalizes unsaved action, flags, mode, and additions", async () => {
  const response = await handler()(
    new Request(
      "https://filter.example/build?input=https%3A%2F%2Fcalendar.example%2Ffeed&rule-count=1&rule-0-original-mode=text&rule-0-action=exclude&rule-0-pattern=a.b&rule-0-mode=regex&rule-0-flag-i=on&operation=add-all",
    ),
  );
  assertEquals(response.status, 303);
  assertEquals(
    response.headers.get("Location"),
    "/?input=https%3A%2F%2Fcalendar.example%2Ffeed&exclude-regex-i=%28a%5C.b%29&include=",
  );
  const exclude = await handler()(
    new Request(
      "https://filter.example/build?input=https%3A%2F%2Fcalendar.example%2Ffeed&rule-count=0&operation=add-exclude-text",
    ),
  );
  assertEquals(
    exclude.headers.get("Location"),
    "/?input=https%3A%2F%2Fcalendar.example%2Ffeed&exclude-regex=",
  );
  const flags = await handler()(
    new Request(
      "https://filter.example/build?input=https%3A%2F%2Fcalendar.example%2Ffeed&rule-count=1&rule-0-original-mode=text&rule-0-pattern=a.b&rule-0-flag-m=on",
    ),
  );
  assertEquals(
    flags.headers.get("Location"),
    "/?input=https%3A%2F%2Fcalendar.example%2Ffeed&include-regex-m=%28a%5C.b%29",
  );
  const text = await handler()(
    new Request(
      "https://filter.example/build?input=https%3A%2F%2Fcalendar.example%2Ffeed&rule-count=1&rule-0-original-mode=regex&rule-0-action=exclude&rule-0-pattern=plain",
    ),
  );
  assertEquals(
    text.headers.get("Location"),
    "/?input=https%3A%2F%2Fcalendar.example%2Ffeed&exclude-regex=plain",
  );
});

Deno.test("build removes and reorders submitted rules", async () => {
  const base =
    "https://filter.example/build?input=https%3A%2F%2Fcalendar.example%2Ffeed&rule-count=2&rule-0-original-mode=text&rule-0-pattern=first&rule-1-original-mode=text&rule-1-action=exclude&rule-1-pattern=second";
  const remove = await handler()(new Request(`${base}&operation=remove-0`));
  assertEquals(
    remove.headers.get("Location"),
    "/?input=https%3A%2F%2Fcalendar.example%2Ffeed&exclude-regex=second",
  );
  const move = await handler()(new Request(`${base}&operation=up-1`));
  assertEquals(
    move.headers.get("Location"),
    "/?input=https%3A%2F%2Fcalendar.example%2Ffeed&exclude-regex=second&include-regex=first",
  );
});

Deno.test("build-url accepts webcal and page methods are bodyless for HEAD", async () => {
  const calendarHandler = handler();
  const page = await calendarHandler(new Request("https://filter.example/"));
  assertMatch(await page.text(), /name=url type=url value="webcal:/);
  const redirect = await calendarHandler(
    new Request(
      "https://filter.example/build-url?url=webcal%3A%2F%2Ffilter.example%2Fwebcal%3Finput%3Dhttps%253A%252F%252Fcalendar.example%252Ffeed%26include",
    ),
  );
  assertEquals(redirect.status, 303);
  assertEquals(
    redirect.headers.get("Location"),
    "/?input=https%3A%2F%2Fcalendar.example%2Ffeed&include=",
  );
  const head = await calendarHandler(
    new Request("https://filter.example/", { method: "HEAD" }),
  );
  assertEquals(await head.text(), "");
  const post = await calendarHandler(
    new Request("https://filter.example/", { method: "POST" }),
  );
  assertEquals(post.status, 405);
  assertEquals(post.headers.get("Allow"), "GET, HEAD");
});

Deno.test("builder escapes hostile query diagnostics and event fields", async () => {
  const hostile =
    'BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:<img src=x onerror=alert(1)>\\q\nLOCATION:"><svg onload=alert(1)>\nEND:VEVENT\nEND:VCALENDAR\n';
  const response = await handler()(
    new Request(
      "https://filter.example/?input=https%3A%2F%2Fcalendar.example%2Ffeed&%22%3E%3Cimg%20src%3Dx%20onerror%3Dalert%281%29%3E=x",
    ),
  );
  const diagnosticBody = await response.text();
  assert(diagnosticBody.includes("Unknown query parameter: &quot;&gt;&lt;img"));
  const preview = await handler(() => Promise.resolve(new Response(hostile)))(
    new Request(
      "https://filter.example/?input=https%3A%2F%2Fcalendar.example%2Ffeed&include-regex=.%2A",
    ),
  );
  const body = await preview.text();
  assert(!body.includes("<img src=x onerror=alert(1)>"));
  assert(!body.includes('"><svg onload=alert(1)>'));
  assert(body.includes("&lt;img src=x onerror=alert(1)&gt;"));
  assert(body.includes("&lt;svg onload=alert(1)&gt;"));
  assert(body.includes("\\q"));
});
