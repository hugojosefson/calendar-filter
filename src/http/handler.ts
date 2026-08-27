/** @module Top-level HTTP route dispatch for calendar-filter. */

import { ApiError, apiErrorResponse } from "./api-error.ts";
import { createBuilderRouteHandler } from "../builder/route.ts";
import { createWebcalHandler } from "./webcal-handler.ts";
import {
  type CalendarFilterOptions,
  resolveOptions,
} from "../server/options.ts";
import { createUpstreamLoader } from "../upstream/loader.ts";
import { assertRequestUrlLength } from "./request.ts";

/** Creates an isolated request handler with one shared upstream loader and cache. */
export function createCalendarFilterHandler(
  options?: CalendarFilterOptions,
): (request: Request) => Promise<Response> {
  const resolvedOptions = resolveOptions(options);
  const loadUpstream = createUpstreamLoader(resolvedOptions);
  const webcalHandler = createWebcalHandler(resolvedOptions, loadUpstream);
  const builderRouteHandler = createBuilderRouteHandler(webcalHandler);
  return async (request: Request): Promise<Response> => {
    const isHead = request.method === "HEAD";
    try {
      assertRequestUrlLength(request, resolvedOptions.maxRequestUrlBytes);
      const pathname = new URL(request.url).pathname;
      if (pathname === "/webcal") {
        return await webcalHandler(request);
      }
      return await builderRouteHandler(request);
    } catch (error) {
      if (error instanceof ApiError) {
        return apiErrorResponse(error, isHead);
      }
      return apiErrorResponse(
        new ApiError(500, "Internal server error"),
        isHead,
      );
    }
  };
}

/** Default handler configured with the package defaults. */
export const calendarFilterHandler: (request: Request) => Promise<Response> =
  createCalendarFilterHandler();
