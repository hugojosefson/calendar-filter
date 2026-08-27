/** @module `/webcal` responses, filtering, and API error mapping. */

import { ApiError, apiErrorResponse } from "./api-error.ts";
import { etagFor, ifNoneMatchMatches } from "./conditional.ts";
import { IcsError } from "../calendar/error.ts";
import { filterCalendar } from "../calendar/filter.ts";
import { parseRequest } from "./request.ts";
import type { ResolvedCalendarFilterOptions } from "../server/options.ts";
import { UpstreamError } from "../upstream/error.ts";
import type { UpstreamBody } from "../upstream/loader.ts";

/** Request handler dependency used by routes that need filtered calendar bytes. */
export type WebcalHandler = (request: Request) => Promise<Response>;

/** Handles one `/webcal` request using the supplied shared upstream loader. */
export function createWebcalHandler(
  options: ResolvedCalendarFilterOptions,
  loadUpstream: (url: URL) => Promise<UpstreamBody>,
): WebcalHandler {
  return async (request: Request): Promise<Response> => {
    const isHead = request.method === "HEAD";
    try {
      if (request.method === "OPTIONS") {
        return optionsResponse();
      }
      if (request.method !== "GET" && !isHead) {
        throw new ApiError(405, "Method not allowed");
      }
      const parsed = parseRequest(request, options);
      const upstream = await loadUpstream(parsed.inputUrl);
      const body = filterCalendar(
        upstream.body,
        parsed.rules,
        parsed.calendarName,
      );
      const etag = await etagFor(body);
      if (ifNoneMatchMatches(request.headers.get("If-None-Match"), etag)) {
        return notModifiedResponse(etag);
      }
      return calendarResponse(body, etag, isHead);
    } catch (error) {
      return webcalError(error, isHead);
    }
  };
}

/** Converts known parsing, upstream, and calendar failures into API responses. */
export function webcalError(error: unknown, isHead: boolean): Response {
  if (error instanceof ApiError) {
    return apiErrorResponse(error, isHead);
  }
  if (error instanceof UpstreamError) {
    return apiErrorResponse(new ApiError(error.status, error.message), isHead);
  }
  if (error instanceof IcsError) {
    return apiErrorResponse(new ApiError(502, error.message), isHead);
  }
  return apiErrorResponse(new ApiError(500, "Internal server error"), isHead);
}

/** Responds to CORS preflight requests without loading an upstream. */
function optionsResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Headers": "If-None-Match",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers": "ETag, Content-Disposition",
    },
  });
}

/** Returns the filtered calendar with its stable strong ETag. */
function calendarResponse(
  body: Uint8Array,
  etag: string,
  isHead: boolean,
): Response {
  return new Response(isHead ? null : Uint8Array.from(body), {
    headers: representationHeaders(etag),
  });
}

/** Returns a conditional-request response without a representation body. */
function notModifiedResponse(etag: string): Response {
  return new Response(null, {
    status: 304,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers": "ETag, Content-Disposition",
      "Cache-Control": "no-cache",
      ETag: etag,
    },
  });
}

/** Sets headers shared by successful calendar representations. */
function representationHeaders(etag: string): Headers {
  return new Headers({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": "ETag, Content-Disposition",
    "Cache-Control": "no-cache",
    "Content-Disposition": 'inline; filename="calendar.ics"',
    "Content-Type": "text/calendar; charset=utf-8",
    ETag: etag,
  });
}
