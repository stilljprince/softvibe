# Design Token System – SoftVibe

SoftVibe uses layered theme tokens.

Theme layers:
1. Base theme (light / dark / pastel)
2. Genre modifier
3. Persona palette
4. Accent & Aurora intensity

Tokens are defined via CSS variables.

---

## Base Tokens

- --bg
- --fg
- --card
- --muted
- --border
- --accent
- --ring
- --bg-gradient-a
- --bg-gradient-b
- --bg-gradient-c
- --aurora-opacity
- --aurora-blur
- --aurora-saturation
- --aurora-speed

---

## Persona Palettes

Each persona maps to a palette:

- aurora
- noir
- dawn
- sage
- bubblegum
- ocean

Palettes override accent + gradient variables only.
They must not redefine layout variables.

---

## Genre Modifiers

Genres may subtly adjust:
- aurora speed
- aurora opacity
- micro motion intensity

Genres must not create drastically different layouts.

---

## Accent & Aurora Intensity

Accent levels: 1–3  
Aurora intensity: 0–3  

Applied via CSS classes.

---

## Aurora Layer

- Must be subtle
- Must respect prefers-reduced-motion
- Must not overpower content
- Must be token-driven
- Must be globally reusable

---

## Design Principles

- Minimal
- Clean
- Subtle depth
- Soft shadows
- Calm spacing
- Typography-driven hierarchy