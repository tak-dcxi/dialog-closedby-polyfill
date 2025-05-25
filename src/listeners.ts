import { ClosedBy, DialogListeners } from "./types.js";

/** Maps every open `<dialog>` to its active {@link DialogListeners}. */
const dialogStates = new WeakMap<HTMLDialogElement, DialogListeners>();

/* -------------------------------------------------------------------------- */
/* Helper utilities                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Returns the normalized *closedBy* semantic for a given dialog.
 *
 * @remarks
 *  The attribute is resolved at call‑time so that live mutations are respected
 *  without reattaching handlers.
 */
function getClosedByValue(dialog: HTMLDialogElement): ClosedBy {
  const raw = dialog.getAttribute("closedby");
  return raw === "closerequest" || raw === "none" ? raw : "any";
}

/* -------------------------------------------------------------------------- */
/* Document‑level <kbd>Escape</kbd> delegation                                 */
/* -------------------------------------------------------------------------- */

/** Currently open modal dialogs that have `closedby` present. */
let activeDialogs = new Set<HTMLDialogElement>();

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
    } else if (closedBy === "any" || closedBy === "closerequest") {
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
/* Factory helpers for per‑dialog handlers                                    */
/* -------------------------------------------------------------------------- */

/**
 * Generates a click handler that closes the dialog when the user clicks the
 * *backdrop* **and** `closedBy` is set to `"any"`.
 */
function createClickHandler(dialog: HTMLDialogElement) {
  /**
   * @param event – Pointer event dispatched on the dialog element.
   */
  return function handleClick(event: MouseEvent): void {
    // Ignore clicks that originate from inside the dialog box.
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

/** Creates a `cancel` event handler that respects the `closedBy` mode. */
function createCancelHandler(dialog: HTMLDialogElement) {
  return function handleCancel(event: Event): void {
    if (getClosedByValue(dialog) === "none") event.preventDefault();
  };
}

/* -------------------------------------------------------------------------- */
/* Public API: attach / detach                                                */
/* -------------------------------------------------------------------------- */

/**
 * Installs all event listeners and attribute observers required for a single
 * `<dialog>`. The function is idempotent: calling it repeatedly on the same
 * element is a no‑op after the first execution.
 */
export function attachDialog(dialog: HTMLDialogElement): void {
  if (dialogStates.has(dialog)) return; // already initialized

  const state: DialogListeners = {
    handleEscape: documentEscapeHandler,
    handleClick: createClickHandler(dialog),
    handleCancel: createCancelHandler(dialog),
    attrObserver: new MutationObserver(() => {
      /* noop – see remarks below */
    }),
  };

  dialog.addEventListener("click", state.handleClick);
  dialog.addEventListener("cancel", state.handleCancel);
  state.attrObserver.observe(dialog, {
    attributes: true,
    attributeFilter: ["closedby"],
  });

  activeDialogs.add(dialog);
  dialogStates.set(dialog, state);
}

/**
 * Removes *all* runtime artefact introduced by {@link attachDialog}. This is
 * called from the polyfilled `close()` override **and** when a dialog node is
 * detached from the DOM tree by other means (MutationObserver).
 */
export function detachDialog(dialog: HTMLDialogElement): void {
  const state = dialogStates.get(dialog);
  if (!state) return;

  dialog.removeEventListener("click", state.handleClick);
  dialog.removeEventListener("cancel", state.handleCancel);
  state.attrObserver.disconnect();

  activeDialogs.delete(dialog);
  dialogStates.delete(dialog);
}
