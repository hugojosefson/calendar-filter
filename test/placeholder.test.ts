import { assertEquals } from "@std/assert";
import { placeholder } from "../mod.ts";

Deno.test("placeholder", async (t) => {
  await t.step("does not throw", placeholder);

  await t.step("returns undefined", () => {
    assertEquals(placeholder(), undefined);
  });
});
