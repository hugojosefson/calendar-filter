import { assertEquals, assertStrictEquals } from "@std/assert";

import { serveCalendarFilter } from "../src/server/server.ts";

Deno.test("server passes distinct server and filter options to Deno.serve", () => {
  const originalServe = Deno.serve;
  let capturedOptions: Deno.ServeTcpOptions | undefined;
  let capturedHandler:
    | ((request: Request) => Response | Promise<Response>)
    | undefined;
  const server = {} as Deno.HttpServer<Deno.NetAddr>;
  Deno.serve = ((
    options: Deno.ServeTcpOptions,
    handler: (request: Request) => Response | Promise<Response>,
  ) => {
    capturedOptions = options;
    capturedHandler = handler;
    return server;
  }) as typeof Deno.serve;

  try {
    assertStrictEquals(
      serveCalendarFilter({
        serverOptions: { hostname: "127.0.0.1", port: 9001 },
        filterOptions: { maxFilterRules: 1 },
      }),
      server,
    );
    assertEquals(capturedOptions, { hostname: "127.0.0.1", port: 9001 });
    assertStrictEquals(typeof capturedHandler, "function");
  } finally {
    Deno.serve = originalServe;
  }
});
