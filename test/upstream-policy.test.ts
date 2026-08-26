import { assertEquals } from "@std/assert";

import { isGloballyRoutableAddress } from "../src/ip-policy.ts";
import { UpstreamError } from "../src/upstream-error.ts";
import { assertUpstreamUrl } from "../src/upstream-policy.ts";

Deno.test("IP policy covers range boundaries and mapped literals", () => {
  for (
    const address of [
      "0.0.0.0",
      "0.255.255.255",
      "10.0.0.0",
      "10.255.255.255",
      "100.64.0.0",
      "100.127.255.255",
      "127.0.0.0",
      "192.0.0.0",
      "192.0.0.255",
      "192.0.2.0",
      "192.88.99.1",
      "198.18.0.0",
      "198.19.255.255",
      "224.0.0.0",
      "255.255.255.255",
      "::",
      "::1",
      "fc00::",
      "fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
      "fe80::",
      "ff00::",
      "2001:db8::",
      "::ffff:127.0.0.1",
      "::ffff:10.0.0.1",
    ]
  ) assertEquals(isGloballyRoutableAddress(address), false, address);
  for (
    const address of [
      "1.0.0.0",
      "8.8.8.8",
      "2001:4860:4860::8888",
      "::ffff:8.8.8.8",
    ]
  ) {
    assertEquals(isGloballyRoutableAddress(address), true, address);
  }
});

Deno.test("IP policy rejects special IPv6 prefixes at their boundaries", () => {
  for (
    const [first, last] of [
      ["::", "::ffff:ffff"],
      ["64:ff9b:1::", "64:ff9b:1:ffff:ffff:ffff:ffff:ffff"],
      ["100::", "100::ffff:ffff:ffff:ffff"],
      ["2001::", "2001:1ff:ffff:ffff:ffff:ffff:ffff:ffff"],
      ["2002::", "2002:ffff:ffff:ffff:ffff:ffff:ffff:ffff"],
      ["3fff::", "3fff:fff:ffff:ffff:ffff:ffff:ffff:ffff"],
      ["5f00::", "5f00:ffff:ffff:ffff:ffff:ffff:ffff:ffff"],
    ]
  ) {
    assertEquals(isGloballyRoutableAddress(first), false, first);
    assertEquals(isGloballyRoutableAddress(last), false, last);
  }
  for (const address of ["2001:2::", "2001:10::"]) {
    assertEquals(isGloballyRoutableAddress(address), false, address);
  }
  for (
    const address of [
      "2001:200::",
      "64:ff9b:2::",
      "2003::",
      "4000::",
      "5f01::",
    ]
  ) assertEquals(isGloballyRoutableAddress(address), true, address);
});

Deno.test("IP policy rejects malformed literals", () => {
  for (
    const address of [
      "",
      "1.2.3",
      "1.2.3.256",
      "1.2.3.-1",
      "::ffff:8.8.8",
      "::ffff:8.8.8.8:1",
      "::ffff:8.8.8.999",
      "1::2::3",
      "1:2:3",
      "gggg::1",
      "::ffff:8.8.8.8.1",
      "1:2:3:4:5:6:7:8::",
    ]
  ) assertEquals(isGloballyRoutableAddress(address), false, address);
});

Deno.test("literal IPs bypass DNS while DNS failures and mixed answers fail", async () => {
  let lookups = 0;
  await assertUpstreamUrl(
    new URL("https://8.8.8.8/calendar"),
    () => {
      lookups++;
      return Promise.resolve([]);
    },
    false,
    true,
  );
  assertEquals(lookups, 0);
  await assertUpstreamUrl(
    new URL("https://[2001:4860:4860::8888]/calendar"),
    () => {
      lookups++;
      return Promise.resolve([]);
    },
    false,
    true,
  );
  assertEquals(lookups, 0);
  await assertFailure(
    () =>
      assertUpstreamUrl(
        new URL("https://127.0.0.1"),
        () => Promise.resolve([]),
        false,
        true,
      ),
    400,
  );
  await assertFailure(
    () =>
      assertUpstreamUrl(
        new URL("https://[::1]"),
        () => Promise.resolve([]),
        false,
        false,
      ),
    502,
  );
  await assertFailure(
    () =>
      assertUpstreamUrl(
        new URL("https://a.example"),
        () => Promise.resolve(["8.8.8.8", "127.0.0.1"]),
        false,
        true,
      ),
    400,
  );
  await assertFailure(
    () =>
      assertUpstreamUrl(
        new URL("https://a.example"),
        () => Promise.reject(new Error("DNS")),
        false,
        true,
      ),
    502,
  );
});

Deno.test("policy rejects non-HTTP URLs and credentials with initial status", async () => {
  for (const url of ["ftp://a.example", "https://user:pass@a.example"]) {
    await assertFailure(
      () =>
        assertUpstreamUrl(
          new URL(url),
          () => Promise.resolve(["8.8.8.8"]),
          false,
          true,
        ),
      400,
    );
  }
});

async function assertFailure(
  action: () => Promise<void>,
  status: UpstreamError["status"],
): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (error instanceof UpstreamError) {
      assertEquals(error.status, status);
      return;
    }
    throw error;
  }
  throw new Error("Expected UpstreamError");
}
