import { assertEquals } from "@std/assert";

import { resolveOptions } from "../src/options.ts";
import { createUpstreamLoader } from "../src/upstream-loader.ts";
import { UpstreamError } from "../src/upstream-error.ts";

const decoder = new TextDecoder();
const publicResolver = (): Promise<string[]> => Promise.resolve(["8.8.8.8"]);
const url = (path = "calendar") => new URL(`https://a.example/${path}`);

Deno.test("loader follows a relative redirect and rejects HTTP failures", async () => {
  const calls: string[] = [];
  const loader = createUpstreamLoader(resolveOptions(undefined), {
    resolver: publicResolver,
    fetchImpl: (input) => {
      calls.push(String(input));
      if (calls.length === 1) {
        return Promise.resolve(
          new Response(null, { status: 302, headers: { Location: "/final" } }),
        );
      }
      return Promise.resolve(new Response("ok"));
    },
  });
  const loaded = await loader(url("start"));
  assertEquals(loaded.url.href, "https://a.example/final");
  assertEquals(decoder.decode(loaded.body), "ok");
  assertEquals(calls, ["https://a.example/start", "https://a.example/final"]);

  for (const status of [300, 404, 500]) {
    const failed = responseWithCancellableBody(status);
    const failureLoader = createUpstreamLoader(resolveOptions(undefined), {
      resolver: publicResolver,
      fetchImpl: () => Promise.resolve(failed.response),
    });
    await assertFailure(() => failureLoader(url()), 502);
    assertEquals(failed.cancelled(), true);
  }
});

Deno.test("redirect failures have gateway status and cancel their bodies", async () => {
  for (
    const response of [
      responseWithCancellableBody(302),
      responseWithCancellableBody(302, { Location: "http://[::1" }),
      responseWithCancellableBody(302, { Location: "ftp://a.example" }),
      responseWithCancellableBody(302, {
        Location: "https://user:pass@a.example",
      }),
    ]
  ) {
    const loader = createUpstreamLoader(resolveOptions(undefined), {
      resolver: publicResolver,
      fetchImpl: () => Promise.resolve(response.response),
    });
    await assertFailure(() => loader(url()), 502);
    assertEquals(response.cancelled(), true);
  }
  const privateTarget = createUpstreamLoader(resolveOptions(undefined), {
    resolver: (host) =>
      Promise.resolve(host === "private.example" ? ["127.0.0.1"] : ["8.8.8.8"]),
    fetchImpl: () =>
      Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { Location: "https://private.example" },
        }),
      ),
  });
  await assertFailure(() => privateTarget(url()), 502);
  const limited = createUpstreamLoader(
    resolveOptions({ maxUpstreamRedirects: 0 }),
    {
      resolver: publicResolver,
      fetchImpl: () =>
        Promise.resolve(
          new Response(null, { status: 302, headers: { Location: "/next" } }),
        ),
    },
  );
  await assertFailure(() => limited(url()), 502);
});

Deno.test("body limit accepts its exact size and cancels one byte over", async () => {
  const exact = createUpstreamLoader(resolveOptions({ maxUpstreamBytes: 2 }), {
    resolver: publicResolver,
    fetchImpl: () => Promise.resolve(new Response("ok")),
  });
  assertEquals(decoder.decode((await exact(url())).body), "ok");
  const oversizedBody = responseWithCancellableBody(200, undefined, "bad");
  const oversized = createUpstreamLoader(
    resolveOptions({ maxUpstreamBytes: 2 }),
    {
      resolver: publicResolver,
      fetchImpl: () => Promise.resolve(oversizedBody.response),
    },
  );
  await assertFailure(() => oversized(url()), 502);
  assertEquals(oversizedBody.cancelled(), true);
});

Deno.test("deadline bounds resolvers, fetches, and readers that ignore abort", async () => {
  const hanging = (): Promise<never> => new Promise(() => {});
  const options = resolveOptions({ upstreamTimeoutMs: 5 });
  await assertFailure(
    () =>
      createUpstreamLoader(options, {
        resolver: hanging,
        fetchImpl: fetch,
      })(url()),
    504,
  );
  await assertFailure(
    () =>
      createUpstreamLoader(options, {
        resolver: publicResolver,
        fetchImpl: hanging,
      })(url()),
    504,
  );
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    cancel: () => {
      cancelled = true;
    },
    pull: () => hanging(),
  });
  await assertFailure(
    () =>
      createUpstreamLoader(options, {
        resolver: publicResolver,
        fetchImpl: () => Promise.resolve(new Response(body)),
      })(url()),
    504,
  );
  assertEquals(cancelled, true);
});

