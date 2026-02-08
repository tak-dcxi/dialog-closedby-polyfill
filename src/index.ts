import { setupObservers } from "./observer.js";
import { attachDialog, detachDialog } from "./listeners.js";
import { ClosedBy } from "./types.js";

/* -------------------------------------------------------------------------- */
/* Public helper utilities                                                    */
/* -------------------------------------------------------------------------- */

/** Tracks whether the polyfill has already patched prototypes. */
let polyfilled = false;

/**
 * Detects native support for the `closedBy` property. If this function returns
 * `true`, **no** polyfill is needed because the user‑agent already exposes
 * the expected behavior.
 *
 * The check goes beyond a simple `"closedBy" in HTMLDialogElement.prototype`
 * test: Safari 26.2 exposes the property on the prototype but never completed
 * the implementation, so attribute reflection does not work. Creating a
 * detached `<dialog>`, setting `closedby="none"`, and reading back
 * `dialog.closedBy` verifies that the getter actually reflects the content
 * attribute – which is a prerequisite for the full feature to function.
 *
 * @see https://github.com/tak-dcxi/dialog-closedby-polyfill/issues/13
 */
export function isSupported(): boolean {
  if (
    typeof HTMLDialogElement === "undefined" ||
    typeof HTMLDialogElement.prototype !== "object" ||
    !("closedBy" in HTMLDialogElement.prototype)
  ) {
    return false;
  }

  // Ensure we are in a DOM environment with a usable `document` before
  // performing any behavioural checks. In some non‑Window runtimes,
  // `HTMLDialogElement` may exist even when `document` is unavailable.
  if (
    typeof document === "undefined" ||
    typeof (document as Document).createElement !== "function"
  ) {
    return false;
  }

  // Behavioral check: verify the getter actually reflects the content
  // attribute. Safari 26.2 exposes `closedBy` on the prototype but the
  // getter does not return the expected value.
  try {
    const testDialog = document.createElement("dialog") as HTMLDialogElement;
    testDialog.setAttribute("closedby", "none");
    return (testDialog as any).closedBy === "none";
  } catch {
    // If anything goes wrong during the behavioural check, treat the
    // feature as unsupported rather than throwing at import time.
    return false;
  }
}

/** Returns `true` once {@link apply} has run successfully. */
export function isPolyfilled(): boolean {
  return polyfilled;
}

/* -------------------------------------------------------------------------- */
/* Polyfill entry point                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Applies the polyfill exactly **once**. Re‑invocations are ignored. When the
 * current engine already supports `closedBy`, the function becomes a no‑op as
 * well.
 */
export function apply(): void {
  "use strict"; // eslint-disable-line strict

  if (polyfilled || isSupported()) return;

  // Older WebKit versions ship *no* <dialog> implementation at all. Abort early
  // because patching non‑existent prototypes would throw.
  if (!("showModal" in HTMLDialogElement.prototype)) {
    console.warn(
      "[closedBy polyfill] <dialog> API not found – polyfill skipped."
    );
    return;
  }

  /* Cache original methods */
  const originalShowModal = HTMLDialogElement.prototype.showModal;
  const originalClose = HTMLDialogElement.prototype.close;

  /**
   * Monkey‑patch {@link HTMLDialogElement.showModal} so that event listeners
   * are wired up whenever the dialog opens *and* the author declared
   * `closedby`.
   */
  HTMLDialogElement.prototype.showModal = function showModalPatched(): void {
    originalShowModal.call(this);

    // Guard: <dialog> could be detached from DOM – `.open` would be false.
    if (!this.open) return;

    if (this.hasAttribute("closedby")) attachDialog(this);
  };

  /**
   * Ensures that listeners are removed before delegating to the native
   * `close()` implementation.
   */
  HTMLDialogElement.prototype.close = function closePatched(
    returnValue?: string
  ): void {
    detachDialog(this);
    originalClose.call(this, returnValue);
  };

  /**
   * Defines the JavaScript property counterpart for the `closedby` content
   * attribute. Reads return the normalized {@link ClosedBy} semantic. Writes
   * update the underlying attribute **and** synchronies listeners in real
   * time when the dialog is currently open.
   */
  Object.defineProperty(HTMLDialogElement.prototype, "closedBy", {
    get(): ClosedBy {
      const v = this.getAttribute("closedby");
      return v === "closerequest" || v === "none" ? v : "any";
    },
    set(value: ClosedBy) {
      if (value === "any" || value === "closerequest" || value === "none") {
        this.setAttribute("closedby", value);
      } else {
        console.warn(
          `[closedBy polyfill] Invalid value '${value}'. Falling back to 'any'.`
        );
        this.setAttribute("closedby", "any");
      }

      // Keep listeners in sync with the current open state
      if (this.open) {
        if (this.hasAttribute("closedby")) {
          attachDialog(this);
        } else {
          detachDialog(this);
        }
      }
    },
    enumerable: true,
    configurable: true,
  });

  /* Kick‑off global observers */
  setupObservers();

  polyfilled = true;
}

/* -------------------------------------------------------------------------- */
/* Auto-apply polyfill when imported                                          */
/* -------------------------------------------------------------------------- */

// Automatically apply the polyfill when this module is imported
if (!isSupported()) apply();
