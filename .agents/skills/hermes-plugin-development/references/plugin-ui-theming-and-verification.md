# Plugin UI theming: tokens, light/dark, and how to prove it

Depth for the "Opaque surfaces" and "Rendering agent markdown" sections of SKILL.md.

## Token taxonomy (apps/desktop/src/styles.css)

| Kind | Tokens | Notes |
| --- | --- | --- |
| Foreground seed | `--ui-base` | `--ui-base: var(--theme-foreground)`; light theme `#17171a`, dark theme near-white |
| Text | `--ui-text-primary` / `-secondary` / `-tertiary` / `-quaternary` | derived from the seed: `color-mix(in srgb, var(--ui-base) 94%, transparent)` etc. |
| Surfaces | `--ui-bg-chrome`, `--ui-bg-elevated`, `--ui-bg-editor`, `--ui-bg-card`, `--ui-bg-tertiary` … | the ONLY tokens to paint backgrounds with |
| Strokes | `--ui-stroke-primary` / `-secondary` / `-tertiary` | borders/dividers |
| Accent | `--ui-accent`, `--ui-accent-secondary` | links, active states |
| Status | `--ui-red`, `--ui-green`, `--ui-yellow`, `--ui-cyan` | overridden per mode (`:root.dark` brightens them) |

Themes: `:root` holds the light values, `:root.dark` overrides the mix knobs and neutral seeds; skins inject more vars inline via `applyTheme()`. Consequences:

- An invented token (`--ui-background` next to `--ui-bg-chrome`) resolves to nothing and paints TRANSPARENT — sticky headers let content scroll through, drawers go see-through. Grep `styles.css` for every `--ui-*` name a plugin uses before trusting the render.
- Glass mode makes plain token fills see-through too, so masking cells/labels need an opaque fill plus `data-glass-opaque: true`.

## Rendering markdown

Use `MessageTextContent` from the plugin SDK (`media: false` for non-session text) — the same renderer chat and the official kanban drawer use, themed automatically. Raw `Streamdown` + Tailwind `prose` needs a hand-pinned palette that cannot satisfy both themes: `prose` defaults to a light-background body colour (#374151) and is unreadable on dark surfaces, while a `#fff` pin is unreadable on the light theme.

## The contrast probe

`scripts/theme-contrast-probe.mjs` (in this skill) does the measurement:

```
PLAYWRIGHT_BROWSERS_PATH=~/.cache/ms-playwright \
  node scripts/theme-contrast-probe.mjs --from-src src/main.ts --marker 'Readability:'
```

It injects the palette block over the REAL built desktop stylesheet (`apps/desktop/dist/assets/index-*.css`, which already carries every `--ui-*` name, the typography rules and the `:root` / `:root.dark` split), renders a small markdown pane per theme with and without the block, reads the COMPUTED colour of a `<p>`, of inline `code` and of the surface behind them, and writes WCAG contrast plus screenshots for the user.

Pitfalls that make the numbers meaningless if ignored:

- Chromium serialises `color-mix()` results as `color(srgb 0.99 0.99 0.99)` — floats in 0..1, not 0..255. Multiply by 255 before the luminance maths or every contrast figure is wrong (a "2.03:1" that should have been 10:1).
- A mix against `transparent` serialises as `color(srgb r g b / a)`: COMPOSITE that alpha over the surface before the luminance maths. Taking the first three numbers and dropping the alpha reports a perfectly readable code chip as ~1.8:1.
- Toggling `.dark` is NOT the dark theme: `--theme-foreground` is declared once in `:root` (the light value) and every dark value arrives INLINE from the active skin, so a class-only "dark" pane measures light ink on a mid-grey mix — plausible numbers that are pure fiction. Paint the skin's seeds inline on `:root` at the same time (`apps/shared/src/theme-presets.ts` → `<skin>.colors` / `.darkColors`; e.g. nous dark = foreground `#e6edf3`, background `#0d1117`, popover `#161b22`), or read the live app's computed tokens.
- The background to compare against is the SURFACE the text actually sits on: a container using `bg-(--ui-bg-subtle, transparent)` falls back to transparent, so the effective background is the drawer/page surface (e.g. `--ui-bg-elevated`).
- The "known good" target for a theme-aware prose palette, measured this way: body ~15.5:1 light / ~15:1 dark, inline code ~12:1 both ways. A literal-pinned palette instead lands ~17:1 on one theme and ~1:1 (invisible) on the other — always report the PAIR, never a single-theme number.
- Screenshots are the deliverable for the user: one per theme, so an invisible-text regression is visible at a glance.
