## 2026-10-23 - Modal Accessibility Standard Patterns
**Learning:** Icon-only modal close buttons (`&times;` or `×`) are read by screen readers as "times" or "multiplication sign", leaving assistive tech users unaware of their purpose. Modal overlays without `role="dialog"`, `aria-modal="true"`, and `aria-labelledby` fail screen reader navigation and landmarks.
**Action:** When adding or updating modal overlays in Comics Now!, always supply `role="dialog"`, `aria-modal="true"`, `aria-labelledby="[header-id]"`, descriptive close button `aria-label`s, and a global `Escape` key handler for quick dismissal.

## 2026-10-24 - Dual ARIA and Tooltip Pattern for Icon Controls
**Learning:** Icon-only buttons often provide either `aria-label` or `title`, but omitting `aria-label` leaves screen reader users with unannounced buttons, while omitting `title` deprives desktop mouse users of visual tooltip cues.
**Action:** When adding or updating icon-only navigation, header action, or reader overlay controls in Comics Now!, always specify both `aria-label` and `title` with consistent descriptive labels.
