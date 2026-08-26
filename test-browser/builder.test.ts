/** @module Real-browser coverage for native and enhanced builder use. */

import { chromium, type Page } from "@playwright/test";
import { assert, assertEquals } from "@std/assert";
import { createCalendarFilterHandler } from "../mod.ts";

const calendar =
  "BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:Keep\nDTSTART:20260101\nEND:VEVENT\nBEGIN:VEVENT\nSUMMARY:Drop\nEND:VEVENT\nEND:VCALENDAR\n";
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
    await run(page, origin);
  } finally {
    await instance.close();
    await server.shutdown();
  }
}

Deno.test("native controls work without JavaScript", async () => {
  await withPage(false, async (page, origin) => {
    await page.goto(origin);
    await page.getByLabel("Calendar URL").fill("https://calendar.example/feed");
    await page.getByRole("button", { name: "Add include text filter" }).click();
    await page.getByLabel("Pattern").fill("Keep");
    await page.getByLabel("Pattern").press("Enter");
    assertEquals(await page.getByText("1 of 2 events kept").count(), 1);
    assertEquals(await page.locator("article.event").count(), 1);
    await page.getByRole("button", {
      name: "Add exclude text filter",
    }).click();
    await page.getByRole("button", { name: "Move up" }).last().click();
    await page.getByRole("button", { name: "Remove" }).first().click();
    assertEquals(await page.getByRole("switch").count(), 1);
  });
});

Deno.test("enhancement preserves URL state and editor semantics", async () => {
  await withPage(true, async (page, origin) => {
    const errors: Error[] = [];
    const requests: string[] = [];
    page.on("pageerror", (error) => errors.push(error));
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
    assert(requests.every((url) => url.startsWith(origin)));

    const calendarInput = page.getByLabel("Calendar URL");
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

    await page.getByRole("button", { name: "Add include text filter" }).click();
    await page.waitForFunction(() =>
      new URL(location.href).searchParams.has("include-regex")
    );
    await page.getByRole("switch").click();
    await page.locator(".cm-editor").waitFor();

    const editor = page.locator(".cm-content");
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
      await page.locator("[data-regex-error]").evaluate((node) =>
        (node as HTMLElement).hidden
      ),
      false,
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
      { className: "", name: "rule-0-flag-i", tagName: "INPUT" },
    );

    await page.goBack();
    assertEquals(
      new URL(page.url()).searchParams.get("include-regex"),
      "^(Keep|Drop)+$",
    );
    assertEquals(errors, []);
  });
});
