# SoftVibe – Agent Operating Manual

SoftVibe is a relaxation & sleep platform.

Core presets (equal pillars):
- ASMR
- Sleep Story
- Meditation
- Kids Story

ASMR is NOT the primary focus. All presets are equal pillars.

SoftVibe focuses on:
- Personalization
- High-quality voice output
- Calm immersive UI
- Minimal, premium, Apple-like design
- Subtle motion and atmosphere

The experience must feel:
- Clean
- Calm
- Modern
- Not visually noisy
- Not neon
- Emotionally warm

---

Tech stack:
- Next.js (App Router)
- Prisma
- OpenAI
- ElevenLabs
- Stripe

---

# Core Architecture

app/generate → Prompt input + job creation  
app/library → User content overview  
app/s/[id] → Story player  
app/t/[id] → Track player  
app/api/jobs → Job lifecycle  
lib/script-builder → Story generation logic  
lib/tts → Audio rendering  
lib/audio → Track & manifest logic  

Routing structure must NOT be refactored unless explicitly required.

---

# Context Loading Rules (CRITICAL)

Only inspect files directly relevant to the active task.

Do NOT read or refactor:
- node_modules/
- prisma/migrations/*
- public/audio/*
- .next/*
- package-lock.json (unless dependency work is explicitly required)
- Static JSON data files unless necessary

Prefer targeted file inspection.
Never perform global refactors.

---

# Allowed Changes

- UI redesign within existing pages
- Additive features (Prompt Assistant, Personas, Chips, Themes)
- Local refactors strictly required for implementation
- Creating new small utility files

---

# Disallowed Changes

- Rewriting routing architecture
- Moving major directories
- Refactoring job lifecycle logic
- Modifying Stripe/Auth flows unless required
- Introducing new state libraries

---

# Prompt System Rules

User prompt may override preset defaults if explicitly requested.

Prompt optimization must:
- Improve clarity
- Preserve user intent
- Remain editable before generation
- Never remove explicit user instructions

---

# Kids Story Preset – Core Rules

Kids Story must:

- Be age-safe
- Avoid violence, horror, existential themes
- Use simple language
- Use short paragraphs
- Follow calm pacing
- Have positive resolution
- Contain gentle emotional learning
- Be soothing, not overstimulating

Default structure:

1. Gentle introduction
2. Safe environment
3. Light adventure
4. Small challenge
5. Emotional learning moment
6. Calm resolution
7. Soft sleepy ending

Kids preset must integrate into:
- Preset selector
- Prompt builder
- Story generation rules
- UI chips suggestions

---

# Security Notes

High severity npm audit warnings originate from ESLint/minimatch dev-toolchain (dev-only).

Do NOT run:
npm audit fix --force

without explicit review.

Never expose environment variables in logs or responses.

OpenAI must be lazily initialized inside request handlers.

---

# Change Budget Rule

If a modification is not strictly required to implement the feature,
do NOT implement it.