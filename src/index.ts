/* -------------------------------------------------------------------------- */
/* Auto-applying entry point                                                  */
/* -------------------------------------------------------------------------- */
/*
 * Importing this module applies the polyfill when the browser needs it.
 * For manual control without side effects, import
 * `dialog-closedby-polyfill/fn` instead.
 *
 * `./fn.js` stays external in the build, so this entry and the `/fn` entry
 * share one copy of the polyfill state.
 */

import { apply } from "./fn.js";

export * from "./fn.js";

apply();
