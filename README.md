# 5e Scroll Pack Opener

A D&D 5e spell scroll pack-opener built with React 19, TypeScript, Vite 7, and Tailwind CSS v4. Simulates opening booster-style packs of spell scroll cards with weighted level draws, shiny and autographed card variants, a simulated marketplace, and a pack-design optimizer.

## Features

- **Two pack presets** — Starter (500gp, L0–L5, 71% conjuration) and Advanced (1000gp, L0–L9, 50% conjuration), each with tuned variant rates
- **Configurable packs** — set gold budget, gold-per-pack, cards per pack, and conjuration/staple split
- **Per-level draw weights** — editable weights for all 10 spell levels (L0–L9); Starter locks L6–L9 to 0
- **Two spell pools** — Conjuration spells and Staple spells, derived automatically from the spell school in the image filename
- **Card variants** — Shiny cards (silver shimmer) and Autographed cards (gold foil, rare/legendary only), with preset-specific chances
- **Card flipping** — cards with a back-face image show a flip button to toggle front/back
- **Lightbox viewer** — click any card for a full-screen modal with keyboard nav, touch swipe, and variant/price details
- **Simulated marketplace** — fair-value pricing based on pull odds, with 24h change and 14-day sparkline per spell
- **Spell odds table** — per-spell draw %, per-pack %, and expected packs to hit; filterable by preset
- **Session stats** — packs/cards opened, pool splits, average level, shiny/autographed pulls, and gold profit
- **Lazy rendering** — card grid loads in 30-card batches for performance
- **Pack optimizer** (`/sim`) — Bayesian optimization + random search to calibrate pack economics against price targets

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173
npm run dev        # http://localhost:5173/sim  (optimizer)
```

To build and type-check:

```bash
npm run build      # runs tsc -b && vite build
npm run preview    # preview the production build
```

> There is no separate `typecheck` script — `npm run build` is the canonical way to validate TypeScript.

## Project structure

```
src/
  App.tsx              # Main page — all pack-opener state (~1200 lines)
  Simulation.tsx       # /sim page — pack-design optimizer with Bayesian search
  main.tsx             # Entry point — pathname routing (/sim vs. default)
  styles.css           # Tailwind v4 import + .shiny-card::after + .autographed-card::after
  components/
    tokens.ts          # All design-token constants (Tailwind class strings)
    MarketModal.tsx    # Simulated marketplace modal
    OddsModal.tsx      # Spell draw-odds breakdown modal
    Sparkline.tsx      # SVG sparkline for 14-day price trend
  utils/
    constants.ts       # STARTER_PACK, ADVANCED_PACK, level weights, CARD_WEIGHT_OVERRIDES
    spells.ts          # SpellCard type + import.meta.glob loader → spellCards[]
    pack.ts            # GeneratedResult type + generatePack()
    odds.ts            # computeSpellOdds() → SpellOdds[]
    pricing.ts         # computeMarketData() → MarketEntry[]
    roll.ts            # weightedPick<T>, randomInt, pickOne
    format.ts          # Rarity helpers, school order, formatters
  data/Spells/
    0 - Cantrips/      # <level>-<Name>-<School>.png
    1st/ … 9th/
    Back/              # Optional back-face images (matched by normalized filename)
```

## Pack presets

### Pack settings

| Setting | Starter | Advanced |
|---------|--------:|--------:|
| Pack price | 500 gp | 1,000 gp |
| Cards per pack | 5 | 5 |
| Conjuration rate | 71% | 50% |
| Levels available | L0–L5 | L0–L9 |
| Base rate (EV multiplier) | 1.063 | 0.983 |

### Variant rates

| Variant | Starter | Advanced |
|---------|--------:|--------:|
| Shiny chance (per card) | 4.01% | 9.37% |
| Shiny price multiplier (avg) | ×1.403 | ×1.105 |
| Autograph chance (per card) | 10.73% | 2.37% |
| Autograph multiplier — non-legendary (avg) | ×1.175 | ×1.092 |
| Autograph multiplier — legendary (avg) | ×1.573 | ×2.220 |

> Autographed cards only drop on Rare and Legendary cards.

### Level draw weights

Weights are normalised at draw time; values below represent approximate draw % per card slot.

| Level | Rarity | Starter | Advanced |
|------:|--------|--------:|--------:|
| L0 (Cantrip) | Common | 40.47% | 43.24% |
| L1 | Common | 38.01% | 37.37% |
| L2 | Uncommon | 9.82% | 8.70% |
| L3 | Rare | 10.06% | 8.59% |
| L4 | Very Rare | 0.77% | 0.89% |
| L5 | Very Rare | 0.87% | 0.92% |
| L6 | Legendary | — | 0.08% |
| L7 | Legendary | — | 0.08% |
| L8 | Legendary | — | 0.09% |
| L9 | Legendary | — | 0.04% |

Weights are defined in `utils/constants.ts` (`STARTER_LEVEL_WEIGHTS`, `ADVANCED_LEVEL_WEIGHTS`) and are editable live on the `/sim` optimizer page.

## Rarity mapping

Rarity is derived from spell level:

| Level | Rarity |
|-------|--------|
| 0–1 | Common |
| 2 | Uncommon |
| 3 | Rare |
| 4–5 | Very Rare |
| 6–9 | Legendary |

## Adding spells

Drop `.png` files into the appropriate level folder:

```
src/data/Spells/3rd/3-Fireball-Evocation.png
```

**Filename convention:** `<level>-<Spell Name>-<School>.png`

- School must be one of: `Abjuration`, `Conjuration`, `Divination`, `Enchantment`, `Evocation`, `Illusion`, `Necromancy`, `Transmutation`
- Conjuration school → `conjuration` pool; all others → `staple` pool
- `import.meta.glob` picks up new files at build time — **no code changes needed**
- To adjust a spell's pull weight, add an entry to `CARD_WEIGHT_OVERRIDES` in `utils/constants.ts`

To add a back-face image, place a matching PNG in `src/data/Spells/Back/`.

## Keyboard shortcuts (card modal)

| Key | Action |
|-----|--------|
| `←` / `→` | Previous / next card in pack |
| `↑` / `↓` | Previous / next pack |
| `Esc` | Close modal |
| Swipe left/right | Previous / next card (mobile) |
| Swipe up/down | Previous / next pack (mobile) |

## Pack optimizer (`/sim`)

Navigate to `/sim` for the pack-design tool. It lets you tune all pack parameters (price, cards/pack, conjuration rate, level weights, variant chances, per-card overrides) and search for configurations that satisfy fair-value price targets across 12 rarity/level buckets.

- **Random search** — up to 50,000 iterations, optionally looping
- **Bayesian optimization** — RBF-GP + UCB acquisition, 19-dimensional parameter space
- **Live EV table** — Starter vs. Advanced comparison updating as inputs change
- **Top-10 results** — shown as cards with an Apply button to load the config

## Tech stack

- **React 19** + **TypeScript 5**
- **Vite 7** with `@vitejs/plugin-react`
- **Tailwind CSS v4** via `@tailwindcss/vite` (no `tailwind.config.ts`)
- No routing library, no backend, no tests


