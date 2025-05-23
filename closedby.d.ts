/**
 * HTMLDialogElement closedBy attribute polyfill
 * @see https://developer.mozilla.org/en-US/docs/Web/API/HTMLDialogElement/closedBy
 */
declare global {
    interface HTMLDialogElement {
        closedBy?: "any" | "closerequest" | "none";
    }
}
/**
 * Check if closedBy attribute is natively supported
 * @returns true if closedBy is natively supported, false otherwise
 */
export declare function isSupported(): boolean;
/**
 * Check if the polyfill has been applied
 * @returns true if the polyfill has been applied, false otherwise
 */
export declare function isPolyfilled(): boolean;
/**
 * Apply the closedBy polyfill
 */
export declare function apply(): void;
