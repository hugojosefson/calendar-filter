/** @module Server-rendered builder page. */

import { buildResultUrl } from "./codec.ts";
import { escapeHtml } from "./html.ts";
import type { PreviewEvent } from "./preview-events.ts";
import { renderRules } from "./rules-page.ts";
import type { BuilderState } from "./types.ts";

const docs = "https://github.com/hugojosefson/calendar-filter/tree/main/docs";

/** Optional preview and source metadata rendered with the builder. */
type BuilderPreview = {
  kept: number;
  total: number;
  events: PreviewEvent[];
  calendarName?: string;
  error?: string;
};

/** Renders escaped builder state and optional preview into a complete HTML document. */
export function renderBuilderPage(
  base: URL,
  state: BuilderState,
  preview?: BuilderPreview,
): string {
  const result = buildResultUrl(base, state).href.replace(
    /^https?:/,
    "webcal:",
  );
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Calendar filter</title>
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E">
    <link rel="stylesheet" href="/builder.css">
    <script type="module" src="/builder.js"></script>
  </head>
  <body>
    <main class="container" data-builder-main>
      <h1>Calendar filter builder</h1>
      <p>
        Build a filtered calendar URL.
        <a href="${docs}">Documentation</a>
      </p>
      ${builderForm(state, preview?.calendarName)}
      <hr>
      ${resultForm(result)}
      ${preview === undefined ? "" : renderPreview(preview)}
    </main>
  </body>
</html>
`;
}

/** Renders source settings and native ordered-rule controls. */
function builderForm(state: BuilderState, sourceCalendarName?: string): string {
  return `<form method="get" action="/build" data-builder>
        <button
          class="implicit-submit"
          tabindex="-1"
          aria-hidden="true"
          data-manual-update
        >Update preview</button>
        ${diagnostics(state)}
        <div class="builder-settings">
          <label>
            Source calendar URL (input)
            <input
              name="input"
              type="url"
              value="${escapeHtml(state.input)}"
              placeholder="https://example.com/calendar.ics"
              data-editable
            >
            <small>The calendar to load before these rules run.</small>
          </label>
          <label>
            Override calendar name (optional)
            <input
              name="calendar-name"
              data-editable
              value="${escapeHtml(state.calendarName ?? "")}"${
    sourceCalendarName === undefined ? "" : `
              placeholder="${escapeHtml(sourceCalendarName)}"`
  }
            >
            <small>Changes the name subscribers see. Leave blank to keep the source name.</small>
          </label>
        </div>
        ${renderRules(state.rules)}
        <button data-manual-update>Update preview</button>
      </form>`;
}

/** Renders the generated subscription URL form. */
function resultForm(result: string): string {
  return `<form method="get" action="/build-url" data-result-url>
        <label>
          Filtered calendar subscription URL
          <input
            name="url"
            type="url"
            value="${escapeHtml(result)}"
            data-editable
          >
          <small>Copy this URL into your calendar app, or paste another filtered URL here to edit it.</small>
        </label>
        <button>Load URL</button>
      </form>`;
}

/** Renders validation diagnostics as escaped list items. */
function diagnostics(state: BuilderState): string {
  if (state.diagnostics.length === 0) {
    return "";
  }
  return `<ul class="error">
          ${
    state.diagnostics.map((diagnostic) =>
      `          <li>${escapeHtml(diagnostic.message)}</li>`
    ).join("\n")
  }
        </ul>`;
}

/** Renders event counts and safe preview fields. */
function renderPreview(preview: BuilderPreview): string {
  if (preview.error !== undefined) {
    return `<section class="preview">
        <h2>Preview</h2>
        <p class="error">${escapeHtml(preview.error)}</p>
      </section>`;
  }
  const cards = preview.events.map((event) =>
    `<article class="event">
          <strong>${escapeHtml(event.summary)}</strong><br>
          ${escapeHtml(event.start)}<br>
          ${escapeHtml(event.location)}
        </article>`
  ).join("\n");
  return `<section class="preview">
        <h2>Preview</h2>
        <p>${preview.kept} of ${preview.total} events kept</p>
        ${cards}
      </section>`;
}
