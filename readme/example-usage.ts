#!/usr/bin/env -S deno run --allow-net --allow-env
import { calendarFilterHandler } from "../mod.ts";

const port = Number(Deno.env.get("PORT") ?? 9000);
Deno.serve({ port }, calendarFilterHandler);
console.log(`calendar-filter listening on http://localhost:${port}/webcal`);
