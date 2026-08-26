/** @module Server-rendered builder page. */

import { buildResultUrl } from "./codec.ts";
import { canCompile } from "./text.ts";
import type { BuilderRule, BuilderState } from "./types.ts";
import type { PreviewEvent } from "./preview-events.ts";

const docs = "https://github.com/hugojosefson/calendar-filter/tree/main/docs";
const guide =
  "https://github.com/hugojosefson/calendar-filter/blob/main/docs/guide.md";

/** Renders escaped builder state and optional preview into a complete HTML document. */
export function renderBuilderPage(
  base: URL,
  state: BuilderState,
  preview?: {
    kept: number;
    total: number;
    events: PreviewEvent[];
    error?: string;
  },
): string {
  const result = buildResultUrl(base, state).href.replace(
    /^https?:/,
    "webcal:",
  );
  return `<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Calendar filter</title><link rel=stylesheet href="https://cdn.jsdelivr.net/npm/@picocss/pico@2.1.1/css/pico.min.css"><link rel=stylesheet href=/builder.css></head><body><main class=container><h1>Calendar filter builder</h1><p>Build a filtered calendar URL. <a href="${docs}">Documentation</a></p>${
    builderForm(state)
  }<hr><form method=get action=/build-url><label>Result URL<input name=url type=url value="${
    escape(result)
  }"></label><button>Load URL</button></form>${
    preview === undefined ? "" : renderPreview(preview)
  }</main></body></html>`;
}

/** Renders the editable filter form for one builder state. */
function builderForm(state: BuilderState): string {
  return `<form method=get action=/build><button class=implicit-submit tabindex=-1 aria-hidden=true>Update preview</button>${
    diagnostics(state)
  }<label>Calendar URL<input name=input type=url value="${
    escape(state.input)
  }"></label><label>Calendar name (optional)<input name=calendar-name value="${
    escape(state.calendarName ?? "")
  }"></label><input type=hidden name=rule-count value="${state.rules.length}"><fieldset><legend>Filters</legend><p><small>Rules match event summaries, descriptions, and locations. See the <a href="${guide}">filter guide</a> and <a href="https://github.com/google/re2/wiki/Syntax">RE2 syntax</a>.</small></p>${
    state.rules.map(renderRule).join("")
  }<div class=actions><button name=operation value=add-text>Add include text filter</button><button name=operation value=add-exclude-text>Add exclude text filter</button><button name=operation value=add-all>Add catch-all include</button></div></fieldset><button>Update preview</button></form>`;
}

/** Renders validation diagnostics as escaped list items. */
function diagnostics(state: BuilderState): string {
  if (state.diagnostics.length === 0) {
    return "";
  }
  return `<ul class=error>${
    state.diagnostics.map((diagnostic) =>
      `<li>${escape(diagnostic.message)}</li>`
    ).join("")
  }</ul>`;
}

/** Renders one catch-all or pattern rule and its controls. */
function renderRule(rule: BuilderRule, index: number): string {
  const prefix = `rule-${index}-`;
  if (rule.kind === "all") {
    return `<section class=rule><input type=hidden name=${prefix}kind value=all><p>Catch-all include</p>${
      actions(index)
    }</section>`;
  }
  const regex = rule.mode === "regex";
  const invalid = regex && !canCompile(rule.pattern, rule.flags);
  const flags = (flag: string) => rule.flags.includes(flag) ? " checked" : "";
  const disabled = regex && !rule.canConvertToText ? " disabled" : "";
  const extraFlags = regex
    ? ["m", "s", "u"].map((flag) => flagCheck(prefix, flag, flags(flag))).join(
      "",
    )
    : "";
  return `<section class=rule><input type=hidden name=${prefix}original-mode value=${rule.mode}><label>Action<select name=${prefix}action><option value=include${
    rule.action === "include" ? " selected" : ""
  }>Include</option><option value=exclude${
    rule.action === "exclude" ? " selected" : ""
  }>Exclude</option></select></label><label>Pattern<input name=${prefix}pattern value="${
    escape(rule.pattern)
  }"${invalid ? ' aria-invalid="true"' : ""}>${
    invalid ? "<small class=error>Invalid RE2 expression</small>" : ""
  }</label><label><input type=checkbox role=switch name=${prefix}mode value=regex${
    regex ? " checked" : ""
  }${disabled}> Regular expression</label><fieldset><legend>Flags</legend>${
    flagCheck(prefix, "i", flags("i"))
  }${extraFlags}</fieldset>${actions(index)}</section>`;
}

/** Renders one regex flag checkbox. */
function flagCheck(prefix: string, flag: string, checked: string): string {
  return `<label><input type=checkbox name=${prefix}flag-${flag}${checked}> ${flag}</label>`;
}

/** Renders movement and removal controls for one rule. */
function actions(index: number): string {
  return `<div class=actions><button name=operation value=up-${index}>Move up</button><button name=operation value=down-${index}>Move down</button><button name=operation value=remove-${index}>Remove</button></div>`;
}

/** Renders event counts and safe preview fields. */
function renderPreview(preview: {
  kept: number;
  total: number;
  events: PreviewEvent[];
  error?: string;
}): string {
  if (preview.error !== undefined) {
    return `<section><h2>Preview</h2><p class=error>${
      escape(preview.error)
    }</p></section>`;
  }
  const cards = preview.events.map((event) =>
    `<article class=event><strong>${escape(event.summary)}</strong><br>${
      escape(event.start)
    }<br>${escape(event.location)}</article>`
  ).join("");
  return `<section><h2>Preview</h2><p>${preview.kept} of ${preview.total} events kept</p>${cards}</section>`;
}

/** Escapes all text interpolated into HTML text and quoted attributes. */
function escape(value: string): string {
  return value.replace(/[&<>"']/g, (character) =>
    ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[character] ?? character);
}
