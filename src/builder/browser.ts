/** @module Progressive builder enhancement and local CodeMirror RE2 editing. */

import type { EditorView } from "@codemirror/view";
import { installRegexEditor } from "./browser/regex-editor.ts";
import { installRuleDragging } from "./browser/rule-drag.ts";
import { canonicalText } from "./text.ts";

/** Browser-history behavior for one server-backed update. */
type NavigationKind = "push" | "replace";

/** Optional form-data changes for one automatic navigation. */
type NavigationOptions = {
  operation?: string;
  preserveRegexNames?: readonly string[];
  verifies?: "preview" | "result-url";
};

/** Name and caret needed to restore one native or CodeMirror field. */
type FocusState = {
  name: string;
  caret: number;
};

let timer: number | undefined;
let scheduledNavigation = 0;
let navigation = 0;
let replacing = false;
let previewUpdatesVerified = false;
let resultUrlUpdatesVerified = false;
const editors = new WeakMap<HTMLInputElement, EditorView>();
const dirtyInputs = new WeakSet<HTMLInputElement>();

/** Installs event delegation again after every server-rendered main replacement. */
function enhance(): void {
  for (
    const input of document.querySelectorAll<HTMLInputElement>(
      "input[data-regex]",
    )
  ) {
    enhanceRegexEditor(input);
  }
  const main = document.querySelector<HTMLElement>("main");
  main?.addEventListener("submit", submit);
  main?.addEventListener("input", input);
  main?.addEventListener("change", change);
  main?.addEventListener("keydown", keydown);
  main?.addEventListener("focusout", blur);
  if (main) {
    for (
      const handle of main.querySelectorAll<HTMLElement>(
        "[data-drag-handle]",
      )
    ) {
      handle.hidden = false;
    }
    installRuleDragging(main, (form, source, destination) => {
      navigate(form, null, "push", {
        operation: `move-${source}-${destination}`,
        preserveRegexNames: regexInputNames(form),
        verifies: "preview",
      });
    });
  }
  if (previewUpdatesVerified) {
    for (const button of main?.querySelectorAll("[data-manual-update]") ?? []) {
      button.remove();
    }
  }
  if (resultUrlUpdatesVerified) {
    main?.querySelector("[data-manual-result-url]")?.remove();
  }
}

/** Serializes a form plus clicked submitter and follows its canonical redirect. */
async function navigate(
  form: HTMLFormElement,
  submitter: HTMLElement | null,
  kind: NavigationKind,
  options: NavigationOptions = {},
): Promise<void> {
  if (!currentForm(form)) {
    return;
  }
  cancelPendingNavigation();
  const currentNavigation = ++navigation;
  const data = new FormData(form);
  if (submitter instanceof HTMLButtonElement && submitter.name) {
    data.set(submitter.name, submitter.value);
  }
  if (options.operation !== undefined) {
    data.set("operation", options.operation);
  }
  preserveRegexModes(data, options.preserveRegexNames ?? []);
  const url = new URL(form.action, location.href);
  url.search = new URLSearchParams(
    [...data].filter((entry): entry is [string, string] =>
      typeof entry[1] === "string"
    ),
  ).toString();

  const focus = activeFocus();
  try {
    const response = await fetch(url, {
      redirect: "follow",
    });
    const next = await responseMain(response);
    if (currentNavigation !== navigation) {
      return;
    }
    const current = document.querySelector("main");
    if (!next || !current) {
      throw new Error("The response did not contain a builder page.");
    }
    history[kind === "push" ? "pushState" : "replaceState"](
      {},
      "",
      response.url,
    );
    if (options.verifies === "preview") {
      previewUpdatesVerified = true;
    }
    if (options.verifies === "result-url") {
      resultUrlUpdatesVerified = true;
    }
    replacing = true;
    try {
      current.replaceWith(next);
      enhance();
      restoreFocus(focus);
    } finally {
      replacing = false;
    }
  } catch {
    if (currentNavigation === navigation && currentForm(form)) {
      showNavigationError(form);
    }
  }
}

