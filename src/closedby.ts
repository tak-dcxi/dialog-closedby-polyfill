/**
 * HTMLDialogElement closedBy attribute polyfill
 * @see https://developer.mozilla.org/en-US/docs/Web/API/HTMLDialogElement/closedBy
 */

// TypeScript type extensions
declare global {
  interface HTMLDialogElement {
    closedBy?: "any" | "closerequest" | "none";
  }
}

// Track if polyfill has been applied
let polyfilled = false;

/**
 * Check if closedBy attribute is natively supported
 * @returns true if closedBy is natively supported, false otherwise
 */
export function isSupported(): boolean {
  return (
    typeof HTMLDialogElement !== "undefined" &&
    typeof HTMLDialogElement.prototype === "object" &&
    "closedBy" in HTMLDialogElement.prototype
  );
}

/**
 * Check if the polyfill has been applied
 * @returns true if the polyfill has been applied, false otherwise
 */
export function isPolyfilled(): boolean {
  return polyfilled;
}

/**
 * Apply the closedBy polyfill
 */
export function apply(): void {
  "use strict";

  // Prevent applying multiple times
  if (polyfilled || isSupported()) {
    return;
  }

  // WeakMap to manage dialog states
  const dialogStates = new WeakMap<
    HTMLDialogElement,
    {
      handleEscape?: (event: KeyboardEvent) => void;
      handleClick?: (event: MouseEvent) => void;
      handleCancel?: (event: Event) => void;
    }
  >();

  // Store original methods
  const originalShowModal = HTMLDialogElement.prototype.showModal;
  const originalClose = HTMLDialogElement.prototype.close;

  /**
   * Get the value of closedBy attribute
   * @param dialog - Target dialog element
   * @returns Value of closedBy attribute (default is 'any')
   */
  function getClosedByValue(
    dialog: HTMLDialogElement
  ): "any" | "closerequest" | "none" {
    const value = dialog.getAttribute("closedby");
    if (value === "closerequest" || value === "none") {
      return value;
    }
    return "any";
  }

  /**
   * Create ESC key handler
   * @param dialog - Target dialog element
   * @returns Event handler function
   */
  function createEscapeHandler(dialog: HTMLDialogElement) {
    return function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;

      const closedBy = getClosedByValue(dialog);
      if (closedBy === "none") {
        event.preventDefault();
      }
    };
  }

  /**
   * Create backdrop click handler
   * @param dialog - Target dialog element
   * @returns Event handler function
   */
  function createClickHandler(dialog: HTMLDialogElement) {
    return function handleClick(event: MouseEvent) {
      // Only handle clicks on the dialog element itself (backdrop area)
      if (event.target !== dialog) return;

      const closedBy = getClosedByValue(dialog);
      if (closedBy === "any") {
        // Detect clicks on ::backdrop pseudo-element
        const rect = dialog.getBoundingClientRect();
        const clickedInDialog =
          rect.top <= event.clientY &&
          event.clientY <= rect.bottom &&
          rect.left <= event.clientX &&
          event.clientX <= rect.right;

        if (!clickedInDialog) {
          dialog.close();
        }
      }
    };
  }

  /**
   * Create cancel event handler
   * @param dialog - Target dialog element
   * @returns Event handler function
   */
  function createCancelHandler(dialog: HTMLDialogElement) {
    return function handleCancel(event: Event) {
      const closedBy = getClosedByValue(dialog);
      if (closedBy === "none") {
        event.preventDefault();
      }
    };
  }

  /**
   * Setup event listeners
   * @param dialog - Target dialog element
   */
  function setupEventListeners(dialog: HTMLDialogElement) {
    // Remove existing listeners if any
    removeEventListeners(dialog);

    const handleEscape = createEscapeHandler(dialog);
    const handleClick = createClickHandler(dialog);
    const handleCancel = createCancelHandler(dialog);

    // Register event listeners
    document.addEventListener("keydown", handleEscape);
    dialog.addEventListener("click", handleClick);
    dialog.addEventListener("cancel", handleCancel);

    // Store in WeakMap
    dialogStates.set(dialog, {
      handleEscape,
      handleClick,
      handleCancel,
    });
  }

  /**
   * Remove event listeners
   * @param dialog - Target dialog element
   */
  function removeEventListeners(dialog: HTMLDialogElement) {
    const state = dialogStates.get(dialog);
    if (!state) return;

    if (state.handleEscape) {
      document.removeEventListener("keydown", state.handleEscape);
    }
    if (state.handleClick) {
      dialog.removeEventListener("click", state.handleClick);
    }
    if (state.handleCancel) {
      dialog.removeEventListener("cancel", state.handleCancel);
    }

    dialogStates.delete(dialog);
  }

  // Override showModal() method
  HTMLDialogElement.prototype.showModal = function () {
    // Call original method
    originalShowModal.call(this);

    // Setup event listeners only if closedby attribute is present
    if (this.hasAttribute("closedby")) {
      setupEventListeners(this);
    }
  };

  // Override close() method
  HTMLDialogElement.prototype.close = function (returnValue?: string) {
    // Remove event listeners
    removeEventListeners(this);

    // Call original method
    originalClose.call(this, returnValue);
  };

  // Define closedBy property getter/setter
  Object.defineProperty(HTMLDialogElement.prototype, "closedBy", {
    get: function () {
      return getClosedByValue(this);
    },
    set: function (value: "any" | "closerequest" | "none") {
      if (value === "any" || value === "closerequest" || value === "none") {
        this.setAttribute("closedby", value);
      } else {
        this.removeAttribute("closedby");
      }

      // Update event listeners if dialog is open
      if (this.open) {
        setupEventListeners(this);
      }
    },
    enumerable: true,
    configurable: true,
  });

  // MutationObserver to watch for attribute changes
  const observer = new MutationObserver((mutations) => {
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

  // Initialize on DOMContentLoaded
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  /**
   * Setup mutation observer for a specific root (document or ShadowRoot)
   * @param root - The root to observe (Document or ShadowRoot)
   */
  function setupMutationObserver(root: Document | ShadowRoot) {
    // Observe all existing dialog elements in this root
    root.querySelectorAll("dialog").forEach((dialog) => {
      observer.observe(dialog, {
        attributes: true,
        attributeFilter: ["closedby"],
      });
    });

    // Observe newly added dialog elements in this root
    const rootObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof HTMLDialogElement) {
            observer.observe(node, {
              attributes: true,
              attributeFilter: ["closedby"],
            });
          }
          // Also check if the added node contains dialog elements
          if (node instanceof Element) {
            node.querySelectorAll("dialog").forEach((dialog) => {
              observer.observe(dialog, {
                attributes: true,
                attributeFilter: ["closedby"],
              });
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
   * Setup ShadowRoot observation for existing and future shadow roots
   */
  function setupShadowRootObservation() {
    // Find and observe existing ShadowRoots
    function findExistingShadowRoots(element: Element): ShadowRoot[] {
      const shadowRoots: ShadowRoot[] = [];

      // Check if this element has a shadowRoot
      if (element.shadowRoot) {
        shadowRoots.push(element.shadowRoot);
      }

      // Recursively check children
      for (const child of Array.from(element.children)) {
        shadowRoots.push(...findExistingShadowRoots(child));
      }

      return shadowRoots;
    }

    // Setup observers for existing ShadowRoots
    if (document.body) {
      const existingShadowRoots = findExistingShadowRoots(document.body);
      existingShadowRoots.forEach((shadowRoot) => {
        setupMutationObserver(shadowRoot);
      });
    }

    // Intercept attachShadow to observe future ShadowRoots
    const originalAttachShadow = HTMLElement.prototype.attachShadow;
    HTMLElement.prototype.attachShadow = function (init) {
      const shadowRoot = originalAttachShadow.call(this, init);
      setupMutationObserver(shadowRoot);
      return shadowRoot;
    };
  }

  /**
   * Initialize the polyfill
   */
  function init() {
    // Setup observation for main document
    setupMutationObserver(document);

    // Setup observation for ShadowRoots
    setupShadowRootObservation();
  }

  // Mark as polyfilled
  polyfilled = true;
}