Deno.test("an unconditional 304 fails", async () => {
  const loader = createUpstreamLoader(resolveOptions(undefined), {
    resolver: publicResolver,
    fetchImpl: () => Promise.resolve(new Response(null, { status: 304 })),
  });
  await assertFailure(() => loader(url()), 502);
});

Deno.test("revalidation sends validators only to the unchanged final URL", async () => {
  let now = 0;
  const calls: Array<{ url: string; headers: Headers }> = [];
  const loader = createUpstreamLoader(resolveOptions(undefined), {
    now: () => now,
    resolver: publicResolver,
    fetchImpl: (input, init) => {
      calls.push({ url: String(input), headers: new Headers(init?.headers) });
      if (calls.length === 1 || calls.length === 3 || calls.length === 5) {
        return Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { Location: calls.length === 5 ? "/changed" : "/same" },
          }),
        );
      }
      if (calls.length === 2) {
        return Promise.resolve(
          new Response("old", {
            headers: {
              "Cache-Control": "max-age=0",
              ETag: "old",
              "Last-Modified": "yesterday",
            },
          }),
        );
      }
      if (calls.length === 4) {
        return Promise.resolve(
          new Response(null, {
            status: 304,
            headers: { "Cache-Control": "max-age=0" },
          }),
        );
      }
      return Promise.resolve(new Response("new"));
    },
  });
  await loader(url());
  now++;
  await loader(url());
  assertEquals(calls[3].url, "https://a.example/same");
  assertEquals(calls[3].headers.get("If-None-Match"), "old");
  assertEquals(calls[3].headers.get("If-Modified-Since"), "yesterday");
  now++;
  await loader(url());
  assertEquals(calls[5].url, "https://a.example/changed");
  assertEquals(calls[5].headers.get("If-None-Match"), null);
  assertEquals(calls[5].headers.get("If-Modified-Since"), null);
});

Deno.test("304 replaces cache metadata and failed revalidation does not serve stale", async () => {
  let now = 0;
  let calls = 0;
  const loader = createUpstreamLoader(
    resolveOptions({ upstreamCacheTtlMs: 10_000 }),
    {
      now: () => now,
      resolver: publicResolver,
      fetchImpl: (_input, init) => {
        calls++;
        if (calls === 1) {
          return Promise.resolve(
            new Response("old", {
              headers: {
                "Cache-Control": "max-age=0",
                ETag: "old",
                "Last-Modified": "old-time",
              },
            }),
          );
        }
        if (calls === 2) {
          assertEquals(new Headers(init?.headers).get("If-None-Match"), "old");
          return Promise.resolve(
            new Response(null, {
              status: 304,
              headers: {
                "Cache-Control": "max-age=10",
                ETag: "new",
                "Last-Modified": "new-time",
                Date: "now",
                Age: "2",
              },
            }),
          );
        }
        if (calls === 3) {
          const headers = new Headers(init?.headers);
          assertEquals(headers.get("If-None-Match"), "new");
          assertEquals(headers.get("If-Modified-Since"), "new-time");
          return Promise.resolve(
            new Response(null, { status: 500 }),
          );
        }
        return Promise.resolve(new Response("unused"));
      },
    },
  );
  assertEquals(decoder.decode((await loader(url())).body), "old");
  now = 1;
  assertEquals(decoder.decode((await loader(url())).body), "old");
  now = 8_000;
  await loader(url());
  assertEquals(calls, 2);
  now = 8_001;
  await assertFailure(() => loader(url()), 502);
  assertEquals(calls, 3);
});

