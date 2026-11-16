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
 * Checks if a pointer at the given coordinates is inside the dialog's bounding rect.
 *
 * @param dialog - The dialog element to check against.
 * @param x - The clientX coordinate of the pointer.
 * @param y - The clientY coordinate of the pointer.
 * @returns `true` if the pointer is inside the dialog, `false` otherwise.
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
 * By design, **only the top-most dialog reacts to user input
 * (pointer and keyboard events)**. Light dismiss and Escape always act on
 * the dialog returned by `getTopMostDialog()`.
 */

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
/* Document-level light dismiss                                               */
/* -------------------------------------------------------------------------- */

/**
 * What the last `pointerdown` hit, kept until the matching `pointerup`.
 * `null` means no `pointerdown` was recorded for the current gesture.
 *
 * The event path is stored instead of the spec's *dialog pointerdown target*
 * because native implementations compute that target after the event has
 * been dispatched, while this capture listener runs before page handlers.
 * Resolving the path at `pointerup` gives the same result: a dialog opened by
 * a `pointerdown` handler is not on the path, so the press counts as outside.
 */
let pointerdownRecord: PointerRecord | null = null;

/** The parts of a pointer event needed to find its nearest clicked dialog. */
interface PointerRecord {
  path: EventTarget[];
  x: number;
  y: number;
}

/** Tracks whether the light dismiss handlers have been registered. */
let lightDismissHandlersRegistered = false;

/** Captures the parts of a pointer event needed by {@link getNearestClickedDialog}. */
function toPointerRecord(event: PointerEvent): PointerRecord {
  return { path: event.composedPath(), x: event.clientX, y: event.clientY };
}

/**
 * Returns the spec's *nearest clicked dialog* of a pointer event: the closest
 * open dialog that contains the event target in the flat tree, or `null` when
 * the event landed outside every dialog. A press on the backdrop of a modal
 * dialog (the dialog itself is the target, but the coordinates are outside
 * its box) counts as outside.
 *
 * `composedPath()` exposes targets inside open shadow roots. Targets inside
 * closed shadow roots are hidden behind their host.
 *
 * @see https://html.spec.whatwg.org/multipage/interactive-elements.html#nearest-clicked-dialog
 */
function getNearestClickedDialog({
  path,
  x,
  y,
}: PointerRecord): HTMLDialogElement | null {
  const target = path[0];

  if (
    target instanceof HTMLDialogElement &&
    target.open &&
    isModal(target) &&
    !isClickInsideDialog(target, x, y)
  ) {
    return null;
  }

  for (const node of path) {
    if (node instanceof HTMLDialogElement && node.open) return node;
  }
  return null;
}

/**
 * Light dismiss, following the spec's "light dismiss open dialogs" steps.
 *
 * - `pointerdown` records what was pressed.
 * - `pointerup` closes the top-most dialog with `closedby="any"` only when
 *   the press and the release have the same nearest clicked dialog, and that
 *   dialog is not the top-most one. A drag that starts inside the dialog and
 *   ends on the backdrop therefore keeps it open.
 * - `pointercancel` (e.g. a touch that turns into scrolling) drops the record.
 *
 * Only trusted events are handled, as in native implementations.
 *
 * @see https://html.spec.whatwg.org/multipage/interactive-elements.html#light-dismiss-open-dialogs
 */
function documentPointerHandler(event: PointerEvent): void {
  if (!event.isTrusted) return;

  if (event.type === "pointerdown") {
    pointerdownRecord = toPointerRecord(event);
    return;
  }

  // pointerup or pointercancel
  const down = pointerdownRecord;
  pointerdownRecord = null;
  if (event.type !== "pointerup" || !down) return;

  const topDialog = getTopMostDialog();
  if (!topDialog || !topDialog.open) return;

  const ancestor = getNearestClickedDialog(toPointerRecord(event));
  if (ancestor !== getNearestClickedDialog(down)) return;
  if (ancestor === topDialog) return;
  if (getComputedClosedBy(topDialog) !== "any") return;

  requestCloseCompat(topDialog);
}

/**
 * Registers the document-level light dismiss handlers. Capture phase is used
 * so that `stopPropagation()` in frameworks does not hide the events.
 */
export function registerLightDismissHandlers(): void {
  if (lightDismissHandlersRegistered) return;
  document.addEventListener("pointerdown", documentPointerHandler, true);
  document.addEventListener("pointerup", documentPointerHandler, true);
  document.addEventListener("pointercancel", documentPointerHandler, true);
  lightDismissHandlersRegistered = true;
}

/** Unregisters the document-level light dismiss handlers. */
export function unregisterLightDismissHandlers(): void {
  if (!lightDismissHandlersRegistered) return;
  document.removeEventListener("pointerdown", documentPointerHandler, true);
  document.removeEventListener("pointerup", documentPointerHandler, true);
  document.removeEventListener("pointercancel", documentPointerHandler, true);
  pointerdownRecord = null;
  lightDismissHandlersRegistered = false;
}

/* -------------------------------------------------------------------------- */
/* cancel handler bound per dialog                                            */
/* -------------------------------------------------------------------------- */

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
 * the stack order but do not re-attach listeners.
 *
 * A close event listener ensures cleanup happens regardless of how the dialog
 * was closed (including via <form method="dialog">).
 */
export function attachDialog(dialog: HTMLDialogElement): void {
  if (dialogStates.has(dialog)) {
    // Dialog already tracked, e.g. closed via <form method="dialog"> and
    // reopened before the queued close event fired.
    // Update stack order: remove and re-add to ensure this dialog is topmost
    activeDialogs.delete(dialog);
    activeDialogs.add(dialog);
    return;
  }

  const state: DialogListeners = {
    handleCancel: createCancelHandler(dialog),
    // The close event is queued, so the dialog may already have been
    // reopened by the time it fires. Keep the listeners in that case.
    handleClose: () => {
      if (!dialog.open) detachDialog(dialog);
    },
  };

  dialog.addEventListener("cancel", state.handleCancel);
  dialog.addEventListener("close", state.handleClose);

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

  dialog.removeEventListener("cancel", state.handleCancel);
  dialog.removeEventListener("close", state.handleClose);

  activeDialogs.delete(dialog);
  dialogStates.delete(dialog);
}
