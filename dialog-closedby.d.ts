/**
 * The set of legal values for the {@link HTMLDialogElement.closedBy | closedBy}
 * attribute / property.
 *
 *  * `"any"`           – Allow all closing interactions (default).
 *  * `"closerequest"` – Ignore backdrop clicks, allow <kbd>Escape</kbd> &
 *                        `close()` calls.
 *  * `"none"`          – Disallow backdrop clicks *and* <kbd>Escape</kbd>.
 */
export type ClosedBy = "any" | "closerequest" | "none";

/**
 * Detects native support for the `closedBy` property. If this function returns
 * `true`, **no** polyfill is needed because the user‑agent already exposes
 * the expected behavior.
 */
export function isSupported(): boolean;

/** Returns `true` once {@link apply} has run successfully. */
export function isPolyfilled(): boolean;

/**
 * Applies the polyfill exactly **once**. Re‑invocations are ignored. When the
 * current engine already supports `closedBy`, the function becomes a no‑op as
 * well.
 */
export function apply(): void;

/**
 * Tears down the polyfill, removing all event listeners and observers.
 * After calling this function, the polyfill will no longer be active.
 *
 * Note: This does NOT restore the original `showModal`, `show`, or `closedBy`
 * implementations on the prototype. It only cleans up observers and listeners.
 */
export function teardown(): void;

declare global {
  interface HTMLDialogElement {
    closedBy: ClosedBy;
  }
}
