/** @module Pointer drag-and-drop for ordered builder rules. */

/** Called after a rule is dropped onto a different numbered slot. */
export type MoveRule = (
  form: HTMLFormElement,
  source: number,
  destination: number,
) => void;

let draggedRule: number | undefined;

/** Installs drag delegation on one replaceable builder main element. */
export function installRuleDragging(
  main: HTMLElement,
  moveRule: MoveRule,
): void {
  main.addEventListener("dragstart", dragstart);
  main.addEventListener("dragover", dragover);
  main.addEventListener("drop", (event) => drop(event, moveRule));
  main.addEventListener("dragend", clearDragState);
}

/** Starts pointer reordering only from the visible drag handle. */
function dragstart(event: DragEvent): void {
  const target = event.target;
  if (
    !(target instanceof HTMLElement) ||
    !target.matches("[data-drag-handle]")
  ) {
    event.preventDefault();
    return;
  }
  const rule = target.closest<HTMLElement>("[data-rule-index]");
  const index = Number(rule?.dataset.ruleIndex);
  if (!rule || !Number.isSafeInteger(index)) {
    event.preventDefault();
    return;
  }
  draggedRule = index;
  rule.classList.add("dragging");
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));
  }
}

/** Shows which numbered slot will receive the dragged rule. */
function dragover(event: DragEvent): void {
  if (draggedRule === undefined) {
    return;
  }
  const rule = ruleAt(event.target);
  if (!rule) {
    return;
  }
  event.preventDefault();
  clearDragTargets();
  if (Number(rule.dataset.ruleIndex) !== draggedRule) {
    rule.classList.add("drag-target");
  }
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "move";
  }
}

/** Moves a dragged rule into the numbered target slot through the server form. */
function drop(event: DragEvent, moveRule: MoveRule): void {
  const rule = ruleAt(event.target);
  const source = draggedRule;
  const destination = Number(rule?.dataset.ruleIndex);
  event.preventDefault();
  clearDragState();
  if (
    !rule || source === undefined || !Number.isSafeInteger(destination) ||
    source === destination
  ) {
    return;
  }
  const form = rule.closest<HTMLFormElement>("form[data-builder]");
  if (form) {
    moveRule(form, source, destination);
  }
}

/** Returns the rule card under one drag event target. */
function ruleAt(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element
    ? target.closest<HTMLElement>("[data-rule-index]")
    : null;
}

/** Removes current target styling while the pointer crosses rule slots. */
function clearDragTargets(): void {
  for (const rule of document.querySelectorAll(".rule.drag-target")) {
    rule.classList.remove("drag-target");
  }
}

/** Resets all drag state after a completed or cancelled operation. */
function clearDragState(): void {
  draggedRule = undefined;
  clearDragTargets();
  document.querySelector(".rule.dragging")?.classList.remove("dragging");
}
