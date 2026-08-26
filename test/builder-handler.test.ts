import { assert, assertEquals, assertMatch } from "@std/assert";
import { createCalendarFilterHandler } from "../mod.ts";

const source =
  "BEGIN:VCALENDAR\nX-WR-CALNAME:Source\\, Calendar\nBEGIN:VEVENT\nSUMMARY:Keep\\, me\nDTSTART:20260101\nLOCATION:Here\\nNow\nEND:VEVENT\nBEGIN:VEVENT\nSUMMARY:Drop\nEND:VEVENT\nEND:VCALENDAR\n";

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
  assertMatch(
    await response.text(),
    /<form method="get" action="\/build" data-builder>/,
  );
  assertEquals(calls, 0);
  assertEquals(response.headers.get("Cache-Control"), "no-store");
  assertEquals(response.headers.get("X-Content-Type-Options"), "nosniff");
  assertEquals(
    response.headers.get("Content-Security-Policy"),
    "default-src 'none'; connect-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  );
});

Deno.test("builder serves local stylesheet and enhancement assets", async () => {
  const calendarHandler = handler();
  const page = await calendarHandler(new Request("https://filter.example/"));
  const body = await page.text();
  assert(body.includes('href="/builder.css"'));
  assert(body.includes('src="/builder.js"'));
  assert(!body.includes("cdn.jsdelivr.net"));

  const css = await calendarHandler(
    new Request("https://filter.example/builder.css"),
  );
  assertEquals(css.status, 200);
  assertEquals(css.headers.get("Content-Type"), "text/css; charset=utf-8");
  assert((await css.text()).includes(":root"));

  const javascript = await calendarHandler(
    new Request("https://filter.example/builder.js"),
  );
  assertEquals(javascript.status, 200);
  assertEquals(
    javascript.headers.get("Content-Type"),
    "text/javascript; charset=utf-8",
  );
  assert((await javascript.text()).length > 1_000);
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
  assert(body.includes('placeholder="Source, Calendar"'));
  assertEquals(calls, 1);
});

Deno.test("builder numbers ordered rules and explains catch-all reachability", async () => {
  const response = await handler()(
    new Request(
      "https://filter.example/?input=https%3A%2F%2Fcalendar.example%2Ffeed&include-regex=First&include=&exclude-regex=Last",
    ),
  );
  const body = await response.text();
  assert(body.includes("Rule 1"));
  assert(body.includes("Rule 2"));
  assert(body.includes("Rule 3"));
  assertEquals(body.match(/data-drag-handle/g)?.length, 3);
  assert(body.includes("This rule has no effect. Rule 2 matches every event"));
  assert(body.includes("Move it to the end so later rules can run"));
  assert(!body.includes('value="add-all"'));
});

Deno.test("builder shows generated regex wrappers only in stored state", async () => {
  const body = await (await handler()(
    new Request(
      "https://filter.example/?input=https%3A%2F%2Fcalendar.example%2Ffeed&include-regex=%28plain%29",
    ),
  )).text();
  assert(body.includes('data-stored-pattern="(plain)"'));
  assertMatch(body, /data-regex[^>]+value="plain"/);
});

Deno.test("builder explains blank and invalid regexes", async () => {
  const blank = await (await handler()(
    new Request(
      "https://filter.example/?input=https%3A%2F%2Fcalendar.example%2Ffeed&include-regex-m=",
    ),
  )).text();
  assertMatch(
    blank,
    /id="rule-0-regex-explanation" data-regex-explanation aria-live="polite">Matches everything\.<\/small>/,
  );

  const invalid = await (await handler()(
    new Request(
      "https://filter.example/?input=https%3A%2F%2Fcalendar.example%2Ffeed&include-regex=%5B",
    ),
  )).text();
  assertMatch(
    invalid,
    /id="rule-0-regex-explanation" data-regex-explanation aria-live="polite">Cannot explain an invalid RE2 expression\.<\/small>/,
  );
  assertMatch(
    invalid,
    /aria-describedby="rule-0-regex-error rule-0-regex-explanation"/,
  );

  const text = await (await handler()(
    new Request(
      "https://filter.example/?input=https%3A%2F%2Fcalendar.example%2Ffeed&include-regex=plain",
    ),
  )).text();
  assert(!text.includes("data-regex-explanation"));
});

Deno.test("builder makes a neutral update the first submit control", async () => {
  const body = await (await handler()(
    new Request(
      "https://filter.example/?input=https%3A%2F%2Fcalendar.example%2Ffeed&include-regex=keep",
    ),
  )).text();
  assert(
    body.indexOf('class="implicit-submit"') < body.indexOf('value="up-'),
  );
  assert(
    body.indexOf('class="implicit-submit"') <
      body.indexOf('value="add-text"'),
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
  const drag = await handler()(new Request(`${base}&operation=move-0-1`));
  assertEquals(
    drag.headers.get("Location"),
    "/?input=https%3A%2F%2Fcalendar.example%2Ffeed&exclude-regex=second&include-regex=first",
  );
});

Deno.test("new pattern rules are inserted before the first catch-all", async () => {
  const base =
    "https://filter.example/build?input=https%3A%2F%2Fcalendar.example%2Ffeed&rule-count=1&rule-0-kind=all";
  const include = await handler()(
    new Request(`${base}&operation=add-text`),
  );
  assertEquals(
    include.headers.get("Location"),
    "/?input=https%3A%2F%2Fcalendar.example%2Ffeed&include-regex=&include=",
  );
  const exclude = await handler()(
    new Request(`${base}&operation=add-exclude-text`),
  );
  assertEquals(
    exclude.headers.get("Location"),
    "/?input=https%3A%2F%2Fcalendar.example%2Ffeed&exclude-regex=&include=",
  );
});

Deno.test("build-url accepts webcal and page methods are bodyless for HEAD", async () => {
  const calendarHandler = handler();
  const page = await calendarHandler(new Request("https://filter.example/"));
  assertMatch(
    await page.text(),
    /name="url"\s+type="url"\s+value="webcal:/,
  );
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
