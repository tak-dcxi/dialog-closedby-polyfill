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
 * Mirrors native ESC-key behavior across stacked custom dialogs.
 *
 * @param event - Keyboard event.
 */
function documentEscapeHandler(event: KeyboardEvent): void {
  if (event.key !== "Escape" || activeDialogs.size === 0) return;

  let preventDefault = false;

  // Iterate from top-most to bottom
  for (const dialog of Array.from(activeDialogs).reverse()) {
    const closedBy = getClosedByValue(dialog);

    if (closedBy === "none") {
      // ESC is explicitly disabled
      preventDefault = true;
      break;
    }

    if (closedBy === "any" || closedBy === "closerequest") {
      dialog.close();
      preventDefault = true;
      break;
    }
  }

  if (preventDefault) event.preventDefault();
}

document.addEventListener("keydown", documentEscapeHandler, { passive: true });

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
    handleDocClick: createLightDismissHandler(dialog), // NEW
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
