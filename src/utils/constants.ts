/**
 * Central configuration constants — edit this file to tune pack rates,
 * level weights, and variant (shiny/autograph) chances.
 *
 * Imported by spells.ts, App.tsx, and Simulation.tsx so there is a single
 * source of truth for every tunable number in the app.
 */

// ── Level draw-weights ──────────────────────────────────────────────────────
// Weights are relative; they are normalised at draw time, so only the ratios
// matter. Keeping the sum near 100 makes the values easy to read as rough %.
// Levels whose weight is 0 are excluded from the draw entirely.

/** Level draw-weights for the Starter pack (levels 0–5 only; L6–L9 = 0). */
export const STARTER_LEVEL_WEIGHTS: Record<0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9, number> = {
    0: 41.695538589794886,
    1: 35.47544205304725,
    2: 10.132151329879402,
    3: 10.974836888850252,
    4: 0.8285241308842675,
    5: 0.8935070075439289,
    6: 0,
    7: 0,
    8: 0,
    9: 0,
};

/** Level draw-weights for the Advanced pack (all levels). */
export const ADVANCED_LEVEL_WEIGHTS: Record<0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9, number> = {
    0: 42.1135974217316,
    1: 35.97714197801657,
    2: 10.231627314784125,
    3: 9.797937338090453,
    4: 0.7860246774568979,
    5: 0.8036366775116793,
    6: 0.0813526564643644,
    7: 0.082628765448164,
    8: 0.09041444064929224,
    9: 0.03563872984685617,
};

// ── Per-card weight overrides ───────────────────────────────────────────────
/** Per-card draw-weight multipliers, keyed by file stem (without .png).
 *  Values < 1 reduce pull rate; values > 1 increase it. */
export const CARD_WEIGHT_OVERRIDES: Record<string, number> = {
    '9-True Resurrection-Necromancy': 0.6250467545192004,
    '9-Wish-Conjuration1': 0.03874209458391963,
};

// ── Starter pack ─────────────────────────────────────────────────────────────
export const STARTER_PACK = {
    packPrice: 500,                           // gold per pack
    cardsInPack: 5,                           // cards dealt per pack
    conjurationRate: 69,                      // % chance each slot is from the conjuration pool
    baseRate: 1.0,                            // EV multiplier applied before variant premiums
    shinyChance: 0.02,                        // per-card probability of the shiny variant
    shinyMultiplierAvg: 1.5413559153316634,   // E[shiny price ÷ base price]
    autographChance: 0.10943140743308133,     // per-card probability of the autograph variant
    autoMultiplierAvg: 1.126961930927427,     // E[autograph×] non-legendary cards
    autoLegMultiplierAvg: 1.1996346897768735, // E[autograph×] legendary cards
} as const;

// ── Advanced pack ────────────────────────────────────────────────────────────
export const ADVANCED_PACK = {
    packPrice: 1000,
    cardsInPack: 5,
    conjurationRate: 69,
    baseRate: 0.6,
    shinyChance: 0.16471963203775405,
    shinyMultiplierAvg: 5,
    autographChance: 0.039360314723457246,
    autoMultiplierAvg: 2.4855530810962447,
    autoLegMultiplierAvg: 1.7204657425247067,
} as const;

// ── Market volatility / pricing model ────────────────────────────────────────
// Controls how deterministic fair-values are spread into simulated market prices.
// baseRate lives per-pack in STARTER_PACK / ADVANCED_PACK above.
export const MARKET_VOLATILITY = {
    /** Current price = fairValue × [priceMin, priceMin + priceRange] */
    priceMin: 0.8,
    priceRange: 0.40,
    /** Yesterday's price = today × [dailyMin, dailyMin + dailyRange] */
    dailyMin: 0.9,
    dailyRange: 0.2,
    /** History walk: price_prev = price_cur / [historyMin, historyMin + historyRange] */
    historyMin: 0.95,
    historyRange: 0.10,
    /** Shiny price = currentPrice × (packShinyMult ± shinySpread/2). Controls variance around the pack average. */
    shinySpread: 0.3,
    /** Non-legendary autograph price = currentPrice × (packAutoMult ± autoSpread/2). */
    autoSpread: 0.3,
    /** Legendary autograph price = currentPrice × (packAutoLegMult ± autoLegSpread/2). */
    autoLegSpread: 0.5,
} as const;
