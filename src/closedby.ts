/**
 * HTMLDialogElement closedBy attribute polyfill
 * @see https://developer.mozilla.org/en-US/docs/Web/API/HTMLDialogElement/closedBy
 */

/* ------------------------------------------------------------------ */
/*  Type-level augmentation                                           */
/* ------------------------------------------------------------------ */
declare global {
  interface HTMLDialogElement {
    closedBy?: "any" | "closerequest" | "none";
  }
}

/* ------------------------------------------------------------------ */
/*  Public helpers                                                    */
/* ------------------------------------------------------------------ */
let polyfilled = false;

/** Returns true when closedBy is implemented natively. */
export function isSupported(): boolean {
  return (
    typeof HTMLDialogElement !== "undefined" &&
    typeof HTMLDialogElement.prototype === "object" &&
    "closedBy" in HTMLDialogElement.prototype
  );
}

/** Returns true when this polyfill has been applied. */
export function isPolyfilled(): boolean {
  return polyfilled;
}

/* ------------------------------------------------------------------ */
/*  Polyfill entry point                                              */
/* ------------------------------------------------------------------ */
export function apply(): void {
  "use strict";
  if (polyfilled || isSupported()) return; // guard against double-apply

  /* --------------------------------------------------------------- */
  /*  Internal state                                                 */
  /* --------------------------------------------------------------- */
  type ClosedBy = "any" | "closerequest" | "none";

  interface DialogListeners {
    handleEscape?: (e: KeyboardEvent) => void;
    handleClick?: (e: MouseEvent) => void;
    handleCancel?: (e: Event) => void;
  }

  /** Maps each dialog to its active listeners so we can detach them later. */
  const dialogStates = new WeakMap<HTMLDialogElement, DialogListeners>();

  /* Preserve original methods */
  const originalShowModal = HTMLDialogElement.prototype.showModal;
  const originalClose = HTMLDialogElement.prototype.close;

  /* --------------------------------------------------------------- */
  /*  Helper functions                                               */
  /* --------------------------------------------------------------- */
  /** Normalises the closedby attribute value. */
  function getClosedByValue(dialog: HTMLDialogElement): ClosedBy {
    const value = dialog.getAttribute("closedby");
    return value === "closerequest" || value === "none" ? value : "any";
  }

  /** Creates an Escape key handler for the given dialog. */
  function createEscapeHandler(dialog: HTMLDialogElement) {
    return function handleEscape(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      if (getClosedByValue(dialog) === "none") event.preventDefault();
    };
  }

  /** Creates a backdrop-click handler for the given dialog. */
  function createClickHandler(dialog: HTMLDialogElement) {
    return function handleClick(event: MouseEvent): void {
      if (event.target !== dialog) return; // ignore inner clicks
      if (getClosedByValue(dialog) !== "any") return;

      const rect = dialog.getBoundingClientRect();
      const clickedInside =
        rect.top <= event.clientY &&
        event.clientY <= rect.bottom &&
        rect.left <= event.clientX &&
        event.clientX <= rect.right;

      if (!clickedInside) dialog.close();
    };
  }

  /** Creates a cancel-event handler for the given dialog. */
  function createCancelHandler(dialog: HTMLDialogElement) {
    return function handleCancel(event: Event): void {
      if (getClosedByValue(dialog) === "none") event.preventDefault();
    };
  }

  /** Attaches listeners and stores them in WeakMap. */
  function setupEventListeners(dialog: HTMLDialogElement): void {
    removeEventListeners(dialog); // idempotent

    const state: DialogListeners = {
      handleEscape: createEscapeHandler(dialog),
      handleClick: createClickHandler(dialog),
      handleCancel: createCancelHandler(dialog),
    };

    document.addEventListener("keydown", state.handleEscape!);
    dialog.addEventListener("click", state.handleClick!);
    dialog.addEventListener("cancel", state.handleCancel!);

    dialogStates.set(dialog, state);
  }

  /** Detaches listeners and clears WeakMap entry. */
  function removeEventListeners(dialog: HTMLDialogElement): void {
    const state = dialogStates.get(dialog);
    if (!state) return;

    if (state.handleEscape)
      document.removeEventListener("keydown", state.handleEscape);
    if (state.handleClick)
      dialog.removeEventListener("click", state.handleClick);
    if (state.handleCancel)
      dialog.removeEventListener("cancel", state.handleCancel);

    dialogStates.delete(dialog);
  }

  /* --------------------------------------------------------------- */
  /*  Method overrides                                               */
  /* --------------------------------------------------------------- */
  HTMLDialogElement.prototype.showModal = function (): void {
    originalShowModal.call(this);

    /**
     * Guard: showModal() may fail (e.g. detached element).
     * When it does, `open` is false and we must not attach listeners.
     */
    if (!this.open) return;

    if (this.hasAttribute("closedby")) setupEventListeners(this);
  };

  HTMLDialogElement.prototype.close = function (returnValue?: string): void {
    removeEventListeners(this);
    originalClose.call(this, returnValue);
  };

  /* --------------------------------------------------------------- */
  /*  closedBy property                                              */
  /* --------------------------------------------------------------- */
  Object.defineProperty(HTMLDialogElement.prototype, "closedBy", {
    get(): ClosedBy {
      return getClosedByValue(this);
    },
    set(value: ClosedBy) {
      if (value === "any" || value === "closerequest" || value === "none") {
        this.setAttribute("closedby", value);
      } else {
        this.removeAttribute("closedby");
      }

      /* Keep listeners in sync with current state */
      if (this.open) {
        setupEventListeners(this);
      } else {
        removeEventListeners(this); // ← added: avoid dangling listeners
      }
    },
    enumerable: true,
    configurable: true,
  });

  /* --------------------------------------------------------------- */
  /*  Observers                                                      */
  /* --------------------------------------------------------------- */
  /** Watches the closedby attribute on each <dialog>. */
  const attrObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (
        mutation.type === "attributes" &&
        mutation.attributeName === "closedby"
      ) {
        const dialog = mutation.target as HTMLDialogElement;
        if (dialog.open && dialog.hasAttribute("closedby")) {
          setupEventListeners(dialog);
        } else {
          removeEventListeners(dialog);
        }
      }
    });
  });

  /**
   * Sets up MutationObserver for a given root (Document or ShadowRoot):
   *   • attributes: watch closedby changes
   *   • childList : attach / detach listeners for added or removed dialogs
   */
  function setupMutationObserver(root: Document | ShadowRoot): void {
    /* Observe all existing dialogs in this root */
    root.querySelectorAll("dialog").forEach((dialog) => {
      attrObserver.observe(dialog, {
        attributes: true,
        attributeFilter: ["closedby"],
      });
    });

    /* Watch for additions AND removals */
    const rootObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        /* Added nodes */
        mutation.addedNodes.forEach((node) => {
          if (node instanceof HTMLDialogElement) {
            attrObserver.observe(node, {
              attributes: true,
              attributeFilter: ["closedby"],
            });
          }
          if (node instanceof Element) {
            node.querySelectorAll("dialog").forEach((dialog) => {
              attrObserver.observe(dialog, {
                attributes: true,
                attributeFilter: ["closedby"],
              });
            });
          }
        });

        /* Removed nodes → detach listeners to avoid leaks */
        mutation.removedNodes.forEach((node) => {
          if (node instanceof HTMLDialogElement) {
            removeEventListeners(node);
          }
          if (node instanceof Element) {
            node.querySelectorAll("dialog").forEach((dialog) => {
              removeEventListeners(dialog);
            });
          }
        });
      });
    });

    const rootElement = root === document ? document.body : root;
    rootObserver.observe(rootElement, {
      childList: true,
      subtree: true,
    });
  }

  /**
   * Finds ShadowRoots recursively under a given element.
   */
  function findShadowRoots(el: Element): ShadowRoot[] {
    const roots: ShadowRoot[] = [];
    if (el.shadowRoot) roots.push(el.shadowRoot);
    for (const child of Array.from(el.children)) {
      roots.push(...findShadowRoots(child));
    }
    return roots;
  }

  /**
   * Sets up observers for existing and future ShadowRoots.
   */
  function setupShadowRootObservation(): void {
    /* Existing ShadowRoots */
    if (document.body) {
      findShadowRoots(document.body).forEach(setupMutationObserver);
    }

    /* Future ShadowRoots */
    const originalAttachShadow = HTMLElement.prototype.attachShadow;
    HTMLElement.prototype.attachShadow = function (
      init: ShadowRootInit
    ): ShadowRoot {
      const shadowRoot = originalAttachShadow.call(this, init);
      setupMutationObserver(shadowRoot);
      return shadowRoot;
    };
  }

  /* --------------------------------------------------------------- */
  /*  Initialize                                                     */
  /* --------------------------------------------------------------- */
  function init(): void {
    setupMutationObserver(document);
    setupShadowRootObservation();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  polyfilled = true;
}
