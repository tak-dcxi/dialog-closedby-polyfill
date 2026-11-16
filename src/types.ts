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
 * Internal record that bundles together every handler attached to
 * a particular `<dialog>` element. Storing these in a {@link WeakMap} allows
 * for automatic garbage collection once the dialog node leaves the document
 * tree.
 */
export interface DialogListeners {
  /** `cancel` event handler installed on the dialog element. */
  handleCancel: (event: Event) => void;

  /** `close` event handler that triggers cleanup when the dialog closes. */
  handleClose: () => void;
}
