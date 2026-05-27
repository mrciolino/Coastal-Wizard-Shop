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
    0: 40.472224930673406,
    1: 38.005285828213104,
    2: 9.821839543034914,
    3: 10.063183866286199,
    4: 0.7671088470974834,
    5: 0.8703569846949073,
    6: 0,
    7: 0,
    8: 0,
    9: 0,
};

/** Level draw-weights for the Advanced pack (all levels). */
export const ADVANCED_LEVEL_WEIGHTS: Record<0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9, number> = {
    0: 43.23500614393656,
    1: 37.369195937951716,
    2: 8.700581700462225,
    3: 8.590410263256887,
    4: 0.887059691327142,
    5: 0.9214041796614746,
    6: 0.08440428759742864,
    7: 0.08411560166974012,
    8: 0.09104597924034745,
    9: 0.03677621489648301,
};

// ── Per-card weight overrides ───────────────────────────────────────────────
/** Per-card draw-weight multipliers, keyed by file stem (without .png).
 *  Values < 1 reduce pull rate; values > 1 increase it. */
export const CARD_WEIGHT_OVERRIDES: Record<string, number> = {
    '9-True Resurrection-Necromancy': 0.5905,
    '9-Wish-Conjuration1': 0.0884,
};

// ── Starter pack ─────────────────────────────────────────────────────────────
export const STARTER_PACK = {
    packPrice: 500,                           // gold per pack
    cardsInPack: 5,                           // cards dealt per pack
    conjurationRate: 71,                      // % chance each slot is from the conjuration pool
    baseRate: 1.063337188199646,              // EV multiplier applied before variant premiums
    shinyChance: 0.040131031097955364,        // per-card probability of the shiny variant
    shinyMultiplierAvg: 1.4033425305229914,   // E[shiny price ÷ base price]
    autographChance: 0.10731757148505033,     // per-card probability of the autograph variant
    autoMultiplierAvg: 1.174678237489211,     // E[autograph×] non-legendary cards
    autoLegMultiplierAvg: 1.5726706657069898, // E[autograph×] legendary cards
} as const;

// ── Advanced pack ────────────────────────────────────────────────────────────
export const ADVANCED_PACK = {
    packPrice: 1000,
    cardsInPack: 5,
    conjurationRate: 50,
    baseRate: 0.9826034674399771,
    shinyChance: 0.093668422968291,
    shinyMultiplierAvg: 1.1049218858790801,
    autographChance: 0.023703215398704562,
    autoMultiplierAvg: 1.0919201993422551,
    autoLegMultiplierAvg: 2.2202536900734455,
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
