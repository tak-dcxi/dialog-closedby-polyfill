import { ClosedBy, DialogListeners } from "./types.js";

/** Maps every open `<dialog>` element to its active listeners. */
const dialogStates = new WeakMap<HTMLDialogElement, DialogListeners>();

/* -------------------------------------------------------------------------- */
/* Helper utilities                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Normalizes the value of the `closedby` attribute.
 *
 * @param dialog - The dialog whose attribute is inspected.
 * @returns `"any"`, `"closerequest"`, or `"none"`.
 */
function getClosedByValue(dialog: HTMLDialogElement): ClosedBy {
  const raw = dialog.getAttribute("closedby");
  return raw === "closerequest" || raw === "none" ? raw : "any";
}

/**
 * NOTE:
 * By design, **only the top-most modal dialog in the pending-dialog stack
 * should receive user input (pointer and keyboard events)**.
 * Lower-layer dialogs are effectively inert until they become top-most.
 * The `isTopMost()` helper enforces this rule wherever user actions need
 * to be filtered.
 */

/**
 * Returns `true` if the dialog is the top-most (last added) modal in the stack.
 *
 * @param dialog - Dialog candidate.
 */
function isTopMost(dialog: HTMLDialogElement): boolean {
  const stack = Array.from(activeDialogs);
  return stack[stack.length - 1] === dialog;
}

/* -------------------------------------------------------------------------- */
/* Document-level <kbd>Escape</kbd> delegation                                */
/* -------------------------------------------------------------------------- */

/** Set of currently open modal dialogs that define `closedby`. */
const activeDialogs = new Set<HTMLDialogElement>();

/**
 * Global `keydown` handler attached **once** to <kbd>document</kbd> to mirror
 * UA behavior for the *Escape* key. When multiple modal dialogs are stacked
 * (custom UI), only the topmost (most recently opened) dialog is processed
 * to maintain proper modal behavior.
 *
 * @param event - The keyboard event to handle
 *
 * @remarks
 * This implementation processes dialogs in reverse order of their addition
 * to ensure that only the topmost dialog in the stack is affected by the
 * Escape key. This follows standard modal dialog UX patterns where only
 * the active/focused dialog should respond to dismissal actions.
 */
function documentEscapeHandler(event: KeyboardEvent): void {
  if (event.key !== "Escape" || activeDialogs.size === 0) return;

  let shouldPreventDefault = false;
  let hasClosableDialog = false;

  // Process dialogs in reverse order (most recently added first)
  // to handle the topmost dialog in the stack
  const dialogsArray = Array.from(activeDialogs).reverse();

  for (const dialog of dialogsArray) {
    const closedBy = getClosedByValue(dialog);

    if (closedBy === "none") {
      // Dialog prevents closure - stop processing and prevent default
      shouldPreventDefault = true;
      break;
    }

    if (closedBy === "any" || closedBy === "closerequest") {
      // Close only the topmost closable dialog and stop processing
      dialog.close();
      hasClosableDialog = true;
      break;
    }
  }

  // Prevent default browser behavior (like exiting fullscreen) when any dialog
  // handles the ESC key, either by preventing closure or by closing the dialog
  if (shouldPreventDefault || hasClosableDialog) {
    event.preventDefault();
  }
}

document.addEventListener("keydown", documentEscapeHandler);

/* -------------------------------------------------------------------------- */
/* Light-dismiss handler for hidden backdrops                                 */
/* -------------------------------------------------------------------------- */

/**
 * Creates a document-wide click handler that emulates backdrop clicks.
 *
 * @param dialog - The dialog to be controlled.
 */
function createLightDismissHandler(dialog: HTMLDialogElement) {
  /**
   * Handles clicks captured at the document level.
   *
   * @param event - Pointer event.
   */
  return function handleDocumentClick(event: MouseEvent): void {
    // Only the top-most, open dialog with closedby="any" can be dismissed.
    if (
      !isTopMost(dialog) ||
      getClosedByValue(dialog) !== "any" ||
      !dialog.open
    ) {
      return;
    }

    const rect = dialog.getBoundingClientRect();
    const { clientX: x, clientY: y } = event;
    const inside =
      rect.top <= y && y <= rect.bottom && rect.left <= x && x <= rect.right;

    if (!inside) dialog.close();
  };
}

/* -------------------------------------------------------------------------- */
/* cancel / click handlers bound per dialog                                   */
/* -------------------------------------------------------------------------- */

/**
 * Generates a click handler that closes the dialog when the backdrop
 * (the element itself) is clicked and `closedby="any"`.
 *
 * @param dialog - Host dialog element.
 */
function createClickHandler(dialog: HTMLDialogElement) {
  return function handleClick(event: MouseEvent): void {
    if (event.target !== dialog) return;
    if (getClosedByValue(dialog) !== "any") return;

    const rect = dialog.getBoundingClientRect();
    const inside =
      rect.top < event.clientY &&
      event.clientY < rect.bottom &&
      rect.left < event.clientX &&
      event.clientX < rect.right;

    if (!inside) dialog.close();
  };
}

/**
 * Generates a `cancel` handler (triggered by ESC) that respects `closedby`.
 *
 * @param dialog - Host dialog element.
 */
function createCancelHandler(dialog: HTMLDialogElement) {
  return function handleCancel(event: Event): void {
    if (getClosedByValue(dialog) === "none") event.preventDefault();
  };
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Attaches all required listeners to a `<dialog>` element.
 *
 * @param dialog - Target dialog element.
 *
 * @remarks
 * The function is idempotent; subsequent calls on the same element are no-ops.
 */
export function attachDialog(dialog: HTMLDialogElement): void {
  if (dialogStates.has(dialog)) return; // already initialized

  const state: DialogListeners = {
    handleEscape: documentEscapeHandler,
    handleClick: createClickHandler(dialog),
    handleDocClick: createLightDismissHandler(dialog),
    handleCancel: createCancelHandler(dialog),
    attrObserver: new MutationObserver(() => {
      /* intentionally empty: reactivity handled via getClosedByValue() */
    }),
  };

  dialog.addEventListener("click", state.handleClick);
  dialog.addEventListener("cancel", state.handleCancel);

  // Capture phase to avoid stopPropagation() in frameworks
  document.addEventListener("click", state.handleDocClick, true);

  state.attrObserver.observe(dialog, {
    attributes: true,
    attributeFilter: ["closedby"],
  });

  activeDialogs.add(dialog);
  dialogStates.set(dialog, state);
}

/**
 * Removes every listener and observer previously installed by {@link attachDialog}.
 *
 * @param dialog - Dialog element being detached.
 */
export function detachDialog(dialog: HTMLDialogElement): void {
  const state = dialogStates.get(dialog);
  if (!state) return;

  dialog.removeEventListener("click", state.handleClick);
  dialog.removeEventListener("cancel", state.handleCancel);
  document.removeEventListener("click", state.handleDocClick, true);
  state.attrObserver.disconnect();

  activeDialogs.delete(dialog);
  dialogStates.delete(dialog);
}
