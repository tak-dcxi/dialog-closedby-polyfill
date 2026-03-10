import { attachDialog, detachDialog, registerEscapeHandler, unregisterEscapeHandler, detachAllDialogs } from "./listeners.js";

/** Stores all active MutationObservers for cleanup. */
const observers = new Map<Document | ShadowRoot, MutationObserver>();

/** Stores the original attachShadow method for restoration. */
let originalAttachShadow: typeof HTMLElement.prototype.attachShadow | null = null;

/**
 * Sets up a tree‑wide observer for a given {@link Document | ShadowRoot}. It
 * reacts to the following events:
 *
 *  1. A *closedBy*‑decorated dialog is **added** → `attachDialog()`.
 *  2. Such a dialog is **removed** from the subtree → `detachDialog()`.
 *  3. The dialog's `open` attribute flips while it remains in the tree
 *     (handled via patched `showModal` / `show` / `close`).
 */
export function observeRoot(root: Document | ShadowRoot): void {
  // Avoid duplicate observers for the same root
  if (observers.has(root)) return;
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

      /* Handle changed open attribute */
      mutations.forEach(async m => {
        if (m.attributeName === 'open') {
          const node = m.target;
          if (
            node instanceof HTMLDialogElement &&
            node.open &&
            node.hasAttribute("closedby")
          ) {
            attachDialog(node);
          }
        }
      })

      /* Handle removed nodes */
      m.removedNodes.forEach((node) => {
        if (node instanceof HTMLDialogElement) detachDialog(node);
        if (node instanceof Element)
          node.querySelectorAll("dialog").forEach(detachDialog);
      });
    });
  });

  const observedTarget = root === document ? document.body : root;
  if (observedTarget) {
    rootObserver.observe(observedTarget, { childList: true, subtree: true, attributes: true, attributeFilter: ["open"] });
    observers.set(root, rootObserver);
  }
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
 * Patches `HTMLElement.prototype.attachShadow` to automatically observe
 * new shadow roots for dialog elements.
 */
function patchAttachShadow(): void {
  // Store original for potential restoration
  originalAttachShadow = HTMLElement.prototype.attachShadow;
  const cached = originalAttachShadow;
  HTMLElement.prototype.attachShadow = function attachShadowPatched(
    init: ShadowRootInit
  ): ShadowRoot {
    const shadowRoot = cached.call(this, init);
    observeRoot(shadowRoot);
    return shadowRoot;
  };
}

/**
 * Restores the original `attachShadow` method if it was patched.
 */
function unpatchAttachShadow(): void {
  if (originalAttachShadow) {
    HTMLElement.prototype.attachShadow = originalAttachShadow;
    originalAttachShadow = null;
  }
}

/**
 * Initializes all observers after ensuring DOM is ready.
 */
function initializeObservers(): void {
  // Register the global escape key handler
  registerEscapeHandler();

  // Observe the main document
  observeRoot(document);

  // Observe existing shadow roots (from static page load)
  if (document.body) {
    findShadowRoots(document.body).forEach(observeRoot);
  }

  // Patch attachShadow for future shadow roots
  patchAttachShadow();
}

/**
 * Initializes observation for the document *and* all current / future
 * ShadowRoots. This is invoked once from {@link apply}.
 *
 * If `document.body` is not yet available (e.g., script in `<head>`),
 * initialization is deferred until `DOMContentLoaded`.
 */
export function setupObservers(): void {
  if (document.body) {
    initializeObservers();
  } else {
    document.addEventListener("DOMContentLoaded", initializeObservers, {
      once: true,
    });
  }
}

/**
 * Disconnects all MutationObservers and restores the original `attachShadow`.
 * This is called during polyfill teardown to clean up all observers.
 */
export function teardownObservers(): void {
  observers.forEach((observer) => observer.disconnect());
  observers.clear();
  unpatchAttachShadow();
  unregisterEscapeHandler();
  detachAllDialogs();
}
