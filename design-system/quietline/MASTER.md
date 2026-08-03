# Quietline Design System

This file is the source of truth for Quietline's application and product UI.
Page-level files under `pages/` may add constraints, but may not override the
brand, privacy language, accessibility floor, or interaction rules below.

## Product Direction

Quietline is a confidential credit operations interface for Flare. It should
feel precise, calm, and purpose-built for repeated financial work. The visual
language is data-dense and nearly flat: borders and spacing establish hierarchy;
shadows are reserved for overlays.

The signature interaction pattern is the explicit privacy boundary:

- `Private`: decrypted only for the current user session.
- `FCC computed`: plaintext is processed in the confidential environment.
- `Public`: visible in Coston2 transactions, contracts, or oracle data.

Use icon plus text for privacy scope. Never rely on color alone.

## Brand

### Color

Apply the 60-30-10 rule:

- 60% neutral canvas: `#F5F7F6`
- 30% white and muted surfaces: `#FFFFFF`, `#F9FAF9`, `#ECF0EE`
- 10% accents and semantic states combined

| Role | Value |
|---|---|
| Canvas | `#F5F7F6` |
| Surface | `#FFFFFF` |
| Muted surface | `#F9FAF9` |
| Primary ink | `#151A18` |
| Secondary ink | `#56635E` |
| Border | `#DCE2DF` |
| Strong border | `#C5CECA` |
| Flare primary | `#E62046` |
| Flare hover | `#C9183A` |
| Confidential teal | `#176E73` |
| Warning amber | `#9A6100` |
| Danger red | `#B91F32` |
| Public blue | `#1F5F8B` |

Do not introduce black-and-gold, purple, decorative gradients, glow effects,
glassmorphism, or dark-mode styling into the hackathon interface.

### Typography

- Interface and headings: Fira Sans, 400/500/600/700.
- Numbers, prices, hashes, timers, and cryptographic data: Fira Code.
- Body size: 16px on small screens; dense metadata may use 11-13px.
- Letter spacing: `0`.
- Use tabular figures for changing values.
- Headings inside panels remain compact; hero-scale type is landing-only.

### Geometry

- Spacing rhythm: 4px and 8px increments.
- Application max width: 1440px.
- Panel radius: 6px.
- Minimum interactive target: 44px.
- Use borders for structure. Do not nest cards or float page sections as cards.
- Stable grids and fixed control heights must prevent layout shift.

## Navigation

- Desktop: fixed top application bar with Overview, Borrow, Earn, Activity, and
  Settings. Active route uses a Flare-red underline.
- Mobile: five-item fixed bottom navigation with icon and label.
- The mobile drawer contains secondary protocol links only.
- Every application screen is deep-linkable through its existing route.

## Components

### Buttons

- One primary Flare-red action per decision surface.
- Secondary actions use white surface and a strong neutral border.
- Quiet actions have no border.
- Danger actions use semantic red and remain spatially separated.
- Async actions disable and show progress without changing dimensions.

### Panels And Metrics

- Panels use a one-pixel border and white background.
- Headers contain a small category label, compact heading, and optional status.
- Metrics use Fira Code for values and reserve enough height for loading states.
- Tables are preferred for comparable records. On mobile they become labeled
  stacked rows rather than horizontal scroll regions.

### Forms

- Every field has a visible label and persistent helper text where needed.
- Amount inputs keep the asset label inside a stable right-hand area.
- Validation feedback appears next to the affected field or in a precise toast.
- Multi-step workflows show progress and preserve back navigation.

### Privacy Labels

- Private: lock icon, teal-tinted surface.
- FCC computed: compute icon, Flare-tinted surface.
- Public: eye icon, blue-tinted surface.
- The copy must describe the actual boundary. Never claim deposits, payouts,
  wallet addresses, transaction amounts, or timing are hidden.

## Motion

- 150-220ms for hover, focus, menu, modal, and state transitions.
- Animate opacity and transform only.
- Motion must communicate state or hierarchy; no decorative page choreography.
- Respect `prefers-reduced-motion`.

## Accessibility And Quality Gates

- Normal text contrast is at least 4.5:1.
- Focus rings remain visible on every interactive element.
- Icon-only controls require an accessible label and tooltip.
- Color is never the sole status indicator.
- No emoji icons; use Lucide consistently.
- No horizontal page scrolling at 375px.
- Fixed header and mobile navigation reserve content space and safe-area insets.
- Test 375x812, 768x1024, 1024x768, and 1440x1000.
- Test disconnected, empty, active, warning, liquidatable, loading, degraded
  service, and transaction failure states.
