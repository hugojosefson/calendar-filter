/** @module Real-browser coverage for native and enhanced builder use. */

import { chromium, type Page } from "@playwright/test";
import { assert, assertEquals } from "@std/assert";
import { createCalendarFilterHandler } from "../mod.ts";

const calendar =
  "BEGIN:VCALENDAR\nX-WR-CALNAME:Source Calendar\nBEGIN:VEVENT\nSUMMARY:Keep\nDTSTART:20260101\nEND:VEVENT\nBEGIN:VEVENT\nSUMMARY:Drop\nEND:VEVENT\nEND:VCALENDAR\n";
const handler = createCalendarFilterHandler({
  allowPrivateUpstreams: true,
  fetchImpl: () => Promise.resolve(new Response(calendar)),
});

/** Launches local Chromium when supplied, otherwise CI's Playwright browser. */
async function browser() {
  return await chromium.launch({
    executablePath: Deno.env.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"),
  });
}

/** Runs one browser case against an isolated ephemeral server. */
async function withPage(
  javaScriptEnabled: boolean,
  run: (page: Page, origin: string) => Promise<void>,
): Promise<void> {
  const server = Deno.serve({ port: 0, hostname: "127.0.0.1" }, handler);
  const origin = `http://127.0.0.1:${server.addr.port}`;
  const instance = await browser();
  try {
    const page = await instance.newPage({ javaScriptEnabled });
    const browserFailures: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") {
        browserFailures.push(`console ${message.type()}: ${message.text()}`);
      }
    });
    page.on(
      "pageerror",
      (error) => browserFailures.push(`pageerror: ${error.message}`),
    );
    page.on(
      "requestfailed",
      (request) =>
        browserFailures.push(
          `requestfailed: ${request.url()} ${request.failure()?.errorText}`,
        ),
    );
    page.on("response", (response) => {
      if (response.status() >= 400) {
        browserFailures.push(`HTTP ${response.status()}: ${response.url()}`);
      }
    });
    await run(page, origin);
    await page.waitForTimeout(50);
    assertEquals(browserFailures, []);
  } finally {
    await instance.close();
    await server.shutdown();
  }
}

Deno.test("native controls work without JavaScript", async () => {
  await withPage(false, async (page, origin) => {
    await page.goto(origin);
    assertEquals(
      await page.getByRole("button", { name: "Load URL" }).count(),
      1,
    );
    await page.getByLabel("Source calendar URL (input)").fill(
      "https://calendar.example/feed",
    );
    await page.getByRole("button", { name: "Add include text filter" }).click();
    const pattern = page.getByLabel(/All events that include/);
    await pattern.fill("Keep");
    await pattern.press("Enter");
    assertEquals(await page.getByText("1 of 2 events kept").count(), 1);
    assertEquals(await page.locator("article.event").count(), 1);
    await page.getByRole("button", {
      name: "Add exclude text filter",
    }).click();
    await page.getByRole("button", { name: /Move rule 2 up/ }).click();
    await page.getByRole("button", { name: /Remove rule 1/ }).click();
    assertEquals(await page.getByRole("switch").count(), 1);
    assertEquals(await page.locator("[data-drag-handle]:visible").count(), 0);
  });
});

