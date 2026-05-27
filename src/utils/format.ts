import type { SpellCard, SpellPool, SpellRarity } from './spells';

export const rarityOrder: SpellRarity[] = ['common', 'uncommon', 'rare', 'very_rare', 'legendary'];

export const rarityTagClasses: Record<SpellRarity, string> = {
    common: 'text-slate-200 bg-slate-800/15 border-slate-300/20',
    uncommon: 'text-emerald-200 bg-emerald-800/15 border-emerald-400/20',
    rare: 'text-cyan-200 bg-cyan-800/15 border-cyan-400/20',
    very_rare: 'text-purple-200 bg-purple-800/15 border-purple-400/20',
    legendary: 'text-amber-200 bg-amber-800/15 border-amber-400/25',
};

export function getRarityTagClass(rarity: SpellRarity): string {
    return rarityTagClasses[rarity];
}

export function isAutographable(rarity: SpellRarity): boolean {
    return rarity === 'rare' || rarity === 'legendary';
}

export const schoolOrder = [
    'Conjuration', 'Abjuration', 'Divination', 'Enchantment',
    'Evocation', 'Illusion', 'Necromancy', 'Transmutation', 'Unknown',
] as const;

export type SchoolName = typeof schoolOrder[number];

export function formatPool(pool: SpellPool): string {
    return pool === 'conjuration' ? 'Conjuration' : 'Staple';
}

export function formatRarity(r: SpellCard['rarity']): string {
    return r.replace('_', ' ');
}

export function fmtStat(n: number): string {
    if (Math.abs(n) >= 10000) return `${(n / 1000).toFixed(1)} k`;
    return String(n);
}

/** Format a gold value: compact suffix notation (k / M) for large values. */
export function fmtGold(n: number): string {
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M`;
    if (abs >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
    return Math.round(n).toLocaleString();
}
