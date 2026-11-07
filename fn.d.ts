/**
 * The set of legal values for the {@link HTMLDialogElement.closedBy | closedBy}
 * attribute / property.
 *
 *  * `"any"`           – Allow all closing interactions.
 *  * `"closerequest"` – Ignore backdrop clicks, allow <kbd>Escape</kbd> &
 *                        `close()` calls.
 *  * `"none"`          – Disallow backdrop clicks *and* <kbd>Escape</kbd>.
 *
 * A missing or invalid attribute is the *Auto* state: `closedBy` then reads
 * `"closerequest"` for modal dialogs and `"none"` for modeless ones.
 */
export type ClosedBy = "any" | "closerequest" | "none";

/**
 * Detects native support for the `closedBy` property. If this function returns
 * `true`, **no** polyfill is needed because the user‑agent already exposes
 * the expected behavior. It keeps returning `false` after the polyfill has
 * been applied.
 */
export function isSupported(): boolean;

/** Returns `true` once {@link apply} has run successfully (and until {@link teardown}). */
export function isPolyfilled(): boolean;

/**
 * Applies the polyfill. Calling it again while it is active is a no‑op, and
 * so is calling it when the current engine already supports `closedBy`.
 * After {@link teardown}, calling it again re-activates the polyfill.
 */
export function apply(): void;

/**
 * Tears down the polyfill, removing all event listeners and observers.
 * After calling this function, the polyfill will no longer be active.
 *
 * Note: This does NOT restore the original `showModal`, `show`, or `closedBy`
 * implementations on the prototype. The patched `show` / `showModal` simply
 * stop wiring up listeners until {@link apply} is called again.
 */
export function teardown(): void;

declare global {
  interface HTMLDialogElement {
    closedBy: ClosedBy;
  }
}
