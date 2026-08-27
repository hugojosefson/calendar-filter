/** @module Side-effectful default server entrypoint. */

import { serveCalendarFilter } from "./server.ts";

/** Default server started when the package's `./serve` export is imported. */
export const calendarFilterServer: Deno.HttpServer<Deno.NetAddr> =
  serveCalendarFilter();
