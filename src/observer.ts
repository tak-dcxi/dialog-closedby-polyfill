import { attachDialog, detachDialog } from "./listeners.js";

/**
 * Sets up a tree‑wide observer for a given {@link Document | ShadowRoot}. It
 * reacts to the following events:
 *
 *  1. A *closedBy*‑decorated dialog is **added** → `attachDialog()`.
 *  2. Such a dialog is **removed** from the subtree → `detachDialog()`.
 *  3. The dialog’s `open` attribute flips while it remains in the tree
 *     (handled via patched `showModal` / `close`).
 */
export function observeRoot(root: Document | ShadowRoot): void {
  /* Bootstrap existing instances */
  root.querySelectorAll("dialog[closedby]").forEach((d) => {
    if (d instanceof HTMLDialogElement && d.open) attachDialog(d);
  });

  const rootObserver = new MutationObserver((mutations) => {
    mutations.forEach((m) => {
      /* Handle added nodes */
      m.addedNodes.forEach((node) => {
        if (
          node instanceof HTMLDialogElement &&
          node.open &&
          node.hasAttribute("closedby")
        ) {
          attachDialog(node);
        }
        if (node instanceof Element) {
          node.querySelectorAll("dialog[closedby]").forEach((d) => {
            if (d instanceof HTMLDialogElement && d.open) attachDialog(d);
          });
        }
      });

      /* Handle removed nodes */
      m.removedNodes.forEach((node) => {
        if (node instanceof HTMLDialogElement) detachDialog(node);
        if (node instanceof Element)
          node.querySelectorAll("dialog").forEach(detachDialog);
      });
    });
  });

  const observedTarget = root === document ? document.body : root;
  rootObserver.observe(observedTarget, { childList: true, subtree: true });
}

/** Recursively collects every ShadowRoot below a given element. */
function findShadowRoots(el: Element): ShadowRoot[] {
  const out: ShadowRoot[] = [];
  if (el.shadowRoot) out.push(el.shadowRoot);
  for (const child of Array.from(el.children))
    out.push(...findShadowRoots(child));
  return out;
}

/**
 * Initializes observation for the document *and* all current / future
 * ShadowRoots. This is invoked once from {@link apply}.
 */
export function setupObservers(): void {
  observeRoot(document);

  /* Existing ShadowRoots (static page load) */
  if (document.body) findShadowRoots(document.body).forEach(observeRoot);

  /* Future ShadowRoots created via attachShadow() */
  const originalAttachShadow = HTMLElement.prototype.attachShadow;
  HTMLElement.prototype.attachShadow = function attachShadowPatched(
    init: ShadowRootInit
  ): ShadowRoot {
    const shadowRoot = originalAttachShadow.call(this, init);
    observeRoot(shadowRoot);
    return shadowRoot;
  };
}
