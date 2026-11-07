import {
  attachDialog,
  detachDialog,
  isAttached,
  registerEscapeHandler,
  unregisterEscapeHandler,
  detachAllDialogs,
} from "./listeners.js";

/** Stores all active MutationObservers for cleanup. */
const observers = new Map<Document | ShadowRoot, MutationObserver>();

/** Stores the original attachShadow method for restoration. */
let originalAttachShadow: typeof HTMLElement.prototype.attachShadow | null = null;

/** Attaches listeners to an open dialog unless it is already tracked. */
function attachIfOpen(node: Node): void {
  if (node instanceof HTMLDialogElement && node.open && !isAttached(node)) {
    attachDialog(node);
  }
}

/**
 * Sets up a tree‑wide observer for a given {@link Document | ShadowRoot}. It
 * reacts to the following events:
 *
 *  1. An open dialog is **added** → `attachDialog()`.
 *  2. A dialog is **removed** from the subtree → `detachDialog()`.
 *  3. A dialog's `open` attribute flips while it remains in the tree. This
 *     covers dialogs opened without the patched `show()` / `showModal()`,
 *     such as native invoker commands (`command="show-modal"`).
 *
 * @see https://github.com/tak-dcxi/dialog-closedby-polyfill/issues/22
 */
export function observeRoot(root: Document | ShadowRoot): void {
  // Avoid duplicate observers for the same root
  if (observers.has(root)) return;
  /* Bootstrap existing instances */
  root.querySelectorAll("dialog").forEach(attachIfOpen);

  const rootObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      /* Handle a flipped `open` attribute */
      if (m.type === "attributes") {
        const node = m.target;
        if (node instanceof HTMLDialogElement) {
          if (node.open) attachIfOpen(node);
          else detachDialog(node);
        }
        continue;
      }

      /* Handle removed nodes */
      m.removedNodes.forEach((node) => {
        if (node instanceof HTMLDialogElement) detachDialog(node);
        if (node instanceof Element)
          node.querySelectorAll("dialog").forEach(detachDialog);
      });

      /* Handle added nodes */
      m.addedNodes.forEach((node) => {
        attachIfOpen(node);
        if (node instanceof Element) {
          node.querySelectorAll("dialog").forEach(attachIfOpen);
        }
      });
    }
  });

  const observedTarget = root === document ? document.body : root;
  if (observedTarget) {
    rootObserver.observe(observedTarget, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["open"],
    });
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
