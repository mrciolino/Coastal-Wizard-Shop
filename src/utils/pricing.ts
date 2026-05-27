import type { SpellCard } from './spells';
import type { SpellOdds } from './odds';
import { isAutographable } from './format';
import { ADVANCED_PACK, MARKET_VOLATILITY } from './constants';

export type MarketEntry = {
    spell: SpellCard;
    currentPrice: number;
    yesterdayPrice: number;
    change: number;
    changePct: number;
    history: number[];   // 14 days oldest→newest, last = currentPrice
    shinyPrice: number;
    autographPrice: number | null;
};

export type ComputeMarketDataParams = {
    packPrice: number;
    cardsInPack: number;
    /** Override the vol.baseRate for this specific pack. Defaults to DEFAULT_VOLATILITY.baseRate. */
    baseRate?: number;
    /** E[shiny price ÷ base price] for this pack. Centers the market shiny price. */
    shinyMultiplierAvg?: number;
    /** E[autograph×] for non-legendary cards. Centers the market autograph price. */
    autoMultiplierAvg?: number;
    /** E[autograph×] for legendary cards. Centers the market autograph price. */
    autoLegMultiplierAvg?: number;
};

export type MarketVolatility = {
    /** Current price = fairValue × [priceMin, priceMin + priceRange] (multiplicative range, not %) */
    priceMin: number;
    priceRange: number;
    /** Yesterday's price = today × [dailyMin, dailyMin + dailyRange] (multiplicative range, e.g. 0.93-1.07 ≈ ±7%) */
    dailyMin: number;
    dailyRange: number;
    /** History walk divisor per step: price_prev = price_current / [historyMin, historyMin + historyRange] */
    historyMin: number;
    historyRange: number;
    /** Symmetric spread for shiny prices: shinyPrice = currentPrice × clamp(packShinyMult ± shinySpread/2, 1, ∞) */
    shinySpread: number;
    /** Symmetric spread for non-legendary autograph prices */
    autoSpread: number;
    /** Symmetric spread for legendary autograph prices */
    autoLegSpread: number;
    /** Base rate reduction to reflect premium variants: fairValue × baseRate */
    baseRate: number;
};

export const DEFAULT_VOLATILITY: MarketVolatility = {
    ...MARKET_VOLATILITY,
    baseRate: ADVANCED_PACK.baseRate,
};

export function computeMarketData(
    spellOdds: SpellOdds[],
    { packPrice, cardsInPack, baseRate, shinyMultiplierAvg, autoMultiplierAvg, autoLegMultiplierAvg }: ComputeMarketDataParams,
    vol: MarketVolatility = DEFAULT_VOLATILITY,
): MarketEntry[] {
    // Price model: EV of opening one pack = packPrice.
    // Each card's fair value = (packPrice / cardsInPack) × (avgPDraw / pDraw)
    // so sum_over_slot(pDraw × price) = packPrice/cardsInPack per slot, × cardsInPack = packPrice ✓
    // Must count only drawable spells (pDraw > 0); spellOdds includes level 6-9 spells with
    // pDraw = 0 for packs like Starter — counting those deflates avgPDraw and all fair values.
    const drawableCount = spellOdds.filter((s) => s.pDraw > 0).length;
    const avgPDraw = drawableCount > 0 ? 1 / drawableCount : 1;
    const effectiveBaseRate = baseRate ?? vol.baseRate;
    // Variant multiplier averages — fall back to a neutral 1.0 if not supplied.
    const shinyMult   = shinyMultiplierAvg   ?? 1.5;
    const autoMult    = autoMultiplierAvg    ?? 1.5;
    const autoLegMult = autoLegMultiplierAvg ?? 2.0;

    return spellOdds.map(({ spell, pDraw }) => {
        const fairValue = pDraw > 0
            ? (packPrice / cardsInPack) * (avgPDraw / pDraw)
            : packPrice / cardsInPack;
        // Reduce base by 5% to reflect that the market average includes shiny/autographed
        // variants at premium, so a plain copy prices slightly below the raw EV.
        const base = Math.max(1, fairValue * effectiveBaseRate);
        const currentPrice = Math.round(base * (vol.priceMin + Math.random() * vol.priceRange));
        const yesterdayPrice = Math.round(currentPrice * (vol.dailyMin + Math.random() * vol.dailyRange));
        const change = currentPrice - yesterdayPrice;
        const changePct = yesterdayPrice > 0 ? (change / yesterdayPrice) * 100 : 0;
        const history: number[] = new Array(14);
        history[13] = currentPrice;
        let p = currentPrice;
        for (let i = 12; i >= 0; i--) {
            p = p / (vol.historyMin + Math.random() * vol.historyRange);
            history[i] = Math.round(Math.max(1, p));
        }
        const shinyPrice = Math.round(currentPrice * Math.max(1, shinyMult - vol.shinySpread / 2 + Math.random() * vol.shinySpread));
        const autographPrice = isAutographable(spell.rarity)
            ? Math.round(currentPrice * Math.max(1, spell.rarity === 'legendary'
                ? autoLegMult - vol.autoLegSpread / 2 + Math.random() * vol.autoLegSpread
                : autoMult    - vol.autoSpread    / 2 + Math.random() * vol.autoSpread))
            : null;
        return { spell, currentPrice, yesterdayPrice, change, changePct, history, shinyPrice, autographPrice };
    });
}
