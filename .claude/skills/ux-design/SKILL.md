---
name: ux-design
description: Act as a user-experience designer. Use when the user asks to make a page more beautiful, intuitive, or polished ("improve the UX", "redesign this", "make it prettier"), or before shipping visible UI changes. Guides a structured pass - screenshot, critique, plan, implement with design tokens, verify visually.
---

# UX design pass

Work like a designer, not a stylist: diagnose before changing anything, and
verify the result with your own eyes.

## Process

1. **Look first.** Run the app and screenshot every affected page with headless
   Chrome at a wide (~1680px) and narrow (~900px) viewport, and in every theme
   the app supports. Never critique or redesign from the code alone.
2. **Critique against heuristics.** Note concrete defects, not vibes:
   - visual hierarchy (does the eye land on the primary action first?)
   - alignment, overflow, and collision (nothing may escape its container)
   - spacing consistency (one scale: 4/8/12/16/20px steps)
   - affordance (does clickable look clickable? do drag targets hint at it?)
   - information scent (can a first-time visitor tell what to do without help?)
   - empty, loading, and error states
3. **Plan, then edit.** Write the intended structure as a comment or short list
   before touching CSS. Prefer changing tokens (variables) over one-off values.
4. **Implement with the project's design system.** All colors, radii, and
   spacing come from the CSS custom properties in `public/style.css`. Never
   hardcode a color that exists as a token. Both themes must be checked for
   every change - a fix in one theme can break contrast in the other.
5. **Verify.** Re-screenshot the same viewports/themes and compare against the
   critique list. A finding is only fixed when the screenshot proves it.

## Project style rules (Sign To Erebor)

- Hobbit aesthetic: serif type, parchment (light) / evening brown (dark)
  palettes, green-door primary buttons, gold/bronze accents.
- No emoji in the UI. Decorative marks are inline SVG (mountain sigil, round
  door, padlock) using `currentColor` or theme tokens.
- Availability heat is always green; the user's own picks are always gold.
- Copy speaks in quest language ("company", "quest", "dissolves after") but
  never at the cost of clarity - functional labels stay plain.
