import { serveCalendarFilter } from "./server.ts";

export const calendarFilterServer: Deno.HttpServer<Deno.NetAddr> =
  serveCalendarFilter();
