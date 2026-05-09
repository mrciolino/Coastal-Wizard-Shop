import type { SpellRarity } from '../utils/spells';

export const panel    = 'bg-slate-900/90 border border-slate-700/60 shadow-xl backdrop-blur-sm rounded-2xl';
export const field    = 'grid gap-1 p-2 rounded-xl bg-white/5 border border-slate-700/50';
export const row      = 'flex justify-between gap-3 px-3 py-1.5 text-xs rounded-lg bg-white/5 border border-slate-700/50';
export const tag      = 'px-2 py-0.5 rounded-full text-indigo-200 text-xs bg-indigo-500/15 border border-indigo-400/15';
export const shinyTag = 'px-2 py-0.5 rounded-full text-xs bg-gradient-to-r from-slate-300/40 to-slate-400/20 border border-slate-300/30 text-white';
export const autographedTag = 'px-2 py-0.5 rounded-full text-xs bg-gradient-to-r from-amber-400/40 to-yellow-300/20 border border-amber-400/30 text-amber-100';
export const inp      = 'w-full border border-slate-600/50 rounded-lg py-1.5 px-2.5 text-slate-50 bg-slate-950/60 outline-none focus:ring-1 focus:ring-indigo-500/50 focus:border-indigo-500/40 transition-colors text-sm';
export const eyebrow  = 'text-xs uppercase tracking-widest text-sky-400 m-0 mb-0.5 font-medium';
export const secTitle = 'text-xs font-semibold text-slate-400 uppercase tracking-wider mt-0 mb-0';
export const statLabel = 'text-xs font-medium text-indigo-300/70 uppercase tracking-wider leading-none';
export const muted    = 'text-slate-400 text-sm';

export const rarityTagClasses: Record<SpellRarity, string> = {
    common:    'text-slate-200 bg-slate-800/15 border-slate-300/20',
    uncommon:  'text-emerald-200 bg-emerald-800/15 border-emerald-400/20',
    rare:      'text-cyan-200 bg-cyan-800/15 border-cyan-400/20',
    very_rare: 'text-purple-200 bg-purple-800/15 border-purple-400/20',
    legendary: 'text-amber-200 bg-amber-800/15 border-amber-400/25',
};

export function getRarityTagClass(rarity: SpellRarity): string {
    return rarityTagClasses[rarity];
}
