// src/listeners.ts
var dialogStates = /* @__PURE__ */ new WeakMap();
function getClosedByValue(dialog) {
  const raw = dialog.getAttribute("closedby")?.toLowerCase();
  return raw === "closerequest" || raw === "none" ? raw : "any";
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
var activeDialogs = /* @__PURE__ */ new Set();
var escapeHandlerRegistered = false;
function documentEscapeHandler(event) {
  if (event.key !== "Escape" || activeDialogs.size === 0) return;
  const topDialog = getTopMostDialog();
  if (!topDialog) return;
  const closedBy = getClosedByValue(topDialog);
  if (closedBy === "none") {
    event.preventDefault();
  }
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
    if (!isTopMost(dialog) || getClosedByValue(dialog) !== "any" || !dialog.open) {
      return;
    }
    if (!isClickInsideDialog(dialog, event.clientX, event.clientY)) {
      const notCancelled = dialog.dispatchEvent(new Event("cancel", { bubbles: false, cancelable: true }));
      if (notCancelled) {
        dialog.close();
      }
    }
  };
}
function createClickHandler(dialog) {
  return function handleClick(event) {
    const state = dialogStates.get(dialog);
    if (state && event.timeStamp <= state.openedAt) return;
    if (event.target !== dialog) return;
    if (getClosedByValue(dialog) !== "any") return;
    if (!isClickInsideDialog(dialog, event.clientX, event.clientY)) {
      dialog.close();
    }
  };
}
function createCancelHandler(dialog) {
  return function handleCancel(event) {
    if (getClosedByValue(dialog) === "none") {
      event.preventDefault();
    }
  };
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
    handleClose: () => detachDialog(dialog),
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
function observeRoot(root) {
  if (observers.has(root)) return;
  root.querySelectorAll("dialog[closedby]").forEach((d) => {
    if (d instanceof HTMLDialogElement && d.open) attachDialog(d);
  });
  const rootObserver = new MutationObserver((mutations) => {
    mutations.forEach((m) => {
      m.addedNodes.forEach((node) => {
        if (node instanceof HTMLDialogElement && node.open && node.hasAttribute("closedby")) {
          attachDialog(node);
        }
        if (node instanceof Element) {
          node.querySelectorAll("dialog[closedby]").forEach((d) => {
            if (d instanceof HTMLDialogElement && d.open) attachDialog(d);
          });
        }
      });
      mutations.forEach(async (m2) => {
        if (m2.attributeName === "open") {
          const node = m2.target;
          if (node instanceof HTMLDialogElement && node.open && node.hasAttribute("closedby")) {
            attachDialog(node);
          }
        }
      });
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

// src/dialog-closedby.ts
function isSupported() {
  if (typeof HTMLDialogElement === "undefined" || typeof HTMLDialogElement.prototype !== "object" || !("closedBy" in HTMLDialogElement.prototype)) {
    return false;
  }
  if (typeof document === "undefined" || typeof document.createElement !== "function") {
    return false;
  }
  try {
    const testDialog = document.createElement("dialog");
    return testDialog.closedBy === "none";
  } catch {
    return false;
  }
}
function isPolyfilled() {
  const firstDialog = document.querySelector("dialog")?.showModal;
  return firstDialog ? Boolean(
    !/native code/i.test(firstDialog.toString())
  ) : null;
}
function apply() {
  if (isPolyfilled() || isSupported()) return;
  if (!("showModal" in HTMLDialogElement.prototype)) {
    console.warn(
      "[closedBy polyfill] <dialog> API not found \u2013 polyfill skipped."
    );
    return;
  }
  const originalShowModal = HTMLDialogElement.prototype.showModal;
  const originalShow = HTMLDialogElement.prototype.show;
  HTMLDialogElement.prototype.showModal = function showModalPatched() {
    originalShowModal.call(this);
    if (!this.open) return;
    if (this.hasAttribute("closedby")) attachDialog(this);
  };
  HTMLDialogElement.prototype.show = function showPatched() {
    originalShow.call(this);
    if (!this.open) return;
    if (this.hasAttribute("closedby")) attachDialog(this);
  };
  Object.defineProperty(HTMLDialogElement.prototype, "closedBy", {
    get() {
      const v = this.getAttribute("closedby")?.toLowerCase();
      return v === "closerequest" || v === "none" ? v : "any";
    },
    set(value) {
      if (value === "any" || value === "closerequest" || value === "none") {
        this.setAttribute("closedby", value);
      } else {
        console.warn(
          `[closedBy polyfill] Invalid value '${value}'. Falling back to 'any'.`
        );
        this.setAttribute("closedby", "any");
      }
      if (this.open) {
        attachDialog(this);
      }
    },
    enumerable: true,
    configurable: true
  });
  setupObservers();
}
function teardown() {
  if (!isPolyfilled()) return;
  teardownObservers();
}
export {
  apply,
  isPolyfilled,
  isSupported,
  teardown
};
