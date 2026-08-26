import { assertEquals, assertThrows } from "@std/assert";

import { CliUsageError, parseCliOptions } from "../src/cli-options.ts";

Deno.test("CLI options use safe server and handler defaults", () => {
  assertEquals(parseCliOptions([]), {
    kind: "serve",
    options: {
      hostname: "0.0.0.0",
      port: 9000,
      handlerOptions: {},
    },
  });
});

Deno.test("CLI options parse hosts, ports, handler limits, and private upstreams", () => {
  assertEquals(
    parseCliOptions([
      "--host=127.0.0.1",
      "--port",
      "8080",
      "--allow-private-upstreams",
      "--upstream-timeout-ms=1",
      "--max-upstream-redirects=0",
      "--max-upstream-bytes",
      "2",
      "--upstream-cache-ttl-ms=0",
      "--max-upstream-cache-bytes=0",
      "--max-request-url-bytes=3",
      "--max-filter-rules=4",
      "--max-regex-bytes=5",
      "--max-calendar-name-bytes=6",
    ]),
    {
      kind: "serve",
      options: {
        hostname: "127.0.0.1",
        port: 8080,
        handlerOptions: {
          allowPrivateUpstreams: true,
          upstreamTimeoutMs: 1,
          maxUpstreamRedirects: 0,
          maxUpstreamBytes: 2,
          upstreamCacheTtlMs: 0,
          maxUpstreamCacheBytes: 0,
          maxRequestUrlBytes: 3,
          maxFilterRules: 4,
          maxRegexBytes: 5,
          maxCalendarNameBytes: 6,
        },
      },
    },
  );
});

Deno.test("CLI options accept help", () => {
  assertEquals(parseCliOptions(["-h"]), { kind: "help" });
  assertEquals(parseCliOptions(["--help"]), { kind: "help" });
});

Deno.test("CLI options reject malformed input", () => {
  for (
    const args of [
      ["calendar.ics"],
      ["--unknown"],
      ["--host"],
      ["--port=0"],
      ["--port=65536"],
      ["--port=1.5"],
      ["--max-filter-rules=0"],
      ["--max-upstream-redirects=-1"],
      ["--allow-private-upstreams=true"],
      ["--host=a", "--host=b"],
      ["--help", "-h"],
    ]
  ) {
    assertThrows(() => parseCliOptions(args), CliUsageError);
  }
});
