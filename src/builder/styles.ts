/** @module Builder stylesheet. */

import { picoCss } from "./generated-assets.ts";

/** CSS served by the builder page. */
export const builderCss = `${picoCss}

:root {
  color-scheme: light dark;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.rule {
  border-top: 1px solid var(--pico-muted-border-color);
  padding-top: 1rem;
}

.event {
  margin-bottom: 0.75rem;
}

.error {
  color: var(--pico-del-color);
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
`;
