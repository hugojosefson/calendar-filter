import { createCalendarFilterHandler } from "./handler.ts";
import type { CalendarFilterOptions } from "./options.ts";

export type CalendarFilterServerOptions = Deno.ServeTcpOptions;

export type ServeCalendarFilterOptions = {
  serverOptions?: CalendarFilterServerOptions;
  filterOptions?: CalendarFilterOptions;
};

export function serveCalendarFilter(
  options: ServeCalendarFilterOptions = {},
): Deno.HttpServer<Deno.NetAddr> {
  return Deno.serve(
    options.serverOptions ?? {},
    createCalendarFilterHandler(options.filterOptions),
  );
}
