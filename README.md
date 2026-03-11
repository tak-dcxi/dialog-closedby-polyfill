# dialog-closedby-polyfill

A polyfill for the HTMLDialogElement `closedby` attribute, providing control over how modal dialogs can be dismissed.

> **Note**: The HTML attribute is `closedby` (lowercase), while the JavaScript property is `closedBy` (camelCase).

## Features

- 🎯 Implements the `closedby` attribute for `<dialog>` elements
- 🔒 Three closing modes: `any`, `closerequest`, and `none`
- 🚀 Zero dependencies
- 📦 TypeScript support included
- 🌐 Works in all modern browsers with `<dialog>` support
- ✨ Automatically detects native support

## Installation

```bash
npm install dialog-closedby-polyfill
```

## Usage

The polyfill is automatically applied when imported:

```javascript
// ES Modules (auto-applies if needed)
import "dialog-closedby-polyfill";

// CommonJS (auto-applies if needed)
require("dialog-closedby-polyfill");
```

### Manual Control

If you need more control over when the polyfill is applied:

```javascript
import { apply, isSupported } from "dialog-closedby-polyfill/fn";

if (!isSupported()) {
  apply();
}
```

Or include it via CDN:

```html
<!-- Polyfill applied automatically -->
<script
  type="module"
  src="https://cdn.jsdelivr.net/npm/dialog-closedby-polyfill/index.js"
></script>

<!-- polyfill manually -->
<script type="module">
  import {
    isSupported,
    apply,
  } from "https://cdn.jsdelivr.net/npm/dialog-closedby-polyfill/index.js";
  if (!isSupported()) apply();
</script>
```

## Demo

https://tak-dcxi.github.io/github-pages-demo/closedby.html

## How it works

The `closedby` attribute controls how a modal dialog can be dismissed:

### Closing Behavior Matrix

| `closedby` value | ESC key | Backdrop click | `close()` method |
| ---------------- | ------- | -------------- | ---------------- |
| `"any"`          | ✅      | ✅             | ✅               |
| `"closerequest"` | ✅      | ❌             | ✅               |
| `"none"`         | ❌      | ❌             | ✅               |

### `closedby="any"` (default)

The dialog can be closed by:

- Pressing the ESC key
- Clicking the backdrop
- Calling the `close()` method

```html
<dialog
  id="dialog-any"
  closedby="any"
  aria-labelledby="dialog-any-title"
  autofocus
>
  <h1 id="dialog-any-title">any</h1>
  <p>This dialog can be closed in any way</p>
  <button type="button" commandfor="dialog-any" command="close">Close</button>
</dialog>
```

### `closedby="closerequest"`

The dialog can be closed by:

- Pressing the ESC key
- Calling the `close()` method
- ❌ Clicking the backdrop (disabled)

```html
<dialog
  id="dialog-closerequest"
  closedby="closerequest"
  aria-labelledby="dialog-closerequest-title"
  autofocus
>
  <h1 id="dialog-closerequest-title">closerequest</h1>
  <p>This dialog cannot be closed by clicking outside</p>
  <button type="button" commandfor="dialog-closerequest" command="close">
    Close
  </button>
</dialog>
```

### `closedby="none"`

The dialog can only be closed by:

- Calling the `close()` method
- ❌ Pressing the ESC key (disabled)
- ❌ Clicking the backdrop (disabled)

```html
<dialog
  id="dialog-none"
  closedby="none"
  aria-labelledby="dialog-none-title"
  autofocus
>
  <h1 id="dialog-none-title">none</h1>
  <p>This dialog can only be closed programmatically</p>
  <button type="button" commandfor="dialog-none" command="close">Close</button>
</dialog>
```

## JavaScript API

You can also set the attribute via JavaScript:

```javascript
const dialog = document.querySelector("dialog");

// Using setAttribute
dialog.setAttribute("closedby", "none");

// Using the property (when polyfill is loaded)
dialog.closedBy = "closerequest";
```

## Dynamic Changes

The `closedby` attribute can be changed while the dialog is open:

```javascript
const dialog = document.querySelector("dialog");
dialog.showModal();

// Change behavior while dialog is open
setTimeout(() => {
  dialog.closedBy = "none"; // Now only closeable via close() method
}, 3000);
```

## Browser Support

This polyfill works in all browsers that support the native `<dialog>` element.

**Native `closedby` support:**

- Chrome 134+
- Safari: Not implemented yet
- Firefox: 141+
- Edge: 134+

**Dialog element support (required for polyfill):**

- Chrome 37+
- Firefox 98+
- Safari 15.4+
- Edge 79+

> **Note**: For browsers without native `closedby` support, this polyfill provides the functionality. For older browsers without `<dialog>` element support, you'll also need a dialog element polyfill.

