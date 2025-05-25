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
 * Internal record that bundles together every handler and observer attached to
 * a particular `<dialog>` element. Storing these in a {@link WeakMap} allows
 * for automatic garbage collection once the dialog node leaves the document
 * tree.
 */
export interface DialogListeners {
  /**
   * Document-level `keydown` handler shared by all open modal dialogs. It is
   * stored redundantly in every record so that we can remove it conditionally
   * when the last dialog closes.
   */
  handleEscape: (event: KeyboardEvent) => void;

  /** Mouse click handler installed on the dialog element. */
  handleClick: (event: MouseEvent) => void;

  /** Document-level click handler that detects backdrop clicks even when backdrop has display: none. */
  handleDocClick: (e: MouseEvent) => void;

  /** `cancel` event handler installed on the dialog element. */
  handleCancel: (event: Event) => void;

  /**
   * Attribute observer that tracks runtime changes to `closedby`. Each dialog
   * owns its individual observer instance so that `disconnect()` can be called
   * deterministically on `close()`.
   */
  attrObserver: MutationObserver;
}
