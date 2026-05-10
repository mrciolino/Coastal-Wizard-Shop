import type { SpellCard } from './spells';
import type { SpellOdds } from './odds';
import { isAutographable } from './format';

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
    /** Shiny multiplier: shinyPrice = currentPrice × [shinyMin, shinyMin + shinyRange] (additive range, not %) */
    shinyMin: number;
    shinyRange: number;
    /** Autograph multiplier for legendary cards: [autoLegMin, autoLegMin + autoLegRange] (additive range, not %) */
    autoLegMin: number;
    autoLegRange: number;
    /** Autograph multiplier for non-legendary cards: [autoMin, autoMin + autoRange] (additive range, not %) */
    autoMin: number;
    autoRange: number;
    /** Base rate reduction to reflect premium variants: fairValue × baseRate */
    baseRate: number;
};

export const DEFAULT_VOLATILITY: MarketVolatility = {
    priceMin: 0.8,
    priceRange: 0.40,
    dailyMin: 0.9,
    dailyRange: 0.2,
    historyMin: 0.95,
    historyRange: 0.10,
    shinyMin: 3.0066,
    shinyRange: 1.0,
    autoLegMin: 1.0,
    autoLegRange: 0.9252,
    autoMin: 4.1734,
    autoRange: 1.0,
    baseRate: 0.9,
};

export function computeMarketData(
    spellOdds: SpellOdds[],
    { packPrice, cardsInPack }: ComputeMarketDataParams,
    vol: MarketVolatility = DEFAULT_VOLATILITY,
): MarketEntry[] {
    // Price model: EV of opening one pack = packPrice.
    // Each card's fair value = (packPrice / cardsInPack) × (avgPDraw / pDraw)
    // so sum_over_slot(pDraw × price) = packPrice/cardsInPack per slot, × cardsInPack = packPrice ✓
    const avgPDraw = spellOdds.length > 0 ? 1 / spellOdds.length : 1;

    return spellOdds.map(({ spell, pDraw }) => {
        const fairValue = pDraw > 0
            ? (packPrice / cardsInPack) * (avgPDraw / pDraw)
            : packPrice / cardsInPack;
        // Reduce base by 5% to reflect that the market average includes shiny/autographed
        // variants at premium, so a plain copy prices slightly below the raw EV.
        const base = Math.max(1, fairValue * vol.baseRate);
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
        const shinyPrice = Math.round(currentPrice * (vol.shinyMin + Math.random() * vol.shinyRange));
        const autographPrice = isAutographable(spell.rarity)
            ? Math.round(currentPrice * (spell.rarity === 'legendary'
                ? vol.autoLegMin + Math.random() * vol.autoLegRange
                : vol.autoMin + Math.random() * vol.autoRange))
            : null;
        return { spell, currentPrice, yesterdayPrice, change, changePct, history, shinyPrice, autographPrice };
    });
}
