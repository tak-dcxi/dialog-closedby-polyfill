import { ClosedBy, DialogListeners } from "./types.js";

/** Maps every open `<dialog>` element to its active listeners. */
const dialogStates = new WeakMap<HTMLDialogElement, DialogListeners>();

/** Set of currently open dialogs, in the order they were opened. */
const activeDialogs = new Set<HTMLDialogElement>();

/**
 * Modality recorded by the patched `show()` / `showModal()`. Only consulted
 * when the engine does not support the `:modal` pseudo-class.
 */
const modalFallback = new WeakMap<HTMLDialogElement, boolean>();

/**
 * Set while an author-initiated `requestClose()` is running. Per spec,
 * `requestClose()` works regardless of `closedby`, so the `cancel` it fires
 * must not be suppressed for `closedby="none"`.
 */
let authorRequestCloseDepth = 0;

/* -------------------------------------------------------------------------- */
/* Helper utilities                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Records whether a dialog was opened as a modal. Used as a fallback for
 * engines without `:modal` support.
 */
export function markModal(dialog: HTMLDialogElement, modal: boolean): void {
  modalFallback.set(dialog, modal);
}

/** Returns `true` if the dialog is currently shown as a modal. */
function isModal(dialog: HTMLDialogElement): boolean {
  try {
    return dialog.matches(":modal");
  } catch {
    return modalFallback.get(dialog) === true;
  }
}

/**
 * Returns the computed closed-by state of a dialog, mirroring the native
 * `closedBy` getter. The attribute is matched ASCII case-insensitively.
 * A missing or invalid value is the *Auto* state, which resolves to
 * `"closerequest"` for modal dialogs and `"none"` otherwise.
 *
 * @see https://html.spec.whatwg.org/multipage/interactive-elements.html#computed-closed-by-state
 */
export function getComputedClosedBy(dialog: HTMLDialogElement): ClosedBy {
  const raw = dialog.getAttribute("closedby")?.toLowerCase();
  if (raw === "any" || raw === "closerequest" || raw === "none") return raw;
  return isModal(dialog) ? "closerequest" : "none";
}

/**
 * Runs an author-initiated `requestClose()` so that the `cancel` event it
 * dispatches is not blocked by `closedby="none"`.
 */
export function runAuthorRequestClose<T>(fn: () => T): T {
  authorRequestCloseDepth++;
  try {
    return fn();
  } finally {
    authorRequestCloseDepth--;
  }
}

/**
 * Closes a dialog the way a close request does: fire a cancelable `cancel`
 * event first, and close only if it was not canceled.
 *
 * Native `requestClose()` is used for modal dialogs when available (Safari
 * ships it without `closedby`). For modeless dialogs it is not used, because
 * engines that predate `closedby` close them without firing `cancel`.
 */
function requestCloseCompat(dialog: HTMLDialogElement): void {
  const nativeRequestClose = (
    dialog as HTMLDialogElement & { requestClose?: () => void }
  ).requestClose;

  if (typeof nativeRequestClose === "function" && isModal(dialog)) {
    nativeRequestClose.call(dialog);
    return;
  }

  const notCanceled = dialog.dispatchEvent(
    new Event("cancel", { bubbles: false, cancelable: true })
  );
  if (notCanceled && dialog.open) dialog.close();
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
 * By design, **only the top-most dialog should receive user input
 * (pointer and keyboard events)**. Lower-layer dialogs are effectively
 * inert until they become top-most. The `isTopMost()` helper enforces this
 * rule wherever user actions need to be filtered.
 */

/**
 * Returns `true` if the dialog is the top-most (last opened) dialog.
 *
 * @param dialog - Dialog candidate.
 */
function isTopMost(dialog: HTMLDialogElement): boolean {
  return getTopMostDialog() === dialog;
}

/**
 * Returns the top-most dialog, or `undefined` if none is open.
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

/** Tracks whether the escape handler has been registered. */
let escapeHandlerRegistered = false;

/**
 * Global `keydown` handler attached **once** to <kbd>document</kbd> to mirror
 * UA behavior for the *Escape* key. Only the top-most (most recently opened)
 * dialog is processed.
 *
 * - Modal dialogs: the browser already runs a close request (and fires
 *   `cancel`). For `closedby="none"`, the keydown is canceled so that the
 *   close request never starts.
 * - Modeless dialogs: browsers without `closedby` run no close request for
 *   them, so this handler does it for `closerequest` and `any`.
 *
 * @param event - The keyboard event to handle
 */
function documentEscapeHandler(event: KeyboardEvent): void {
  if (event.key !== "Escape" || event.isComposing || event.defaultPrevented) {
    return;
  }

  const topDialog = getTopMostDialog();
  if (!topDialog || !topDialog.open) return;

  const closedBy = getComputedClosedBy(topDialog);

  if (isModal(topDialog)) {
    if (closedBy === "none") event.preventDefault();
    return;
  }

  if (closedBy === "none") return;

  // Keep the browser from also running a close request for a modal dialog
  // further down the stack.
  event.preventDefault();
  requestCloseCompat(topDialog);
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
 * Creates a document-wide click handler that emulates backdrop clicks, and
 * clicks outside modeless dialogs.
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
      getComputedClosedBy(dialog) !== "any" ||
      !dialog.open
    ) {
      return;
    }

    if (!isClickInsideDialog(dialog, event.clientX, event.clientY)) {
      requestCloseCompat(dialog);
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
    if (getComputedClosedBy(dialog) !== "any") return;

    if (!isClickInsideDialog(dialog, event.clientX, event.clientY)) {
      requestCloseCompat(dialog);
    }
  };
}

/**
 * Generates a `cancel` handler that keeps `closedby="none"` dialogs open
 * when the user agent fires `cancel` for a close request (e.g. the Android
 * back gesture). Author calls to `requestClose()` are not blocked.
 *
 * @param dialog - Host dialog element.
 */
function createCancelHandler(dialog: HTMLDialogElement) {
  return function handleCancel(event: Event): void {
    if (authorRequestCloseDepth > 0) return;
    if (getComputedClosedBy(dialog) === "none") {
      event.preventDefault();
    }
  };
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/** Returns `true` if the dialog already has listeners attached. */
export function isAttached(dialog: HTMLDialogElement): boolean {
  return dialogStates.has(dialog);
}

/**
 * Attaches all required listeners to an open `<dialog>` element.
 *
 * @param dialog - Target dialog element.
 *
 * @remarks
 * Every open dialog is tracked, with or without a `closedby` attribute, so
 * that the stack order stays correct and so that `closedby` can be added
 * while the dialog is open.
 *
 * The function is idempotent; subsequent calls on the same element update
 * the openedAt timestamp and stack order but do not re-attach listeners.
 *
 * Click handlers use event.timeStamp to ignore clicks that occurred before
 * the dialog was opened. This prevents the dialog from immediately closing
 * when re-opened after being closed by a button click inside it.
 *
 * A close event listener ensures cleanup happens regardless of how the dialog
 * was closed (including via <form method="dialog">).
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
    // The close event is queued, so the dialog may already have been
    // reopened by the time it fires. Keep the listeners in that case.
    handleClose: () => {
      if (!dialog.open) detachDialog(dialog);
    },
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
 * Removes every listener previously installed by {@link attachDialog}.
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
