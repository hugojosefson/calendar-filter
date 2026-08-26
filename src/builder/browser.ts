/** @module Progressive builder enhancement and local CodeMirror RE2 editing. */

import { EditorState } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { RE2JS } from "re2js";

/** Browser-history behavior for one server-backed update. */
type NavigationKind = "push" | "replace";

/** Name and caret needed to restore one native or CodeMirror field. */
type FocusState = {
  name: string;
  caret: number;
};

let controller: AbortController | undefined;
let timer: number | undefined;
let replacing = false;
const editors = new WeakMap<HTMLInputElement, EditorView>();

/** Installs event delegation again after every server-rendered main replacement. */
function enhance(): void {
  for (
    const input of document.querySelectorAll<HTMLInputElement>(
      "input[data-regex]",
    )
  ) {
    installRegexEditor(input);
  }
  const main = document.querySelector("main");
  main?.addEventListener("submit", submit);
  main?.addEventListener("input", input);
  main?.addEventListener("change", change);
  main?.addEventListener("keydown", keydown);
  main?.addEventListener("focusout", blur);
}

/** Serializes a form plus clicked submitter and follows its canonical redirect. */
async function navigate(
  form: HTMLFormElement,
  submitter: HTMLElement | null,
  kind: NavigationKind,
): Promise<void> {
  globalThis.clearTimeout(timer);
  const data = new FormData(form);
  if (submitter instanceof HTMLButtonElement && submitter.name) {
    data.set(submitter.name, submitter.value);
  }
  const url = new URL(form.action, location.href);
  url.search = new URLSearchParams(
    [...data].filter((entry): entry is [string, string] =>
      typeof entry[1] === "string"
    ),
  ).toString();

  controller?.abort();
  const navigationController = new AbortController();
  controller = navigationController;
  const focus = activeFocus();
  try {
    const response = await fetch(url, {
      signal: navigationController.signal,
      redirect: "follow",
    });
    const parsed = new DOMParser().parseFromString(
      await response.text(),
      "text/html",
    );
    if (navigationController.signal.aborted) {
      return;
    }
    const next = parsed.querySelector("main");
    const current = document.querySelector("main");
    if (!next || !current) {
      return;
    }
    history[kind === "push" ? "pushState" : "replaceState"](
      {},
      "",
      response.url,
    );
    replacing = true;
    try {
      current.replaceWith(next);
      enhance();
      restoreFocus(focus);
    } finally {
      replacing = false;
    }
  } catch (error) {
    if ((error as DOMException).name !== "AbortError") {
      console.error(error);
    }
  }
}

/** Delays navigation so a following click or change can supersede a blur. */
function scheduleNavigation(
  form: HTMLFormElement,
  kind: NavigationKind,
  delay: number,
): void {
  globalThis.clearTimeout(timer);
  timer = globalThis.setTimeout(() => navigate(form, null, kind), delay);
}

/** Handles normal submissions; ordinary Enter remains a neutral update. */
function submit(event: SubmitEvent): void {
  const form = event.target as HTMLFormElement;
  event.preventDefault();
  navigate(form, event.submitter as HTMLElement | null, "push");
}

/** Schedules text changes as replace navigation, including paste and IME input. */
function input(event: Event): void {
  const target = event.target as HTMLInputElement;
  if (!target.matches("input[data-editable]") || !target.validity.valid) {
    return;
  }
  scheduleNavigation(target.form!, "replace", 300);
}

/** Pushes structural controls immediately while editing remains replace-only. */
function change(event: Event): void {
  const target = event.target as HTMLElement;
  if (target.matches("select, input[type=checkbox]")) {
    navigate((target as HTMLInputElement).form!, null, "push");
  }
}

/** Keeps native Enter single-line and commits it as a neutral update. */
function keydown(event: KeyboardEvent): void {
  const target = event.target as HTMLInputElement;
  if (
    event.key === "Enter" && target.matches("input[data-editable]") &&
    target.validity.valid
  ) {
    event.preventDefault();
    navigate(target.form!, null, "push");
  }
}

