import { ClosedBy, DialogListeners } from "./types.js";

/** Maps every open `<dialog>` element to its active listeners. */
const dialogStates = new WeakMap<HTMLDialogElement, DialogListeners>();

/* -------------------------------------------------------------------------- */
/* Helper utilities                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Normalizes the value of the `closedby` attribute.
 * Case-insensitive to align with HTML attribute behavior.
 *
 * @param dialog - The dialog whose attribute is inspected.
 * @returns `"any"`, `"closerequest"`, or `"none"`.
 */
function getClosedByValue(dialog: HTMLDialogElement): ClosedBy {
  const raw = dialog.getAttribute("closedby")?.toLowerCase();
  return raw === "closerequest" || raw === "none" ? raw : "any";
}

/**
 * Checks if a click at the given coordinates is inside the dialog's bounding rect.
 *
 * @param dialog - The dialog element to check against.
 * @param x - The clientX coordinate of the click.
 * @param y - The clientY coordinate of the click.
 * @returns `true` if the click is inside the dialog, `false` otherwise.
 */
function isClickInsideDialog(
  dialog: HTMLDialogElement,
  x: number,
  y: number
): boolean {
  const rect = dialog.getBoundingClientRect();
  return rect.top < y && y < rect.bottom && rect.left < x && x < rect.right;
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
  return getTopMostDialog() === dialog;
}

/**
 * Returns the top-most dialog in the stack, or `undefined` if empty.
 * Iterates through the Set to find the last element without creating an array.
 */
function getTopMostDialog(): HTMLDialogElement | undefined {
  let last: HTMLDialogElement | undefined;
  for (const dialog of activeDialogs) {
    last = dialog;
  }
  return last;
}

/* -------------------------------------------------------------------------- */
/* Document-level <kbd>Escape</kbd> delegation                                */
/* -------------------------------------------------------------------------- */

/** Set of currently open modal dialogs that define `closedby`. */
const activeDialogs = new Set<HTMLDialogElement>();

/** Tracks whether the escape handler has been registered. */
let escapeHandlerRegistered = false;

/**
 * Global `keydown` handler attached **once** to <kbd>document</kbd> to mirror
 * UA behavior for the *Escape* key. When multiple modal dialogs are stacked
 * (custom UI), only the topmost (most recently opened) dialog is processed
 * to maintain proper modal behavior.
 *
 * This handler works in coordination with the `cancel` event handler:
 * - For `closedBy="none"`: preventDefault here to stop the browser from
 *   firing the cancel event entirely.
 * - For `closedBy="any"` or `closedBy="closerequest"`: let the browser
 *   fire the cancel event, which will close the dialog.
 *
 * @param event - The keyboard event to handle
 */
function documentEscapeHandler(event: KeyboardEvent): void {
  if (event.key !== "Escape" || activeDialogs.size === 0) return;

  const topDialog = getTopMostDialog();
  if (!topDialog) return;

  const closedBy = getClosedByValue(topDialog);

  // For closedBy="none", prevent the ESC key from triggering cancel event
  if (closedBy === "none") {
    event.preventDefault();
  }
  // For "any" and "closerequest", let the browser handle ESC naturally
  // (it will fire a cancel event, which we don't preventDefault)
}

/**
 * Registers the global escape key handler. This is called once during
 * polyfill initialization to ensure the handler is only added when needed.
 */
export function registerEscapeHandler(): void {
  if (escapeHandlerRegistered) return;
  document.addEventListener("keydown", documentEscapeHandler);
  escapeHandlerRegistered = true;
}

/**
 * Unregisters the global escape key handler. This is called during
 * polyfill teardown to clean up event listeners.
 */
export function unregisterEscapeHandler(): void {
  if (!escapeHandlerRegistered) return;
  document.removeEventListener("keydown", documentEscapeHandler);
  escapeHandlerRegistered = false;
}

