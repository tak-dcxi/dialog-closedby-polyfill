// src/listeners.ts
var dialogStates = /* @__PURE__ */ new WeakMap();
var activeDialogs = /* @__PURE__ */ new Set();
var modalFallback = /* @__PURE__ */ new WeakMap();
var authorRequestCloseDepth = 0;
function markModal(dialog, modal) {
  modalFallback.set(dialog, modal);
}
function isModal(dialog) {
  try {
    return dialog.matches(":modal");
  } catch {
    return modalFallback.get(dialog) === true;
  }
}
function getComputedClosedBy(dialog) {
  const raw = dialog.getAttribute("closedby")?.toLowerCase();
  if (raw === "any" || raw === "closerequest" || raw === "none") return raw;
  return isModal(dialog) ? "closerequest" : "none";
}
function runAuthorRequestClose(fn) {
  authorRequestCloseDepth++;
  try {
    return fn();
  } finally {
    authorRequestCloseDepth--;
  }
}
function requestCloseCompat(dialog) {
  const nativeRequestClose = dialog.requestClose;
  if (typeof nativeRequestClose === "function" && isModal(dialog)) {
    nativeRequestClose.call(dialog);
    return;
  }
  const notCanceled = dialog.dispatchEvent(
    new Event("cancel", { bubbles: false, cancelable: true })
  );
  if (notCanceled && dialog.open) dialog.close();
}
function isClickInsideDialog(dialog, x, y) {
  const rect = dialog.getBoundingClientRect();
  return rect.top < y && y < rect.bottom && rect.left < x && x < rect.right;
}
function isTopMost(dialog) {
  return getTopMostDialog() === dialog;
}
function getTopMostDialog() {
  let last;
  for (const dialog of activeDialogs) {
    last = dialog;
  }
  return last;
}
var escapeHandlerRegistered = false;
function documentEscapeHandler(event) {
  if (event.key !== "Escape" || event.isComposing || event.defaultPrevented) {
    return;
  }
  const topDialog = getTopMostDialog();
  if (!topDialog || !topDialog.open) return;
  const closedBy = getComputedClosedBy(topDialog);
  if (isModal(topDialog)) {
    if (closedBy === "none") event.preventDefault();
    return;
  }
  if (closedBy === "none") return;
  event.preventDefault();
  requestCloseCompat(topDialog);
}
function registerEscapeHandler() {
  if (escapeHandlerRegistered) return;
  document.addEventListener("keydown", documentEscapeHandler);
  escapeHandlerRegistered = true;
}
function unregisterEscapeHandler() {
  if (!escapeHandlerRegistered) return;
  document.removeEventListener("keydown", documentEscapeHandler);
  escapeHandlerRegistered = false;
}
function detachAllDialogs() {
  const dialogs = Array.from(activeDialogs);
  dialogs.forEach(detachDialog);
}
function createLightDismissHandler(dialog) {
  return function handleDocumentClick(event) {
    const state = dialogStates.get(dialog);
    if (state) {
      if (event.timeStamp <= state.openedAt) return;
      const target = event.target;
      if (dialog.contains(target)) return;
    }
    if (!isTopMost(dialog) || getComputedClosedBy(dialog) !== "any" || !dialog.open) {
      return;
    }
    if (!isClickInsideDialog(dialog, event.clientX, event.clientY)) {
      requestCloseCompat(dialog);
    }
  };
}
function createClickHandler(dialog) {
  return function handleClick(event) {
    const state = dialogStates.get(dialog);
    if (state && event.timeStamp <= state.openedAt) return;
    if (event.target !== dialog) return;
    if (getComputedClosedBy(dialog) !== "any") return;
    if (!isClickInsideDialog(dialog, event.clientX, event.clientY)) {
      requestCloseCompat(dialog);
    }
  };
}
function createCancelHandler(dialog) {
  return function handleCancel(event) {
    if (authorRequestCloseDepth > 0) return;
    if (getComputedClosedBy(dialog) === "none") {
      event.preventDefault();
    }
  };
}
function isAttached(dialog) {
  return dialogStates.has(dialog);
}
function attachDialog(dialog) {
  if (dialogStates.has(dialog)) {
    const state2 = dialogStates.get(dialog);
    state2.openedAt = performance.now();
    activeDialogs.delete(dialog);
    activeDialogs.add(dialog);
    return;
  }
  const state = {
    handleClick: createClickHandler(dialog),
    handleDocClick: createLightDismissHandler(dialog),
    handleCancel: createCancelHandler(dialog),
    // The close event is queued, so the dialog may already have been
    // reopened by the time it fires. Keep the listeners in that case.
    handleClose: () => {
      if (!dialog.open) detachDialog(dialog);
    },
    /**
     * Timestamp when the dialog was opened.
     * Uses performance.now() which shares the same time origin as event.timeStamp
     * in modern browsers (DOMHighResTimeStamp).
     */
    openedAt: performance.now()
  };
  dialog.addEventListener("click", state.handleClick);
  dialog.addEventListener("cancel", state.handleCancel);
  dialog.addEventListener("close", state.handleClose);
  document.addEventListener("click", state.handleDocClick, true);
  activeDialogs.add(dialog);
  dialogStates.set(dialog, state);
}
function detachDialog(dialog) {
  const state = dialogStates.get(dialog);
  if (!state) return;
  dialog.removeEventListener("click", state.handleClick);
  dialog.removeEventListener("cancel", state.handleCancel);
  dialog.removeEventListener("close", state.handleClose);
  document.removeEventListener("click", state.handleDocClick, true);
  activeDialogs.delete(dialog);
  dialogStates.delete(dialog);
}

