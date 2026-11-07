import { setupObservers, teardownObservers } from "./observer.js";
import {
  attachDialog,
  getComputedClosedBy,
  markModal,
  runAuthorRequestClose,
} from "./listeners.js";

/* -------------------------------------------------------------------------- */
/* Side-effect-free entry point                                               */
/* -------------------------------------------------------------------------- */
/*
 * This module only *defines* the polyfill. Importing it never patches
 * anything. Use `dialog-closedby-polyfill` (the package root) instead when the
 * polyfill should be applied automatically on import.
 */

export type { ClosedBy } from "./types.js";

/**
 * Brand attached to the polyfill's `closedBy` getter. A global symbol is used
 * so that every copy of this module (e.g. an ESM and a CommonJS copy loaded
 * side by side) can recognise a getter installed by another copy.
 */
const POLYFILL_MARK = Symbol.for("dialog-closedby-polyfill");

/** Tracks whether the polyfill is currently active (applied and not torn down). */
let polyfilled = false;

/** Tracks whether this copy has already patched the prototypes. */
let prototypesPatched = false;

/**
 * Returns `true` when `HTMLDialogElement.prototype.closedBy` was installed by
 * this polyfill (by any copy of it) rather than by the user agent.
 */
function isPolyfillGetterInstalled(): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLDialogElement.prototype,
    "closedBy"
  );
  const getter = descriptor?.get as
    | (Function & { [POLYFILL_MARK]?: boolean })
    | undefined;
  return getter?.[POLYFILL_MARK] === true;
}

/**
 * Detects native support for the `closedBy` property. If this function returns
 * `true`, **no** polyfill is needed because the user‑agent already exposes
 * the expected behavior.
 *
 * The result reflects the user agent only: it keeps returning `false` after
 * the polyfill has been applied.
 *
 * The check goes beyond a simple `"closedBy" in HTMLDialogElement.prototype`
 * test: Safari 26.2 exposes the property on the prototype but never completed
 * the implementation, so attribute reflection does not work. Creating a
 * detached `<dialog>`, setting `closedby="none"`, and reading back
 * `dialog.closedBy` verifies that the getter actually reflects the content
 * attribute – which is a prerequisite for the full feature to function.
 *
 * @see https://github.com/tak-dcxi/dialog-closedby-polyfill/issues/13
 * @see https://github.com/tak-dcxi/dialog-closedby-polyfill/issues/21
 */
export function isSupported(): boolean {
  if (
    typeof HTMLDialogElement === "undefined" ||
    typeof HTMLDialogElement.prototype !== "object" ||
    !("closedBy" in HTMLDialogElement.prototype)
  ) {
    return false;
  }

  // The property exists, but it may be ours rather than the user agent's.
  if (isPolyfillGetterInstalled()) return false;

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
    const testDialog = document.createElement("dialog");
    testDialog.setAttribute("closedby", "none");
    return (testDialog as HTMLDialogElement & { closedBy?: string }).closedBy === "none";
  } catch {
    // If anything goes wrong during the behavioural check, treat the
    // feature as unsupported rather than throwing at import time.
    return false;
  }
}

/** Returns `true` once {@link apply} has run successfully (and until {@link teardown}). */
export function isPolyfilled(): boolean {
  return polyfilled;
}

/* -------------------------------------------------------------------------- */
/* Prototype patches                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Patches `show`, `showModal` and defines `closedBy`. Runs at most once per
 * copy of this module; {@link teardown} does not undo it.
 */
