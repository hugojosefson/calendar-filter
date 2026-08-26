/** @module Deno server wrapper. */

import { createCalendarFilterHandler } from "../http/handler.ts";
import type { CalendarFilterOptions } from "./options.ts";

/** Deno TCP server options forwarded without modification. */
export type CalendarFilterServerOptions = Deno.ServeTcpOptions;

/** Options for creating a Deno server and its calendar-filter handler. */
export type ServeCalendarFilterOptions = {
  serverOptions?: CalendarFilterServerOptions;
  filterOptions?: CalendarFilterOptions;
};

/** Starts a Deno HTTP server with a fresh handler, loader, and cache. */
export function serveCalendarFilter(
  options: ServeCalendarFilterOptions = {},
): Deno.HttpServer<Deno.NetAddr> {
  return Deno.serve(
    options.serverOptions ?? {},
    createCalendarFilterHandler(options.filterOptions),
  );
}