/** Commits valid text fields after focus moves elsewhere. */
function blur(event: FocusEvent): void {
  const target = event.target as HTMLInputElement;
  if (
    !replacing && target.matches("input[data-editable]") &&
    target.validity.valid
  ) {
    scheduleNavigation(target.form!, "replace", 0);
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
  input.setSelectionRange(focus.caret, focus.caret);
}

/** Compiles with server RE2 flags; accepted `u` has no RE2JS option bit. */
function valid(source: string, flags: string): boolean {
  try {
    let options = 0;
    if (flags.includes("i")) {
      options |= RE2JS.CASE_INSENSITIVE;
    }
    if (flags.includes("m")) {
      options |= RE2JS.MULTILINE;
    }
    if (flags.includes("s")) {
      options |= RE2JS.DOTALL;
    }
    RE2JS.compile(source, options);
    return true;
  } catch {
    return false;
  }
}

/** Produces lightweight RE2 token decorations without changing the expression. */
function regexDecorations(view: EditorView): DecorationSet {
  const source = view.state.doc.toString();
  const decorations = [];
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (character === "\\") {
      const end = Math.min(index + 2, source.length);
      decorations.push(
        Decoration.mark({ class: "cm-re2-escape" }).range(index, end),
      );
      index = end - 1;
      continue;
    }
    if (character === "[") {
      let end = index + 1;
      while (end < source.length) {
        if (source[end] === "\\") {
          end += 2;
          continue;
        }
        end++;
        if (source[end - 1] === "]") {
          break;
        }
      }
      decorations.push(
        Decoration.mark({ class: "cm-re2-class" }).range(index, end),
      );
      index = end - 1;
      continue;
    }
    if (character === "(" || character === ")") {
      decorations.push(
        Decoration.mark({ class: "cm-re2-group" }).range(index, index + 1),
      );
      continue;
    }
    if (character === "*" || character === "+" || character === "?") {
      decorations.push(
        Decoration.mark({ class: "cm-re2-quantifier" }).range(
          index,
          index + 1,
        ),
      );
      continue;
    }
    if (character === "{") {
      const match = source.slice(index).match(/^\{\d+(?:,\d*)?\}\??/);
      if (match) {
        decorations.push(
          Decoration.mark({ class: "cm-re2-quantifier" }).range(
            index,
            index + match[0].length,
          ),
        );
        index += match[0].length - 1;
      }
      continue;
    }
    if ("^$|.".includes(character)) {
      decorations.push(
        Decoration.mark({ class: "cm-re2-operator" }).range(index, index + 1),
      );
    }
  }
  return Decoration.set(decorations, true);
}

/** Recomputes RE2 token highlighting after document changes. */
const regexHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = regexDecorations(view);
    }

    update(update: ViewUpdate): void {
      if (update.docChanged) {
        this.decorations = regexDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/** Replaces a regex input while keeping its native form value synchronized. */
function installRegexEditor(input: HTMLInputElement): void {
  input.hidden = true;
  const setValidity = (okay: boolean): void => {
    input.setAttribute("aria-invalid", String(!okay));
    view.dom.setAttribute("aria-invalid", String(!okay));
    view.dom.classList.toggle("cm-invalid", !okay);
    const error = input.parentElement?.querySelector<HTMLElement>(
      "[data-regex-error]",
    );
    if (error) {
      error.hidden = okay;
    }
  };
  const update = (value: string): void => {
    input.value = value;
    input.setSelectionRange(value.length, value.length);
    setValidity(valid(value, selectedFlags(input)));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const view = new EditorView({
    state: EditorState.create({
      doc: input.value,
      extensions: [
        regexHighlight,
        EditorView.contentAttributes.of({ "aria-label": "Pattern" }),
        EditorView.domEventHandlers({
          blur: () => {
            if (!replacing) {
              scheduleNavigation(input.form!, "replace", 0);
            }
          },
        }),
        keymap.of([{
          key: "Enter",
          run: () => {
            navigate(input.form!, null, "push");
            return true;
          },
        }]),
        EditorView.updateListener.of((change) => {
          if (change.docChanged) {
            update(change.state.doc.toString());
          }
        }),
      ],
    }),
    parent: input.parentElement!,
  });
  editors.set(input, view);
  view.dom.classList.add("cm-re2");
  setValidity(valid(input.value, selectedFlags(input)));
}

/** Returns selected flag characters for the rule containing one pattern. */
function selectedFlags(input: HTMLInputElement): string {
  return [
    ...input.form!.querySelectorAll<HTMLInputElement>(
      `input[name^="${input.name.replace(/pattern$/, "flag-")}"]:checked`,
    ),
  ].map((field) => field.name.at(-1)).join("");
}

/** Reloads server-rendered state when the user traverses browser history. */
globalThis.addEventListener("popstate", async () => {
  controller?.abort();
  const navigationController = new AbortController();
  controller = navigationController;
  try {
    const response = await fetch(location.href, {
      signal: navigationController.signal,
    });
    const parsed = new DOMParser().parseFromString(
      await response.text(),
      "text/html",
    );
    if (navigationController.signal.aborted) {
      return;
    }
    const next = parsed.querySelector("main");
    const current = document.querySelector("main");
    if (!next || !current) {
      return;
    }
    replacing = true;
    try {
      current.replaceWith(next);
      enhance();
    } finally {
      replacing = false;
    }
  } catch (error) {
    if ((error as DOMException).name !== "AbortError") {
      console.error(error);
    }
  }
});

enhance();
