import { ApiError, apiErrorResponse } from "./api-error.ts";
import { builderCss } from "./builder.css.ts";
import { applyBuilderOperation, builderStateFromForm } from "./builder-form.ts";
import {
  decodeBuilderQuery,
  encodeBuilderQuery,
  parseResultUrl,
} from "./builder-codec.ts";
import { renderBuilderPage } from "./builder-page.ts";
import { etagFor, ifNoneMatchMatches } from "./conditional.ts";
import { IcsError } from "./ics-error.ts";
import { filterCalendar } from "./ics-filter.ts";
import { type CalendarFilterOptions, resolveOptions } from "./options.ts";
import { previewEvents } from "./preview-events.ts";
import { assertRequestUrlLength, parseRequest } from "./request.ts";
import { UpstreamError } from "./upstream-error.ts";
import { createUpstreamLoader } from "./upstream-loader.ts";

export function createCalendarFilterHandler(
  options?: CalendarFilterOptions,
): (request: Request) => Promise<Response> {
  const resolvedOptions = resolveOptions(options);
  const loadUpstream = createUpstreamLoader(resolvedOptions);
  const webcalHandler = createWebcalHandler(resolvedOptions, loadUpstream);
  return async (request: Request): Promise<Response> => {
    const isHead = request.method === "HEAD";
    try {
      assertRequestUrlLength(request, resolvedOptions.maxRequestUrlBytes);
      const url = new URL(request.url);
      if (url.pathname === "/webcal") {
        return await webcalHandler(request);
      }
      if (url.pathname === "/builder.css") {
        return pageMethod(request, () => cssResponse(isHead));
      }
      if (url.pathname === "/") {
        return await pageMethod(
          request,
          () => rootResponse(request, webcalHandler, isHead),
        );
      }
      if (url.pathname === "/build") {
        return pageMethod(request, () => buildResponse(request));
      }
      if (url.pathname === "/build-url") {
        return pageMethod(request, () => buildUrlResponse(request));
      }
      throw new ApiError(404, "Not found");
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

function createWebcalHandler(
  options: ReturnType<typeof resolveOptions>,
  loadUpstream: ReturnType<typeof createUpstreamLoader>,
): (request: Request) => Promise<Response> {
  return async (request) => {
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

async function rootResponse(
  request: Request,
  webcalHandler: (request: Request) => Promise<Response>,
  isHead: boolean,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.search === "") {
    return pageResponse(
      renderBuilderPage(url, decodeBuilderQuery(new URLSearchParams())),
      isHead,
    );
  }
  const state = decodeBuilderQuery(url.searchParams);
  const filtered = await webcalHandler(webcalRequest(url, url.searchParams));
  let preview: {
    kept: number;
    total: number;
    events: ReturnType<typeof previewEvents>["events"];
    error?: string;
  };
  if (!filtered.ok) {
    preview = {
      kept: 0,
      total: 0,
      events: [],
      error: await responseError(filtered),
    };
  } else {
    const parsed = previewEvents(await filtered.text());
    const total = await webcalHandler(
      webcalRequest(
        url,
        new URLSearchParams([["input", state.input], ["include", ""]]),
      ),
    );
    preview = total.ok
      ? {
        ...parsed,
        total: previewEvents(await total.text()).count,
        kept: parsed.count,
      }
      : {
        ...parsed,
        total: 0,
        kept: parsed.count,
        error: await responseError(total),
      };
  }
  return pageResponse(renderBuilderPage(url, state, preview), isHead);
}

function webcalRequest(base: URL, search: URLSearchParams): Request {
  const url = new URL(base);
  url.pathname = "/webcal";
  url.search = search.toString();
  return new Request(url);
}

function buildResponse(request: Request): Response {
  const url = new URL(request.url);
  const state = applyBuilderOperation(
    builderStateFromForm(url.searchParams),
    url.searchParams.get("operation"),
  );
  return redirectRoot(url, encodeBuilderQuery(state));
}

function buildUrlResponse(request: Request): Response {
  const url = new URL(request.url);
  const state = parseResultUrl(url.searchParams.get("url") ?? "");
  return redirectRoot(url, encodeBuilderQuery(state));
}

function redirectRoot(base: URL, query: URLSearchParams): Response {
  const url = new URL(base);
  url.pathname = "/";
  url.search = query.toString();
  return new Response(null, {
    status: 303,
    headers: {
      ...Object.fromEntries(pageHeaders("text/html; charset=utf-8")),
      Location: url.pathname + url.search,
    },
  });
}

function pageMethod(
  request: Request,
  response: () => Response | Promise<Response>,
): Response | Promise<Response> {
  if (request.method === "GET" || request.method === "HEAD") {
    return response();
  }
  return new Response(null, {
    status: 405,
    headers: {
      ...Object.fromEntries(pageHeaders("text/html; charset=utf-8")),
      Allow: "GET, HEAD",
    },
  });
}

function pageResponse(body: string, isHead: boolean): Response {
  return new Response(isHead ? null : body, {
    headers: pageHeaders("text/html; charset=utf-8"),
  });
}

function cssResponse(isHead: boolean): Response {
  return new Response(isHead ? null : builderCss, {
    headers: pageHeaders("text/css; charset=utf-8"),
  });
}

function pageHeaders(contentType: string): Headers {
  return new Headers({
    "Cache-Control": "no-store",
    "Content-Security-Policy":
      "default-src 'none'; style-src 'self' https://cdn.jsdelivr.net; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    "Content-Type": contentType,
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-Robots-Tag": "noindex",
  });
}

async function responseError(response: Response): Promise<string> {
  try {
    return (await response.json()).error ??
      `Preview failed (${response.status})`;
  } catch {
    return `Preview failed (${response.status})`;
  }
}

function webcalError(error: unknown, isHead: boolean): Response {
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

export const calendarFilterHandler: (request: Request) => Promise<Response> =
  createCalendarFilterHandler();

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
function calendarResponse(
  body: Uint8Array,
  etag: string,
  isHead: boolean,
): Response {
  return new Response(isHead ? null : Uint8Array.from(body), {
    headers: representationHeaders(etag),
  });
}
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