Deno.test("enhancement preserves URL state and editor semantics", async () => {
  await withPage(true, async (page, origin) => {
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));

    await page.goto(origin);
    await page.emulateMedia({ colorScheme: "dark" });
    const darkBackground = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue(
        "--pico-background-color",
      )
    );
    await page.emulateMedia({ colorScheme: "light" });
    const lightBackground = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue(
        "--pico-background-color",
      )
    );
    assert(darkBackground !== lightBackground);
    assert(
      requests.every((url) =>
        !url.startsWith("http:") || url.startsWith(origin)
      ),
    );
    assert(
      requests.every((url) =>
        !url.startsWith("https:") || url.startsWith(origin)
      ),
    );

    assertEquals(await page.locator("[data-manual-update]").count(), 2);
    const calendarInput = page.getByLabel("Source calendar URL (input)");
    await calendarInput.fill("https://calendar.example/feed");
    await page.waitForFunction(() =>
      new URL(location.href).searchParams.get("input") ===
        "https://calendar.example/feed"
    );
    assertEquals(
      await page.evaluate(() =>
        (document.activeElement as HTMLInputElement).name
      ),
      "input",
    );
    assertEquals(await page.locator("[data-manual-update]").count(), 0);
    assertEquals(
      await page.getByLabel("Override calendar name (optional)").getAttribute(
        "placeholder",
      ),
      "Source Calendar",
    );

    await page.getByRole("button", { name: "Add include text filter" }).click();
    await page.waitForFunction(() =>
      new URL(location.href).searchParams.has("include-regex")
    );
    const ruleBox = await page.locator(".rule").boundingBox();
    assert(ruleBox !== null && ruleBox.width > 1_000 && ruleBox.height < 180);
    const backgrounds = await page.evaluate(() => ({
      page: getComputedStyle(document.body).backgroundColor,
      rule: getComputedStyle(document.querySelector(".rule")!).backgroundColor,
    }));
    assert(backgrounds.page !== backgrounds.rule);
    await page.getByLabel(/All events that include/).fill("Keep");
    await page.waitForFunction(() =>
      new URL(location.href).searchParams.get("include-regex") === "Keep"
    );
    await page.getByRole("switch").click();
    await page.locator(".cm-editor").waitFor();
    assert(
      (await page.locator("[data-regex-explanation]").innerText()).startsWith(
        "Matches ",
      ),
    );

    const editor = page.locator(".cm-content");
    assertEquals(await editor.innerText(), "Keep");
    await editor.fill("");
    assertEquals(
      await page.locator("[data-regex-explanation]").innerText(),
      "Matches everything.",
    );
    await editor.fill("plain");
    await page.waitForFunction(() =>
      new URL(location.href).searchParams.get("include-regex") === "(plain)"
    );
    assertEquals(await page.locator(".cm-editor").count(), 1);
    assert(
      (await page.locator("[data-regex-explanation]").innerText()).startsWith(
        "Matches ",
      ),
    );

    await page.getByLabel("Override calendar name (optional)").fill("Renamed");
    await page.waitForFunction(() =>
      new URL(location.href).searchParams.get("calendar-name") === "Renamed"
    );
    assertEquals(
      new URL(page.url()).searchParams.get("include-regex"),
      "plain",
    );
    assertEquals(await page.locator(".cm-editor").count(), 0);

    await page.getByRole("switch").click();
    await page.locator(".cm-editor").waitFor();
    await editor.fill("^(Keep|Drop)+$");
    assert(await page.locator(".cm-re2-group").count() > 0);
    assert(await page.locator(".cm-re2-quantifier").count() > 0);
    assertEquals(await page.locator(".cm-invalid").count(), 0);
    await page.waitForFunction(() =>
      new URL(location.href).searchParams.get("include-regex") ===
        "^(Keep|Drop)+$"
    );
    assertEquals(
      await page.evaluate(() =>
        document.activeElement?.classList.contains("cm-content")
      ),
      true,
    );

    await editor.fill("[");
    assertEquals(await page.locator(".cm-invalid").count(), 1);
    assertEquals(
      await page.locator("[data-regex-explanation]").innerText(),
      "Cannot explain an invalid RE2 expression.",
    );
    assertEquals(
      await page.locator("[data-regex-error]").evaluate((node) =>
        (node as HTMLElement).hidden
      ),
      false,
    );
    await page.waitForTimeout(350);
    assertEquals(
      new URL(page.url()).searchParams.get("include-regex"),
      "^(Keep|Drop)+$",
    );
    await editor.press("Enter");
    await page.waitForFunction(() =>
      new URL(location.href).searchParams.get("include-regex") === "["
    );
    assertEquals((await editor.innerText()).includes("\n"), false);

    await editor.press("Tab");
    assertEquals(
      await page.evaluate(() => ({
        className: (document.activeElement as HTMLElement).className,
        name: (document.activeElement as HTMLInputElement).name,
        tagName: document.activeElement?.tagName,
      })),
      { className: "", name: "rule-0-action", tagName: "SELECT" },
    );

    await page.goBack();
    assertEquals(
      new URL(page.url()).searchParams.get("include-regex"),
      "^(Keep|Drop)+$",
    );
  });
});

