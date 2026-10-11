# Dayfold design system

Source of truth is `src/renderer/src/assets/main.css`. Never hard-code colors or spacing in views.

## Principles (2026)

- One focus per screen. The main thing is large; everything secondary sits behind a `Disclosure` row (label, count, chevron) or a sheet.
- Single column, `max-w-2xl` (Activity `max-w-3xl`). Whitespace separates, hairlines divide, boxes are rare.
- Rows are quiet: title, one muted meta line, actions appear on hover or focus.
- Floating chrome (tab pill, command bar) is the only elevated, translucent UI.
- Inline add fields are soft filled (`bg-muted/60`, no border), with a leading plus.

## Color (oklch)

- Warm paper neutrals (hue ~80, chroma <0.01). `--primary` is ink (near-black in light, off-white in dark). One filled primary action per screen.
- `--chart-1` (volt, hue ~120: oklch 0.6 0.17 125 in light, 0.89 0.19 120 in dark) is the single accent for data bars, AI hints and highlights.
- Tones (`toneClass` in `dash.ts`): success / warning / destructive at 15% tint. Warning light is `0.46 0.12 70` for AA text.
- Progress for completion uses `bg-success`; analytical bars use `bg-chart-1`.

- Cards are flat: a hairline top border, no fill, no ring. `--card-spacing` is 0 so rows align with the page edge. Badges are plain muted text; tone is text color only (`toneClass`), never a tinted pill.

## Notifications

- Anything that should reach you outside Dayfold is a card in the overlay window (`#notify`, `src/main/notify.ts`), not a macOS banner: end-of-day reminder, capture confirmation with Undo, deadline alerts (once a day from 9am), and the on-demand "Right now" peek (`⌥⇧Space`, enabled with the capture shortcut).
- Card copy and actions are built in `src/shared/notify-logic.ts` so they are unit-tested. One card at a time, bottom-right of nothing: top-right of the display under the cursor, never steals focus (the peek does, so Esc works).

## Spacing

- `--space-section: 1.5rem` between page sections (`Page`).
- `--card-spacing` (Card, 1rem) is the only horizontal inset for card content. List rows use `px-(--card-spacing)`, never `px-6`.
- `--footer-h` is measured from the command bar at runtime; toasts anchor to it.

## Type

- Instrument Sans for page and card titles (`--font-display`), Geist for everything else. Both Google Fonts, bundled via `@fontsource-variable/*` so the app stays offline and the CSP stays `font-src 'self'`).

- 12 (meta) / 14 (body) / 20 (card & section) / 24 (page title, `text-2xl font-semibold`). Medium weight only for titles.

## Navigation

- Tabs show icon + label ≥ 960px; below that only the active tab shows its label (others `sr-only`). Date hidden < 1100px; AI assist collapses to its icon < 960px.

## Components

- Row actions: one filled action, the rest outline; below `sm` (640px) secondary actions fold into a `⋯` DropdownMenu (Dump).
- Icon buttons: `icon-sm` = 32px.
- Toasts: one visible, never expanded.
- Motion: tab content `view-in` 160ms ease-out (disabled by reduced-motion rule).
- Loading: skeletons matching the page's first blocks, not text.
