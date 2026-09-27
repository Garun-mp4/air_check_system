# Project instructions

## Design system and UI work

- Before adding or changing user interface, read `DESIGN-cal.md` and inspect the existing design tokens and reusable patterns in `frontend/css/styles.css`.
- Apply the existing colors, typography, spacing, radii, buttons, form controls, and navigation patterns. Prefer the shared CSS custom properties; do not introduce a competing palette or one-off component styling.
- Keep semantic status colors for success, warning, and error states. The 3D scene may use colors that describe the physical environment; apply the design system to the surrounding application interface.
- Check the rendered page for misalignment, clipping, overlapping elements, unreadable text, and unintended horizontal scrolling. Review desktop (1920×1080 and 1440px wide), tablet (1024px and 768px), and mobile (390px and 320px) layouts where relevant.
- Use clear labels, keyboard-visible focus, semantic controls, and readable loading, empty, and error states. Run relevant UI checks, tests, type checks, and builds after changes.