/** Delays navigation so a following click or change can supersede a blur. */
function scheduleNavigation(
  form: HTMLFormElement,
  kind: NavigationKind,
  delay: number,
  options: NavigationOptions = {},
): void {
  cancelPendingNavigation();
  const scheduled = ++scheduledNavigation;
  timer = globalThis.setTimeout(
    () => {
      if (scheduled !== scheduledNavigation || !currentForm(form)) {
        return;
      }
      navigate(form, null, kind, options);
    },
    delay,
  );
}

/** Cancels delayed work before navigation or history replaces the page. */
function cancelPendingNavigation(): void {
  globalThis.clearTimeout(timer);
  timer = undefined;
  scheduledNavigation++;
}

/** Accepts only forms belonging to the currently rendered page. */
function currentForm(form: HTMLFormElement): boolean {
  return form.isConnected &&
    form.closest("main") === document.querySelector("main");
}

/** Parses only successful HTML builder responses. */
async function responseMain(response: Response): Promise<HTMLElement> {
  if (
    !response.ok || !response.headers.get("content-type")?.includes("text/html")
  ) {
    throw new Error("The update did not return an HTML page.");
  }
  const main = new DOMParser().parseFromString(
    await response.text(),
    "text/html",
  ).querySelector<HTMLElement>("main");
  if (!main) {
    throw new Error("The response did not contain a builder page.");
  }
  return main;
}

/** Shows a local retry message and restores native submit controls. */
function showNavigationError(container: Element): void {
  const error =
    container.querySelector<HTMLElement>("[data-navigation-error]") ??
      document.createElement("p");
  error.dataset.navigationError = "";
  error.className = "error";
  error.setAttribute("role", "alert");
  error.textContent =
    "Could not update this page. Use the manual button to retry.";
  if (!error.isConnected) {
    container.append(error);
  }
  for (
    const form of container.matches("form")
      ? [container]
      : container.querySelectorAll("form")
  ) {
    const resultUrl = form.matches("[data-result-url]");
    const selector = resultUrl
      ? "button[data-manual-result-url]"
      : "button[data-manual-update]:not(.implicit-submit)";
    if (form.querySelector(selector)) {
      continue;
    }
    const button = document.createElement("button");
    button.type = "submit";
    button.textContent = resultUrl ? "Load URL" : "Update preview";
    button.toggleAttribute("data-manual-result-url", resultUrl);
    button.toggleAttribute("data-manual-update", !resultUrl);
    form.append(button);
  }
}

/** Handles normal submissions; ordinary Enter remains a neutral update. */
function submit(event: SubmitEvent): void {
  const form = event.target as HTMLFormElement;
  const submitter = event.submitter as HTMLElement | null;
  event.preventDefault();
  navigate(form, submitter, "push", {
    verifies: form.matches("[data-builder]") &&
        submitter?.matches("button[name=operation]")
      ? "preview"
      : undefined,
  });
}

/** Schedules text changes as replace navigation, including paste and IME input. */
function input(event: Event): void {
  const target = event.target as HTMLInputElement;
  if (!target.matches("input[data-editable]") || !editableValid(target)) {
    return;
  }
  dirtyInputs.add(target);
  scheduleNavigation(target.form!, "replace", 300, {
    preserveRegexNames: target.matches("[data-regex]") ? [target.name] : [],
    verifies: verificationFor(target.form!),
  });
}

/** Keeps RE2 syntax errors local until the user explicitly submits them. */
function editableValid(input: HTMLInputElement): boolean {
  return input.validity.valid && input.getAttribute("aria-invalid") !== "true";
}

/** Keeps an automatically edited literal in regex mode across its URL reload. */
function preserveRegexModes(
  data: FormData,
  names: readonly string[],
): void {
  for (const name of names) {
    const source = data.get(name);
    if (typeof source !== "string") {
      continue;
    }
    const flagPrefix = name.replace(/pattern$/, "flag-");
    const flags = "imsu".split("").filter((flag) =>
      data.has(`${flagPrefix}${flag}`)
    ).join("");
    if (canonicalText(source, flags) !== undefined) {
      data.set(name, `(${source})`);
    }
  }
}

