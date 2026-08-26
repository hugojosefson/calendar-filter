/** @module CodeMirror-backed RE2 field editing for the builder. */

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
import { explainRegex } from "../regex-explanation.ts";

/** Navigation callbacks owned by the builder's page controller. */
export type RegexEditorCallbacks = {
  onBlur: () => void;
  onEnter: () => void;
};

/** Installs one editor while preserving its native form input. */
export function installRegexEditor(
  input: HTMLInputElement,
  callbacks: RegexEditorCallbacks,
): EditorView {
  input.hidden = true;
  const setValidity = (okay: boolean, source: string): void => {
    input.setAttribute("aria-invalid", String(!okay));
    view.contentDOM.setAttribute("aria-invalid", String(!okay));
    view.dom.classList.toggle("cm-invalid", !okay);
    const error = input.parentElement?.querySelector<HTMLElement>(
      "[data-regex-error]",
    );
    if (error) {
      error.hidden = okay;
    }
    const explanation = input.parentElement?.querySelector<HTMLElement>(
      "[data-regex-explanation]",
    );
    if (explanation) {
      explanation.textContent = okay
        ? explainRegex(source)
        : "Cannot explain an invalid RE2 expression.";
    }
  };
  const update = (value: string): void => {
    input.value = value;
    input.setSelectionRange(value.length, value.length);
    setValidity(valid(value, selectedFlags(input)), value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const view = new EditorView({
    state: EditorState.create({
      doc: input.value,
      extensions: [
        regexHighlight,
        EditorView.contentAttributes.of({
          "aria-describedby": input.getAttribute("aria-describedby") ?? "",
          "aria-label": "RE2 pattern",
        }),
        EditorView.domEventHandlers({ blur: callbacks.onBlur }),
        keymap.of([{
          key: "Enter",
          run: () => {
            callbacks.onEnter();
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
  view.dom.classList.add("cm-re2");
  setValidity(valid(input.value, selectedFlags(input)), input.value);
  return view;
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

/** Returns selected flag characters for the rule containing one pattern. */
function selectedFlags(input: HTMLInputElement): string {
  return [
    ...input.form!.querySelectorAll<HTMLInputElement>(
      `input[name^="${input.name.replace(/pattern$/, "flag-")}"]:checked`,
    ),
  ].map((field) => field.name.at(-1)).join("");
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