Deno.test("enhanced updates survive back navigation and show retry controls", async () => {
  await withPage(true, async (page, origin) => {
    await page.goto(origin);
    const source = "https://calendar.example/feed";
    await page.getByLabel("Source calendar URL (input)").fill(source);
    await page.waitForFunction(() =>
      new URL(location.href).searchParams.has("input")
    );
    await page.getByRole("button", { name: "Add include text filter" }).click();
    await page.waitForFunction(() =>
      new URL(location.href).searchParams.has("include-regex")
    );

    await page.route("**/build?**", async (route) => {
      if (route.request().url().includes("include-regex=Keep")) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      await route.continue();
    });
    await page.getByLabel(/All events that include/).fill("Keep");
    await page.waitForTimeout(350);
    await page.evaluate(() => history.back());
    await page.waitForFunction(() =>
      !new URL(location.href).searchParams.has("include-regex")
    );
    await page.waitForTimeout(500);
    assertEquals(new URL(page.url()).searchParams.has("include-regex"), false);
    await page.unroute("**/build?**");

    await page.goto(`${origin}/?input=${encodeURIComponent(source)}`);
    await page.route("**/*", async (route) => {
      if (route.request().url().includes("calendar-name=Retry")) {
        await route.fulfill({
          body: "not HTML",
          contentType: "text/plain",
        });
        return;
      }
      await route.continue();
    });
    await page.getByLabel("Override calendar name (optional)").fill("Retry");
    await page.getByRole("alert").waitFor();
    assertEquals(await page.getByText("Update preview").count() > 0, true);
    await page.unroute("**/*");
    await page.getByRole("button", { name: "Update preview" }).last().click();
    await page.waitForFunction(() =>
      new URL(location.href).searchParams.get("calendar-name") === "Retry"
    );
    assertEquals(await page.getByRole("alert").count(), 0);
  });
});

Deno.test("builder has no horizontal overflow at 320 pixels", async () => {
  await withPage(true, async (page, origin) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto(
      `${origin}/?input=https%3A%2F%2Fcalendar.example%2Ffeed&include-regex=%28Keep%29&include=&exclude-regex=%28Drop%29`,
    );
    assertEquals(
      await page.evaluate(() =>
        document.documentElement.scrollWidth <= innerWidth
      ),
      true,
    );
    assertEquals(
      await page.locator(".rule-heading .actions").evaluateAll((actions) =>
        actions.every((action) => action.getBoundingClientRect().height < 40)
      ),
      true,
    );
    assertEquals(await page.locator("[data-regex-explanation]").count(), 2);
  });
});

Deno.test("drag handle reorders numbered rule slots", async () => {
  await withPage(true, async (page, origin) => {
    const input = encodeURIComponent("https://calendar.example/feed");
    await page.goto(
      `${origin}/?input=${input}&include-regex=%28Keep%29&exclude-regex=Drop`,
    );
    const handles = page.locator("[data-drag-handle]");
    assertEquals(await handles.count(), 2);
    assertEquals(
      await handles.first().evaluate((node) => getComputedStyle(node).cursor),
      "grab",
    );

    await handles.first().dragTo(page.locator("[data-rule-index='1']"));
    await page.waitForFunction(() =>
      [...new URL(location.href).searchParams.keys()][1] === "exclude-regex"
    );
    assertEquals(
      [...new URL(page.url()).searchParams.entries()].slice(1),
      [["exclude-regex", "Drop"], ["include-regex", "(Keep)"]],
    );
    assertEquals(await page.locator(".cm-editor").count(), 1);
    assertEquals(await page.locator(".cm-content").innerText(), "Keep");
    assertEquals(await page.locator("[data-manual-update]").count(), 0);
  });
});

Deno.test("automatic result URL loading removes its manual button", async () => {
  await withPage(true, async (page, origin) => {
    await page.goto(origin);
    assertEquals(
      await page.locator("[data-manual-result-url]").count(),
      1,
    );
    const source = encodeURIComponent("https://calendar.example/feed");
    await page.getByLabel("Filtered calendar subscription URL").fill(
      `${origin}/webcal?input=${source}&include-regex=Keep`,
    );
    await page.waitForFunction(() =>
      new URL(location.href).searchParams.get("include-regex") === "Keep"
    );
    assertEquals(
      await page.locator("[data-manual-result-url]").count(),
      0,
    );
  });
});
