// src/listeners.ts
var dialogStates = /* @__PURE__ */ new WeakMap();
function getClosedByValue(dialog) {
  const raw = dialog.getAttribute("closedby");
  return raw === "closerequest" || raw === "none" ? raw : "any";
}
var activeDialogs = /* @__PURE__ */ new Set();
function documentEscapeHandler(event) {
  if (event.key !== "Escape" || activeDialogs.size === 0) return;
  let shouldPreventDefault = false;
  let hasClosableDialog = false;
  const dialogsArray = Array.from(activeDialogs).reverse();
  for (const dialog of dialogsArray) {
    const closedBy = getClosedByValue(dialog);
    if (closedBy === "none") {
      shouldPreventDefault = true;
      break;
    } else if (closedBy === "any" || closedBy === "closerequest") {
      dialog.close();
      hasClosableDialog = true;
      break;
    }
  }
  if (shouldPreventDefault || hasClosableDialog) {
    event.preventDefault();
  }
}
document.addEventListener("keydown", documentEscapeHandler);
function createClickHandler(dialog) {
  return function handleClick(event) {
    if (event.target !== dialog) return;
    if (getClosedByValue(dialog) !== "any") return;
    const rect = dialog.getBoundingClientRect();
    const inside = rect.top < event.clientY && event.clientY < rect.bottom && rect.left < event.clientX && event.clientX < rect.right;
    if (!inside) dialog.close();
  };
}
function createCancelHandler(dialog) {
  return function handleCancel(event) {
    if (getClosedByValue(dialog) === "none") event.preventDefault();
  };
}
function attachDialog(dialog) {
  if (dialogStates.has(dialog)) return;
  const state = {
    handleEscape: documentEscapeHandler,
    handleClick: createClickHandler(dialog),
    handleCancel: createCancelHandler(dialog),
    attrObserver: new MutationObserver(() => {
    })
  };
  dialog.addEventListener("click", state.handleClick);
  dialog.addEventListener("cancel", state.handleCancel);
  state.attrObserver.observe(dialog, {
    attributes: true,
    attributeFilter: ["closedby"]
  });
  activeDialogs.add(dialog);
  dialogStates.set(dialog, state);
}
function detachDialog(dialog) {
  const state = dialogStates.get(dialog);
  if (!state) return;
  dialog.removeEventListener("click", state.handleClick);
  dialog.removeEventListener("cancel", state.handleCancel);
  state.attrObserver.disconnect();
  activeDialogs.delete(dialog);
  dialogStates.delete(dialog);
}

// src/observer.ts
function observeRoot(root) {
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
function findShadowRoots(el) {
  const out = [];
  if (el.shadowRoot) out.push(el.shadowRoot);
  for (const child of Array.from(el.children))
    out.push(...findShadowRoots(child));
  return out;
}
function setupObservers() {
  observeRoot(document);
  if (document.body) findShadowRoots(document.body).forEach(observeRoot);
  const originalAttachShadow = HTMLElement.prototype.attachShadow;
  HTMLElement.prototype.attachShadow = function attachShadowPatched(init) {
    const shadowRoot = originalAttachShadow.call(this, init);
    observeRoot(shadowRoot);
    return shadowRoot;
  };
}

// src/index.ts
var polyfilled = false;
function isSupported() {
  return typeof HTMLDialogElement !== "undefined" && typeof HTMLDialogElement.prototype === "object" && "closedBy" in HTMLDialogElement.prototype;
}
function isPolyfilled() {
  return polyfilled;
}
function apply() {
  "use strict";
  if (polyfilled || isSupported()) return;
  if (!("showModal" in HTMLDialogElement.prototype)) {
    console.warn(
      "[closedBy polyfill] <dialog> API not found \u2013 polyfill skipped."
    );
    return;
  }
  const originalShowModal = HTMLDialogElement.prototype.showModal;
  const originalClose = HTMLDialogElement.prototype.close;
  HTMLDialogElement.prototype.showModal = function showModalPatched() {
    originalShowModal.call(this);
    if (!this.open) return;
    if (this.hasAttribute("closedby")) attachDialog(this);
  };
  HTMLDialogElement.prototype.close = function closePatched(returnValue) {
    detachDialog(this);
    originalClose.call(this, returnValue);
  };
  Object.defineProperty(HTMLDialogElement.prototype, "closedBy", {
    get() {
      const v = this.getAttribute("closedby");
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
        if (this.hasAttribute("closedby")) {
          attachDialog(this);
        } else {
          detachDialog(this);
        }
      }
    },
    enumerable: true,
    configurable: true
  });
  setupObservers();
  polyfilled = true;
}
if (!isSupported()) apply();
export {
  apply,
  isPolyfilled,
  isSupported
};