function patchPrototypes(): void {
  const originalShowModal = HTMLDialogElement.prototype.showModal;
  const originalShow = HTMLDialogElement.prototype.show;

  /**
   * Monkey‑patch {@link HTMLDialogElement.showModal} so that event listeners
   * are wired up synchronously whenever the dialog opens.
   */
  HTMLDialogElement.prototype.showModal = function showModalPatched(): void {
    originalShowModal.call(this);

    // Guard: <dialog> could be detached from DOM – `.open` would be false.
    if (!this.open || !polyfilled) return;

    markModal(this, true);
    attachDialog(this);
  };

  /**
   * Monkey‑patch {@link HTMLDialogElement.show} so that event listeners
   * are wired up for modeless dialogs as well.
   */
  HTMLDialogElement.prototype.show = function showPatched(): void {
    originalShow.call(this);

    if (!this.open || !polyfilled) return;

    markModal(this, false);
    attachDialog(this);
  };

  /**
   * Engines that ship `requestClose()` without `closedby` (Safari) fire
   * `cancel` from it. Mark those calls so that the `closedby="none"` guard
   * does not block them – per spec, `requestClose()` ignores `closedby`.
   */
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & {
    requestClose?: (returnValue?: string) => void;
  };
  const originalRequestClose = proto.requestClose;
  if (typeof originalRequestClose === "function") {
    proto.requestClose = function requestClosePatched(
      this: HTMLDialogElement,
      ...args: [returnValue?: string]
    ): void {
      runAuthorRequestClose(() => originalRequestClose.apply(this, args));
    };
  }

  /**
   * Reads return the computed closed-by state, exactly like the native
   * getter: an explicit `any` / `closerequest` / `none`, or – when the
   * attribute is missing or invalid (the *Auto* state) – `closerequest` for
   * modal dialogs and `none` for everything else.
   *
   * @see https://html.spec.whatwg.org/multipage/interactive-elements.html#computed-closed-by-state
   */
  const get = function getClosedBy(this: HTMLDialogElement): string {
    return getComputedClosedBy(this);
  };
  Object.defineProperty(get, POLYFILL_MARK, { value: true });

  Object.defineProperty(HTMLDialogElement.prototype, "closedBy", {
    get,
    /**
     * Writes reflect the value to the content attribute verbatim, as the
     * native setter does. Listeners read the attribute on every interaction,
     * so open dialogs pick up the change immediately.
     */
    set(this: HTMLDialogElement, value: string) {
      this.setAttribute("closedby", String(value));
    },
    enumerable: true,
    configurable: true,
  });
}

/* -------------------------------------------------------------------------- */
/* Polyfill entry point                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Applies the polyfill. Calling it again while it is active is a no‑op, and
 * so is calling it when the current engine already supports `closedBy`.
 * After {@link teardown}, calling it again re-activates the polyfill.
 */
export function apply(): void {
  if (polyfilled || isSupported()) return;

  // Non-DOM runtimes (SSR, Node): nothing to patch, nothing to report.
  if (typeof window === "undefined" || typeof document === "undefined") return;

  // Older WebKit versions ship *no* <dialog> implementation at all. Abort early
  // because patching non‑existent prototypes would throw.
  if (
    typeof HTMLDialogElement === "undefined" ||
    !("showModal" in HTMLDialogElement.prototype)
  ) {
    console.warn(
      "[closedBy polyfill] <dialog> API not found – polyfill skipped."
    );
    return;
  }

  if (!prototypesPatched) {
    // Another copy of the polyfill (e.g. the CommonJS build next to the ESM
    // build) is already in charge. Patching again would double every listener.
    if (isPolyfillGetterInstalled()) return;

    patchPrototypes();
    prototypesPatched = true;
  }

  polyfilled = true;

  /* Kick‑off global observers */
  setupObservers();
}

/**
 * Tears down the polyfill, removing all event listeners and observers.
 * After calling this function, the polyfill will no longer be active.
 *
 * Note: This does NOT restore the original `showModal`, `show`, or `closedBy`
 * implementations on the prototype. The patched `show` / `showModal` simply
 * stop wiring up listeners until {@link apply} is called again.
 */
export function teardown(): void {
  if (!polyfilled) return;
  teardownObservers();
  polyfilled = false;
}
