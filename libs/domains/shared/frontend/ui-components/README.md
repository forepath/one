# shared-frontend-ui-components

Shared Angular UI library for all ForePath frontends.

## Naming

The selector prefix is **`fpc`** — short for **ForePath Component**. Element components use
`fpc-<kebab-case>` (`fpc-button`, `fpc-list-item`), directives use the camelCase attribute
form (`[fpcInfiniteScroll]`, `*fpcModalFooter`), and other content-projection slots use attribute
markers in the same namespace (`[fpcListItemActions]`).

Class names follow the selector: `fpc-summary-card` → `FpcSummaryCardComponent`.

## Usage

Every component is standalone, so import the symbols you need directly:

```ts
import { Component } from '@angular/core';
import { FpcButtonComponent, FpcModalComponent, FpcModalFooterDirective } from '@forepath/shared/frontend/ui-components';

@Component({
  selector: 'app-invoice-actions',
  imports: [FpcButtonComponent, FpcModalComponent, FpcModalFooterDirective],
  template: `
    <fpc-button variant="primary" (clicked)="open.set(true)">New invoice</fpc-button>
    <fpc-modal [(open)]="open" title="New invoice">
      …
      <div *fpcModalFooter class="d-flex justify-content-end gap-2">
        <fpc-button variant="primary">Save</fpc-button>
      </div>
    </fpc-modal>
  `,
})
export class InvoiceActionsComponent {}
```

There is no NgModule and no NgRx dependency: the components are presentational, state stays in
the consuming feature library.

See [`docs/catalog.md`](./docs/catalog.md) for the full list of selectors, inputs, outputs and
projection slots.

## Theming

The library never hard-codes colours in components. Everything resolves through Bootstrap 5 CSS
variables (`--bs-primary`, `--bs-body-bg`, `--bs-border-color`, the `*-bg-subtle` /
`*-text-emphasis` families, …), so components follow the host application’s theme — including
`html[data-bs-theme="dark"]`.

### Brand palettes (`styles/brands/`)

Compile-time brand tokens live under `styles/brands/` (Decabill / Agenstra / ForePath). Apps load
them **before** Bootstrap:

```scss
@import 'bootstrap/scss/functions';
@import '<path-to-lib>/styles/brands/decabill/palette';
@import '<path-to-lib>/styles/brands/chrome';
@import '<path-to-lib>/styles/brands/badge-tint';
@import 'bootstrap/scss/bootstrap';
@import '<path-to-lib>/styles';
@import '<path-to-lib>/styles/brands/extras';
@import '<path-to-lib>/styles/brands/decabill/extras';
```

Shared `brands/extras` sets `--bs-primary-dark` /
`--bs-success-dark` via `color-mix(… 92% / 80%, black)` so dark accents track the brand primary and
success without hand-tuned hex per app.

Ad-hoc one-off overrides remain possible:

```scss
:root {
  --bs-primary: #0d9488;
}
```

A few library-specific variables exist for layout-only concerns and can be overridden the same way:

- `--fpc-sidebar-width` (`fpc-sidebar`)
- `--fpc-summary-bar-columns` (`fpc-summary-bar`)
- `--sidebar-item-hover-bg` / `--sidebar-item-active-bg` (`fpc-sidebar` / `fpc-sidebar-popover`)

### Global styles

Document-wide rules that cannot live only in encapsulated component styles ship as Sass
partials under `styles/` and are loaded once from each app’s `styles.scss` via
`@import '…/styles'`:

| Partial     | Why global                                                   |
| ----------- | ------------------------------------------------------------ |
| `scrollbar` | Thin scrollbar using `--bs-scrollbar-*` from `brands/extras` |

Modal chrome lives on `fpc-modal`. Icon-button sizing lives on `fpc-button` (`iconOnly`).
Sidebar-popover chrome and `--sidebar-item-*` tokens live on `fpc-sidebar` /
`fpc-sidebar-popover`.

## Storybook

Every component ships a `*.stories.ts` file covering its key inputs, outputs and states. Docs
tabs include when/where guidance (`parameters.docs.description`). Foundation pages cover
**Theming** and **Fonts** (under Foundation in the sidebar).

```sh
nx run shared-frontend-ui-components:storybook        # dev server on http://localhost:4400
nx run shared-frontend-ui-components:build-storybook  # static build
```

Toolbar globals (same for CSF and Docs):

- **Theme** — sets `html[data-bs-theme]` to `light` | `dark` (matches apps).
- **Color set** — optional Storybook-only brand overlay via `html[data-fpc-brand]`
  (`bootstrap` | `decabill` | `agenstra` | `forepath`). Overlays under `.storybook/brands/`
  compile the shared `styles/brands/*/palette` tokens into scoped CSS variables.

Bootstrap CSS, Bootstrap Icons, Plus Jakarta Sans, brand overlays, and lib `styles/index.scss`
are loaded through the `styles` option of the Storybook targets in `project.json`.

## Testing

```sh
nx test shared-frontend-ui-components
nx lint shared-frontend-ui-components
nx build shared-frontend-ui-components
```

## Migration notes

### From `shared-frontend-ui-lists`

That library was removed. Import from `@forepath/shared/frontend/ui-components` instead:

| Old                         | New                                                       |
| --------------------------- | --------------------------------------------------------- |
| `sharedInfiniteScroll`      | `fpcInfiniteScroll` (`FpcInfiniteScrollDirective`)        |
| `shared-list-append-footer` | `fpc-list-append-footer` (`FpcListAppendFooterComponent`) |

### From identity OTP

`IdentityOtpInputComponent` is a compatibility re-export of `FpcOtpInputComponent`. Prefer importing `FpcOtpInputComponent` / `<fpc-otp-input>` directly in new code.