Deno.test("cache directives determine freshness", async () => {
  for (
    const [cacheControl, age, expectedCalls] of [
      ["no-cache", undefined, 2],
      ['no-cache="set-cookie, x-other"', undefined, 2],
      ["max-age=0", undefined, 2],
      ["max-age=1, s-maxage=10", undefined, 1],
      ["max-age=broken, s-maxage=1=2", undefined, 1],
      ["max-age=10", "9", 2],
      [undefined, "4", 2],
      [undefined, "999999999999999999999999999999", 2],
    ] as const
  ) {
    let now = 0;
    let calls = 0;
    const loader = createUpstreamLoader(
      resolveOptions({ upstreamCacheTtlMs: 5_000 }),
      {
        now: () => now,
        resolver: publicResolver,
        fetchImpl: () => {
          calls++;
          return Promise.resolve(
            new Response("ok", {
              headers: {
                ...(cacheControl === undefined
                  ? {}
                  : { "Cache-Control": cacheControl }),
                ...(age === undefined ? {} : { Age: age }),
              },
            }),
          );
        },
      },
    );
    await loader(url());
    now = 1_001;
    await loader(url());
    assertEquals(calls, expectedCalls, cacheControl ?? "default ceiling");
  }
  let now = 0;
  let calls = 0;
  const ceiling = createUpstreamLoader(
    resolveOptions({ upstreamCacheTtlMs: 5_000 }),
    {
      now: () => now,
      resolver: publicResolver,
      fetchImpl: () => {
        calls++;
        return Promise.resolve(new Response("ok"));
      },
    },
  );
  await ceiling(url());
  now = 5_001;
  await ceiling(url());
  assertEquals(calls, 2);
});

Deno.test("no-store and private responses remove cache entries and coalesce active loads", async () => {
  for (const directive of ["no-store", "private", 'private="set-cookie, x"']) {
    let now = 0;
    let calls = 0;
    let resolveResponse: ((response: Response) => void) | undefined;
    const loader = createUpstreamLoader(resolveOptions(undefined), {
      now: () => now,
      resolver: publicResolver,
      fetchImpl: () => {
        calls++;
        if (calls === 1) {
          return Promise.resolve(
            new Response("cached", {
              headers: { "Cache-Control": "max-age=0" },
            }),
          );
        }
        if (calls === 2) {
          return new Promise<Response>((resolve) => resolveResponse = resolve);
        }
        return Promise.resolve(new Response("fresh"));
      },
    });
    await loader(url());
    now++;
    const first = loader(url());
    const second = loader(url());
    while (resolveResponse === undefined) await Promise.resolve();
    if (resolveResponse === undefined) throw new Error("Fetch did not start");
    resolveResponse(
      new Response("uncached", { headers: { "Cache-Control": directive } }),
    );
    await Promise.all([first, second]);
    await loader(url());
    assertEquals(calls, 3, directive);
  }
});

Deno.test("no-store and private 304 responses remove cached entries", async () => {
  for (const directive of ["no-store", "private", 'private="set-cookie, x"']) {
    let now = 0;
    let calls = 0;
    const loader = createUpstreamLoader(resolveOptions(undefined), {
      now: () => now,
      resolver: publicResolver,
      fetchImpl: () => {
        calls++;
        if (calls === 1) {
          return Promise.resolve(
            new Response("old", {
              headers: { "Cache-Control": "max-age=0", ETag: "tag" },
            }),
          );
        }
        if (calls === 2) {
          return Promise.resolve(
            new Response(null, {
              status: 304,
              headers: { "Cache-Control": directive },
            }),
          );
        }
        return Promise.resolve(new Response("fresh"));
      },
    });
    await loader(url());
    now++;
    assertEquals(decoder.decode((await loader(url())).body), "old");
    await loader(url());
    assertEquals(calls, 3, directive);
  }
});

Deno.test("cache evicts the least recently used entries within its byte budget", async () => {
  const calls = new Map<string, number>();
  const loader = createUpstreamLoader(
    resolveOptions({ maxUpstreamCacheBytes: 2 }),
    {
      resolver: publicResolver,
      fetchImpl: (input) => {
        const key = String(input);
        calls.set(key, (calls.get(key) ?? 0) + 1);
        return Promise.resolve(
          new Response("x", { headers: { "Cache-Control": "max-age=10" } }),
        );
      },
    },
  );
  await loader(url("a"));
  await loader(url("b"));
  await loader(url("a"));
  await loader(url("c"));
  await loader(url("a"));
  await loader(url("b"));
  assertEquals([...calls.values()], [1, 2, 1]);
});

function responseWithCancellableBody(
  status: number,
  headers?: HeadersInit,
  text = "body",
): { response: Response; cancelled: () => boolean } {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
    },
    cancel() {
      cancelled = true;
    },
  });
  return {
    response: new Response(body, { status, headers }),
    cancelled: () => cancelled,
  };
}

async function assertFailure(
  action: () => Promise<unknown>,
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
