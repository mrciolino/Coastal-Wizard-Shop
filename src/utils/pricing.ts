import type { SpellCard } from './spells';
import type { SpellOdds } from './odds';

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

export function computeMarketData(
    spellOdds: SpellOdds[],
    { packPrice, cardsInPack }: ComputeMarketDataParams,
): MarketEntry[] {
    // Price model: EV of opening one pack = packPrice.
    // Each card's fair value = (packPrice / cardsInPack) × (avgPDraw / pDraw)
    // so sum_over_slot(pDraw × price) = packPrice/cardsInPack per slot, × cardsInPack = packPrice ✓
    const avgPDraw = spellOdds.length > 0 ? 1 / spellOdds.length : 1;

    return spellOdds.map(({ spell, pDraw }) => {
        const fairValue = pDraw > 0
            ? (packPrice / cardsInPack) * (avgPDraw / pDraw)
            : packPrice / cardsInPack;
        const base = Math.max(1, fairValue);
        const currentPrice = Math.round(base * (0.85 + Math.random() * 0.30));
        const yesterdayPrice = Math.round(currentPrice * (0.93 + Math.random() * 0.14));
        const change = currentPrice - yesterdayPrice;
        const changePct = yesterdayPrice > 0 ? (change / yesterdayPrice) * 100 : 0;
        const history: number[] = new Array(14);
        history[13] = currentPrice;
        let p = currentPrice;
        for (let i = 12; i >= 0; i--) {
            p = p / (0.95 + Math.random() * 0.10);
            history[i] = Math.round(Math.max(1, p));
        }
        const shinyPrice = Math.round(currentPrice * (7 + Math.random() * 6));
        const isAutographable = spell.rarity === 'rare' || spell.rarity === 'legendary';
        const autographPrice = isAutographable
            ? Math.round(currentPrice * (spell.rarity === 'legendary' ? 20 + Math.random() * 10 : 12 + Math.random() * 8))
            : null;
        return { spell, currentPrice, yesterdayPrice, change, changePct, history, shinyPrice, autographPrice };
    });
}