// src/observer.ts
var observers = /* @__PURE__ */ new Map();
var originalAttachShadow = null;
function attachIfOpen(node) {
  if (node instanceof HTMLDialogElement && node.open && !isAttached(node)) {
    attachDialog(node);
  }
}
function observeRoot(root) {
  if (observers.has(root)) return;
  root.querySelectorAll("dialog").forEach(attachIfOpen);
  const rootObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === "attributes") {
        const node = m.target;
        if (node instanceof HTMLDialogElement) {
          if (node.open) attachIfOpen(node);
          else detachDialog(node);
        }
        continue;
      }
      m.removedNodes.forEach((node) => {
        if (node instanceof HTMLDialogElement) detachDialog(node);
        if (node instanceof Element)
          node.querySelectorAll("dialog").forEach(detachDialog);
      });
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
      attributeFilter: ["open"]
    });
    observers.set(root, rootObserver);
  }
}
function findShadowRoots(el) {
  const out = [];
  if (el.shadowRoot) out.push(el.shadowRoot);
  for (const child of Array.from(el.children))
    out.push(...findShadowRoots(child));
  return out;
}
function patchAttachShadow() {
  originalAttachShadow = HTMLElement.prototype.attachShadow;
  const cached = originalAttachShadow;
  HTMLElement.prototype.attachShadow = function attachShadowPatched(init) {
    const shadowRoot = cached.call(this, init);
    observeRoot(shadowRoot);
    return shadowRoot;
  };
}
function unpatchAttachShadow() {
  if (originalAttachShadow) {
    HTMLElement.prototype.attachShadow = originalAttachShadow;
    originalAttachShadow = null;
  }
}
function initializeObservers() {
  registerEscapeHandler();
  observeRoot(document);
  if (document.body) {
    findShadowRoots(document.body).forEach(observeRoot);
  }
  patchAttachShadow();
}
function setupObservers() {
  if (document.body) {
    initializeObservers();
  } else {
    document.addEventListener("DOMContentLoaded", initializeObservers, {
      once: true
    });
  }
}
function teardownObservers() {
  observers.forEach((observer) => observer.disconnect());
  observers.clear();
  unpatchAttachShadow();
  unregisterEscapeHandler();
  detachAllDialogs();
}

// src/fn.ts
var POLYFILL_MARK = Symbol.for("dialog-closedby-polyfill");
var polyfilled = false;
var prototypesPatched = false;
function isPolyfillGetterInstalled() {
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLDialogElement.prototype,
    "closedBy"
  );
  const getter = descriptor?.get;
  return getter?.[POLYFILL_MARK] === true;
}
function isSupported() {
  if (typeof HTMLDialogElement === "undefined" || typeof HTMLDialogElement.prototype !== "object" || !("closedBy" in HTMLDialogElement.prototype)) {
    return false;
  }
  if (isPolyfillGetterInstalled()) return false;
  if (typeof document === "undefined" || typeof document.createElement !== "function") {
    return false;
  }
  try {
    const testDialog = document.createElement("dialog");
    testDialog.setAttribute("closedby", "none");
    return testDialog.closedBy === "none";
  } catch {
    return false;
  }
}
function isPolyfilled() {
  return polyfilled;
}
function patchPrototypes() {
  const originalShowModal = HTMLDialogElement.prototype.showModal;
  const originalShow = HTMLDialogElement.prototype.show;
  HTMLDialogElement.prototype.showModal = function showModalPatched() {
    originalShowModal.call(this);
    if (!this.open || !polyfilled) return;
    markModal(this, true);
    attachDialog(this);
  };
  HTMLDialogElement.prototype.show = function showPatched() {
    originalShow.call(this);
    if (!this.open || !polyfilled) return;
    markModal(this, false);
    attachDialog(this);
  };
  const proto = HTMLDialogElement.prototype;
  const originalRequestClose = proto.requestClose;
  if (typeof originalRequestClose === "function") {
    proto.requestClose = function requestClosePatched(...args) {
      runAuthorRequestClose(() => originalRequestClose.apply(this, args));
    };
  }
  const get = function getClosedBy() {
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
    set(value) {
      this.setAttribute("closedby", String(value));
    },
    enumerable: true,
    configurable: true
  });
}
function apply() {
  if (polyfilled || isSupported()) return;
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (typeof HTMLDialogElement === "undefined" || !("showModal" in HTMLDialogElement.prototype)) {
    console.warn(
      "[closedBy polyfill] <dialog> API not found \u2013 polyfill skipped."
    );
    return;
  }
  if (!prototypesPatched) {
    if (isPolyfillGetterInstalled()) return;
    patchPrototypes();
    prototypesPatched = true;
  }
  polyfilled = true;
  setupObservers();
}
function teardown() {
  if (!polyfilled) return;
  teardownObservers();
  polyfilled = false;
}
export {
  apply,
  isPolyfilled,
  isSupported,
  teardown
};