## API

### Functions

#### `isSupported(): boolean`

Check if the browser natively supports the `closedby` attribute.

```javascript
import { isSupported } from "dialog-closedby-polyfill";

if (isSupported()) {
  console.log("Native closedby support available!");
}
```

#### `isPolyfilled(): boolean`

Check if the polyfill has already been applied.

```javascript
import { isPolyfilled } from "dialog-closedby-polyfill";

if (isPolyfilled()) {
  console.log("Polyfill has been applied");
}
```

#### `apply(): void`

Manually apply the polyfill. This is called automatically when importing the main module.

```javascript
import { apply } from "dialog-closedby-polyfill";

apply(); // Apply the polyfill
```

#### `teardown(): void`

Tears down the polyfill, removing all event listeners and observers. Useful for cleanup in tests or when dynamically unloading the polyfill.

```javascript
import { teardown } from "dialog-closedby-polyfill";

teardown(); // Remove all listeners and observers
```

> **Note**: This does NOT restore the original `showModal`, `show`, or `closedBy` implementations on the prototype. It only cleans up observers and listeners.

## TypeScript Support

TypeScript definitions are included. The polyfill extends the `HTMLDialogElement` interface:

```typescript
interface HTMLDialogElement {
  closedBy: "any" | "closerequest" | "none";
}
```

## Implementation Details

The polyfill works by:

1. **Extending HTMLDialogElement**: Adds the `closedBy` property to dialog elements
1. **Intercepting `showModal()` and `show()`**: Sets up event listeners when a dialog is opened
1. **Handling Events**:
   - `keydown` event for ESC key detection
   - `click` event on the dialog for backdrop clicks
   - `close` event for cleanup
1. **Observing Changes**: Uses MutationObserver to watch for `closedby` attribute additions
1. **Cleanup**: Removes event listeners when dialog is closed

## Differences from Native Implementation

This polyfill aims to match the native implementation as closely as possible. However, there might be minor differences in edge cases. Please report any discrepancies you find.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT License - see the [LICENSE](LICENSE) file for details

## Recommended Polyfills

### Invokers Polyfill

Declarative `command/commandfor` attributes to provide dialog button operations with markup only.

- **GitHub**: [keithamus/invokers-polyfill](https://github.com/keithamus/invokers-polyfill)
- **Use case**: Simplifies dialog controls without requiring JavaScript event handlers

```html
<!-- Works seamlessly with this polyfill -->
<button type="button" commandfor="my-dialog" command="show-modal">
  Open Dialog
</button>
<dialog
  id="my-dialog"
  closedby="closerequest"
  aria-labelledby="my-dialog-heading"
  autofocus
>
  <h1 id="my-dialog-heading">Heading</h1>
  <p>Content</p>
  <button type="button" commandfor="my-dialog" command="close">Close</button>
</dialog>
```

## Release Notes

### v1.3.0

- **New**: `teardown()` function to clean up observers and event listeners
- **New**: Support for modeless dialogs (`show()` method)
- **New**: Case-insensitive `closedby` attribute handling
- **Improved**: Internal architecture refactoring
  - Lazy registration for escape handler
  - Prevent duplicate observers for the same root
  - Handle `DOMContentLoaded` for scripts in `<head>`

### v1.2.0

- **Fixed**: Prevent immediate close when reopening dialog after form submission
  - Added `close` event listener to ensure cleanup regardless of how the dialog was closed
  - Added `openedAt` timestamp to track when dialog was opened
  - Use `event.timeStamp` comparison to ignore clicks from before dialog opened

### v1.1.0

- **Fixed**: Using ESC key no longer exits fullscreen mode in Safari/Firefox
- **Fixed**: Dialog now closes on backdrop click even when `::backdrop` is set to `display: none`
- **Fixed**: Safari 26.2 false positive detection
  - Safari 26.2 exposes `closedBy` on `HTMLDialogElement.prototype` but the implementation is incomplete
  - Changed `isSupported()` to use behavioral test instead of property existence check

### v1.0.0

- Initial release
- Implements `closedby` attribute polyfill for `<dialog>` elements
- Three closing modes: `any`, `closerequest`, and `none`
- TypeScript support included

## Related Links

- [MDN Documentation for closedBy](https://developer.mozilla.org/en-US/docs/Web/API/HTMLDialogElement/closedBy)
- [Chrome Platform Status](https://chromestatus.com/feature/5097714453725184)
- [HTML Specification](https://html.spec.whatwg.org/multipage/interactive-elements.html#the-dialog-element)

## Acknowledgments

This polyfill is inspired by the native implementation and the work of the web standards community.
