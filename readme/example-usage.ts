#!/usr/bin/env -S deno run --allow-net --allow-env
import { createCalendarFilterHandler } from "../mod.ts";

const port = Number(Deno.env.get("PORT") ?? 9000);
const handler = createCalendarFilterHandler({
  // The demo may fetch from localhost. Never enable this on a public server.
  allowPrivateUpstreams: true,
});

Deno.serve({ port }, handler);
console.log(`calendar-filter listening on http://localhost:${port}/webcal`);
