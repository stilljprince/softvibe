# Voice Personas – SoftVibe

Voice Personas define tone defaults and subtle UI theming.

Each persona contains:

- id
- displayName
- subtitle
- short story (1–2 sentences)
- tags
- supportedGenres
- promptStyle defaults
- themeRef (palette + intensity)
- voice provider mapping

Personas influence:
- Prompt tone
- Pacing
- Warmth
- Imagery density
- UI palette
- Aurora intensity

Personas do NOT restrict user creativity.
Explicit user instructions always override style defaults.

---

## Persona Model (TypeScript)

(Place in codebase, not here in docs)

See implementation structure agreed in project architecture.

---

## Initial Persona Set

### Luna
Warm whispers • Cozy focus  
Soft, close, reassuring presence.  
Palette: aurora  
Accent level: 2  
Aurora intensity: 2  

### Noah
Clear • Grounding • Minimal  
Clean, practical, calming voice.  
Palette: sage  
Accent level: 1  
Aurora intensity: 1  

### Ivy
Soft storytelling • Dreamy  
Atmospheric and narrative-driven.  
Palette: dawn  
Accent level: 2  
Aurora intensity: 2  

### Mila
Playful calm • Bedtime safe  
Friendly and comforting tone for children.  
Palette: bubblegum  
Accent level: 2  
Aurora intensity: 1  

### Kai
Deep calm • Ocean night  
Very slow and grounded tone.  
Palette: ocean  
Accent level: 1  
Aurora intensity: 2  

### Nova
Crisp • Modern • Studio feel  
Controlled, minimal, elegant delivery.  
Palette: noir  
Accent level: 3  
Aurora intensity: 0  

---

Personas must:
- Remain consistent
- Not contradict safety rules
- Be theme-token-driven