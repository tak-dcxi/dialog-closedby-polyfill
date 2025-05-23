/**
 * HTMLDialogElement closedBy attribute polyfill
 * @see https://developer.mozilla.org/en-US/docs/Web/API/HTMLDialogElement/closedBy
 */
declare global {
    interface HTMLDialogElement {
        closedBy?: "any" | "closerequest" | "none";
    }
}
/** Returns true when closedBy is implemented natively. */
export declare function isSupported(): boolean;
/** Returns true when this polyfill has been applied. */
export declare function isPolyfilled(): boolean;
export declare function apply(): void;