/** Returns all regex field names that one automatic reorder must preserve. */
function regexInputNames(form: HTMLFormElement): string[] {
  return [...form.querySelectorAll<HTMLInputElement>("input[data-regex]")].map(
    (input) => input.name,
  );
}

/** Identifies which native submit button one automatic text update replaces. */
function verificationFor(
  form: HTMLFormElement,
): "preview" | "result-url" {
  return form.matches("[data-result-url]") ? "result-url" : "preview";
}

/** Pushes structural controls immediately while editing remains replace-only. */
function change(event: Event): void {
  const target = event.target as HTMLElement;
  if (target.matches("select, input[type=checkbox]")) {
    const form = (target as HTMLInputElement).form!;
    navigate(form, null, "push", { verifies: verificationFor(form) });
  }
}

/** Keeps native Enter single-line and commits it as a neutral update. */
function keydown(event: KeyboardEvent): void {
  const target = event.target as HTMLInputElement;
  if (
    event.key === "Enter" && target.matches("input[data-editable]") &&
    editableValid(target)
  ) {
    event.preventDefault();
    navigate(target.form!, null, "push");
  }
}

/** Commits valid text fields after focus moves elsewhere. */
function blur(event: FocusEvent): void {
  const target = event.target as HTMLInputElement;
  if (
    !replacing && dirtyInputs.has(target) &&
    target.matches("input[data-editable]") &&
    editableValid(target)
  ) {
    scheduleNavigation(target.form!, "replace", 0, {
      verifies: verificationFor(target.form!),
    });
  }
}

/** Captures the active native field or its CodeMirror-backed input. */
function activeFocus(): FocusState | undefined {
  const active = document.activeElement as HTMLElement | null;
  const input = active instanceof HTMLInputElement
    ? active
    : active?.closest("label")?.querySelector<HTMLInputElement>(
      "input[data-regex]",
    );
  if (!input?.name) {
    return undefined;
  }
  const editor = editors.get(input);
  return {
    name: input.name,
    caret: editor?.state.selection.main.head ?? input.selectionStart ?? 0,
  };
}

/** Restores native or CodeMirror focus after replacing the rendered page. */
function restoreFocus(focus: FocusState | undefined): void {
  if (!focus) {
    return;
  }
  const input = document.querySelector<HTMLInputElement>(
    `[name="${CSS.escape(focus.name)}"]`,
  );
  if (!input) {
    return;
  }
  const editor = editors.get(input);
  if (editor) {
    const caret = Math.min(focus.caret, editor.state.doc.length);
    editor.dispatch({ selection: { anchor: caret } });
    editor.focus();
    return;
  }
  input.focus();
  if (input.selectionStart !== null) {
    input.setSelectionRange(focus.caret, focus.caret);
  }
}

/** Connects one regex editor to server navigation and focus restoration. */
function enhanceRegexEditor(input: HTMLInputElement): void {
  const view = installRegexEditor(input, {
    onBlur: () => {
      if (!replacing && dirtyInputs.has(input) && editableValid(input)) {
        scheduleNavigation(input.form!, "replace", 0, {
          preserveRegexNames: [input.name],
          verifies: "preview",
        });
      }
    },
    onEnter: () => navigate(input.form!, null, "push"),
  });
  editors.set(input, view);
}

/** Reloads server-rendered state when the user traverses browser history. */
globalThis.addEventListener("popstate", async () => {
  cancelPendingNavigation();
  const currentNavigation = ++navigation;
  try {
    const response = await fetch(location.href);
    const next = await responseMain(response);
    if (currentNavigation !== navigation) {
      return;
    }
    const current = document.querySelector("main");
    if (!next || !current) {
      throw new Error("The response did not contain a builder page.");
    }
    replacing = true;
    try {
      current.replaceWith(next);
      enhance();
    } finally {
      replacing = false;
    }
  } catch {
    if (currentNavigation === navigation) {
      const main = document.querySelector("main");
      if (main) {
        showNavigationError(main);
      }
    }
  }
});

enhance();