/**
 * Detaches all currently tracked dialogs. This is called during
 * polyfill teardown to clean up all dialog listeners.
 */
export function detachAllDialogs(): void {
  // Create a copy since detachDialog modifies activeDialogs
  const dialogs = Array.from(activeDialogs);
  dialogs.forEach(detachDialog);
}

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
    const state = dialogStates.get(dialog);

    // Ignore clicks from before the dialog was opened or clicks that
    // originated from inside the dialog (even if coordinates are outside)
    if (state) {
      if (event.timeStamp <= state.openedAt) return;
      const target = event.target as Node;
      if (dialog.contains(target)) return;
    }

    // Only the top-most, open dialog with closedby="any" can be dismissed.
    if (
      !isTopMost(dialog) ||
      getClosedByValue(dialog) !== "any" ||
      !dialog.open
    ) {
      return;
    }

    if (!isClickInsideDialog(dialog, event.clientX, event.clientY)) {
      const notCancelled = dialog.dispatchEvent(new Event('cancel', { bubbles: false, cancelable: true }));

      if (notCancelled) {
        dialog.close();
      }
    }
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
    const state = dialogStates.get(dialog);

    // Ignore clicks from before the dialog was opened
    if (state && event.timeStamp <= state.openedAt) return;

    if (event.target !== dialog) return;
    if (getClosedByValue(dialog) !== "any") return;

    if (!isClickInsideDialog(dialog, event.clientX, event.clientY)) {
      dialog.close();
    }
  };
}

/**
 * Generates a `cancel` handler (triggered by ESC) that respects `closedby`.
 *
 * @param dialog - Host dialog element.
 */
function createCancelHandler(dialog: HTMLDialogElement) {
  return function handleCancel(event: Event): void {
    // For closedBy="none", prevent the dialog from closing
    // For "any" and "closerequest", allow the default close behavior
    if (getClosedByValue(dialog) === "none") {
      event.preventDefault();
    }
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
 * The function is idempotent; subsequent calls on the same element update
 * the openedAt timestamp and stack order but do not re-attach listeners.
 *
 * Click handlers use event.timeStamp to ignore clicks that occurred before
 * the dialog was opened. This prevents the dialog from immediately closing
 * when re-opened after being closed by a button click inside it.
 *
 * A close event listener ensures cleanup happens regardless of how the dialog
 * was closed (including via <form method="dialog"> which bypasses the patched
 * close() method).
 */
export function attachDialog(dialog: HTMLDialogElement): void {
  if (dialogStates.has(dialog)) {
    // Dialog already tracked - update openedAt for the new open.
    // This handles cases where the dialog was closed via <form method="dialog">
    // which fires the close event but may be reopened in the same tick.
    const state = dialogStates.get(dialog)!;
    state.openedAt = performance.now();

    // Update stack order: remove and re-add to ensure this dialog is topmost
    activeDialogs.delete(dialog);
    activeDialogs.add(dialog);
    return;
  }

  const state: DialogListeners = {
    handleClick: createClickHandler(dialog),
    handleDocClick: createLightDismissHandler(dialog),
    handleCancel: createCancelHandler(dialog),
    handleClose: () => detachDialog(dialog),
    /**
     * Timestamp when the dialog was opened.
     * Uses performance.now() which shares the same time origin as event.timeStamp
     * in modern browsers (DOMHighResTimeStamp).
     */
    openedAt: performance.now(),
  };

  dialog.addEventListener("click", state.handleClick);
  dialog.addEventListener("cancel", state.handleCancel);
  dialog.addEventListener("close", state.handleClose);

  // Capture phase to avoid stopPropagation() in frameworks
  document.addEventListener("click", state.handleDocClick, true);

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
  dialog.removeEventListener("close", state.handleClose);
  document.removeEventListener("click", state.handleDocClick, true);

  activeDialogs.delete(dialog);
  dialogStates.delete(dialog);
}
