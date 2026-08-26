/** @module Builder routes and secure page responses. */

import { builderCss } from "./styles.ts";
import { applyBuilderOperation, builderStateFromForm } from "./form.ts";
import {
  decodeBuilderQuery,
  encodeBuilderQuery,
  parseResultUrl,
} from "./codec.ts";
import { renderBuilderPage } from "./page.ts";
import { previewEvents } from "./preview-events.ts";
import { ApiError } from "../http/api-error.ts";
import type { WebcalHandler } from "../http/webcal-handler.ts";

/** Handles builder routes and reuses `/webcal` for preview filtering. */
export function createBuilderRouteHandler(
  webcalHandler: WebcalHandler,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const isHead = request.method === "HEAD";
    const pathname = new URL(request.url).pathname;
    if (pathname === "/builder.css") {
      return pageMethod(request, () => cssResponse(isHead));
    }
    if (pathname === "/") {
      return await pageMethod(
        request,
        () => rootResponse(request, webcalHandler, isHead),
      );
    }
    if (pathname === "/build") {
      return pageMethod(request, () => buildResponse(request));
    }
    if (pathname === "/build-url") {
      return pageMethod(request, () => buildUrlResponse(request));
    }
    throw new ApiError(404, "Not found");
  };
}

/** Renders the builder and requests both filtered and unfiltered previews. */
async function rootResponse(
  request: Request,
  webcalHandler: WebcalHandler,
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
  const preview = !filtered.ok
    ? { kept: 0, total: 0, events: [], error: await responseError(filtered) }
    : await successfulPreview(url, state.input, filtered, webcalHandler);
  return pageResponse(renderBuilderPage(url, state, preview), isHead);
}

/** Builds preview counts after the filtered request succeeds. */
async function successfulPreview(
  base: URL,
  input: string,
  filtered: Response,
  webcalHandler: WebcalHandler,
) {
  const parsed = previewEvents(await filtered.text());
  const total = await webcalHandler(
    webcalRequest(
      base,
      new URLSearchParams([["input", input], ["include", ""]]),
    ),
  );
  if (!total.ok) {
    return {
      ...parsed,
      total: 0,
      kept: parsed.count,
      error: await responseError(total),
    };
  }
  return {
    ...parsed,
    total: previewEvents(await total.text()).count,
    kept: parsed.count,
  };
}

/** Creates the internal request that preserves the shared loader and cache. */
function webcalRequest(base: URL, search: URLSearchParams): Request {
  const url = new URL(base);
  url.pathname = "/webcal";
  url.search = search.toString();
  return new Request(url);
}

/** Applies a submitted builder operation then redirects to its canonical query. */
function buildResponse(request: Request): Response {
  const url = new URL(request.url);
  const state = applyBuilderOperation(
    builderStateFromForm(url.searchParams),
    url.searchParams.get("operation"),
  );
  return redirectRoot(url, encodeBuilderQuery(state));
}

/** Imports a pasted result URL then redirects to the builder. */
function buildUrlResponse(request: Request): Response {
  const url = new URL(request.url);
  return redirectRoot(
    url,
    encodeBuilderQuery(parseResultUrl(url.searchParams.get("url") ?? "")),
  );
}

/** Redirects a builder action to the root page with encoded state. */
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

/** Restricts builder resources to safe page methods. */
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

/** Returns an HTML response while omitting its body for HEAD. */
function pageResponse(body: string, isHead: boolean): Response {
  return new Response(isHead ? null : body, {
    headers: pageHeaders("text/html; charset=utf-8"),
  });
}

/** Returns the builder stylesheet while omitting its body for HEAD. */
function cssResponse(isHead: boolean): Response {
  return new Response(isHead ? null : builderCss, {
    headers: pageHeaders("text/css; charset=utf-8"),
  });
}

/** Sets no-store and browser hardening headers for builder resources. */
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

/** Extracts the API error message without exposing non-JSON response bodies. */
async function responseError(response: Response): Promise<string> {
  try {
    return (await response.json()).error ??
      `Preview failed (${response.status})`;
  } catch {
    return `Preview failed (${response.status})`;
  }
}
