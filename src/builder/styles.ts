/** @module Builder stylesheet. */

import { picoCss } from "./generated-assets.ts";

/** CSS served by the builder page. */
export const builderCss = `${picoCss}

:root {
  color-scheme: light dark;
  --pico-spacing: 0.55rem;
  --pico-form-element-spacing-vertical: 0.3rem;
  --pico-form-element-spacing-horizontal: 0.5rem;
  --pico-font-size: 87.5%;
}

main.container {
  max-width: 96rem;
  padding-top: 0.7rem;
  padding-bottom: 0.7rem;
}

h1 {
  font-size: 1.55rem;
}

h1,
h2,
p {
  margin-bottom: 0.35rem;
}

form,
label,
input,
select,
button {
  margin-bottom: 0;
}

button {
  width: auto;
  padding: 0.35rem 0.65rem;
}

.builder-settings {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(16rem, 1fr);
  gap: 0.5rem;
}

.builder-settings small,
.rule-note {
  display: block;
  margin-top: 0.15rem;
}

.rules {
  margin: 0.5rem 0;
  padding: 0.5rem;
  background: var(--pico-card-sectioning-background-color);
}

.rules > p {
  margin-bottom: 0.4rem;
}

.rule-list {
  display: grid;
  gap: 0.35rem;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  align-items: center;
}

.rule {
  border: 1px solid var(--pico-muted-border-color);
  border-left: 0.25rem solid var(--pico-primary);
  border-radius: var(--pico-border-radius);
  padding: 0.35rem 0.45rem;
  background: var(--pico-card-background-color);
  box-shadow: var(--pico-card-box-shadow);
  transition: border-color 120ms ease, opacity 120ms ease;
}

.rule-heading {
  display: flex;
  gap: 0.35rem;
  align-items: center;
  min-height: 1.8rem;
  margin-bottom: 0.25rem;
}

.rule-heading .actions {
  margin-left: auto;
}

.rule-heading > strong {
  padding: 0.1rem 0.35rem;
  border-radius: var(--pico-border-radius);
  color: var(--pico-primary-inverse);
  background: var(--pico-primary-background);
}

.drag-handle {
  display: inline-grid;
  width: 1.6rem;
  height: 1.6rem;
  place-items: center;
  border-radius: var(--pico-border-radius);
  color: var(--pico-muted-color);
  font-size: 1.35rem;
  line-height: 1;
  cursor: grab;
  user-select: none;
}

.drag-handle:hover {
  color: var(--pico-primary);
  background: var(--pico-secondary-background);
}

.drag-handle:active,
.rule.dragging .drag-handle {
  cursor: grabbing;
}

.rule.dragging {
  opacity: 0.45;
}

.rule.drag-target {
  border-color: var(--pico-primary);
  box-shadow: 0 0 0 1px var(--pico-primary);
}

.rule-fields {
  display: grid;
  grid-template-columns:
    minmax(16rem, 2fr) minmax(7rem, 0.5fr) minmax(18rem, auto)
    minmax(22rem, 1.5fr);
  gap: 0.35rem;
  align-items: end;
}

.rule-pattern {
  min-width: 0;
}

.rule-pattern small:not([hidden]) {
  display: block;
  margin-top: 0.15rem;
  overflow-wrap: anywhere;
}

[data-regex-explanation] {
  font-style: italic;
}

.rule-mode,
.rule-flags {
  margin: 0;
}

.rule-flags {
  padding: 0.2rem 0.35rem;
}

.rule-flags legend {
  font-size: 0.72rem;
}

.rule-flags label {
  display: inline-flex;
  margin: 0 0.35rem 0 0;
  font-size: 0.78rem;
  white-space: nowrap;
}

.icon-button {
  min-width: 1.8rem;
  min-height: 1.65rem;
  padding: 0.1rem 0.35rem;
  line-height: 1;
}

[data-result-url] {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.45rem;
  align-items: end;
}

.event + .event {
  margin-top: 0;
}

.event {
  margin: 0;
  padding: 0.4rem;
}

.preview {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
  gap: 0.35rem;
}

.preview > h2,
.preview > p {
  grid-column: 1 / -1;
}

.error {
  color: var(--pico-del-color);
}

[data-navigation-error] {
  margin-top: 0.35rem;
  margin-bottom: 0;
}

[data-result-url] [data-navigation-error] {
  grid-column: 1 / -1;
}

.implicit-submit {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.cm-re2 {
  border: 1px solid var(--pico-form-element-border-color);
  border-radius: var(--pico-border-radius);
  padding: var(--pico-form-element-spacing-vertical)
    var(--pico-form-element-spacing-horizontal);
}

.cm-invalid {
  border-color: var(--pico-del-color);
}

.cm-re2-escape,
.cm-re2-group {
  color: var(--pico-primary);
}

.cm-re2-class {
  color: var(--pico-ins-color);
}

.cm-re2-operator {
  color: var(--pico-secondary);
}

.cm-re2-quantifier {
  color: var(--pico-del-color);
}

@media (min-width: 701px) and (max-width: 1100px) {
  .rule-fields {
    grid-template-columns: minmax(14rem, 1fr) minmax(7rem, 0.4fr) 18rem;
  }

  .rule-flags {
    grid-column: 1 / -1;
  }
}

@media (max-width: 700px) {
  :root {
    --pico-font-size: 100%;
  }

  .builder-settings,
  .rule-fields,
  [data-result-url] {
    grid-template-columns: 1fr;
  }

  main.container {
    padding-right: 0.5rem;
    padding-left: 0.5rem;
  }

  .rule-heading {
    flex-wrap: wrap;
  }

  .rule-heading .actions {
    width: 100%;
    margin-left: 0;
  }

  .rule-fields > *,
  input,
  select,
  .cm-re2 {
    min-width: 0;
    max-width: 100%;
  }

  .rule-flags label {
    white-space: normal;
  }
}
`;
