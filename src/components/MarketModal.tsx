import { useState } from 'react';
import type { MarketEntry } from '../utils/pricing';
import { formatRarity } from '../utils/format';
import { spellLevels } from '../utils/spells';
import { getRarityTagClass, inp, panel, tag } from './tokens';
import Sparkline from './Sparkline';

const LEVEL_LABELS: Record<number, string> = {
    0: 'Cantrip', 1: 'L1', 2: 'L2', 3: 'L3', 4: 'L4',
    5: 'L5', 6: 'L6', 7: 'L7', 8: 'L8', 9: 'L9',
};

type SortKey = 'name' | 'price';
type SortDir = 'asc' | 'desc';

type MarketModalProps = {
    onClose: () => void;
    marketData: MarketEntry[] | null;
    packPrice: number;
    cardsInPack: number;
    conjurationRate: number;
    levelDrawPcts: Record<number, number>;
    presetName: string;
};

export default function MarketModal({ onClose, marketData, packPrice, cardsInPack, conjurationRate, levelDrawPcts, presetName }: MarketModalProps) {
    const [search, setSearch] = useState('');
    const [sortKey, setSortKey] = useState<SortKey>('price');
    const [sortDir, setSortDir] = useState<SortDir>('desc');

    function handleSort(key: SortKey) {
        if (sortKey === key) {
            setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        } else {
            setSortKey(key);
            setSortDir('desc');
        }
    }

    const sortedRows = marketData
        ? [...marketData]
            .filter(({ spell }) => {
                const q = search.trim().toLowerCase();
                if (!q) return true;
                return (
                    spell.displayName.toLowerCase().includes(q) ||
                    spell.school.toLowerCase().includes(q) ||
                    spell.rarity.replace('_', ' ').toLowerCase().includes(q)
                );
            })
            .sort((a, b) => {
                const dir = sortDir === 'asc' ? 1 : -1;
                if (sortKey === 'name') return dir * a.spell.displayName.localeCompare(b.spell.displayName);
                return dir * (a.currentPrice - b.currentPrice);
            })
        : [];

    return (
        <div
            className="fixed inset-0 bg-slate-950/92 backdrop-blur-md flex items-start justify-center p-1 sm:p-4 z-30 overflow-y-auto"
            onClick={onClose}
            role="presentation"
        >
            <div
                className={`${panel} relative w-full max-w-6xl my-1 sm:my-8 flex flex-col`}
                style={{ maxHeight: 'calc(100dvh - 0.5rem)' }}
                role="dialog"
                aria-modal="true"
                aria-labelledby="economy-modal-title"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between gap-2 px-3 sm:px-5 py-2 sm:py-3 border-b border-slate-700/60 shrink-0">
                    <div>
                        <h2 id="economy-modal-title" className="text-base sm:text-lg font-bold text-slate-50 m-0">📈 Marketplace · {presetName}</h2>
                        <p className="hidden sm:block text-xs text-slate-400 mt-0.5 m-0">Simulated fair-value prices based on pull odds · refreshes each open</p>
                        <div className="hidden sm:flex flex-wrap gap-1 mt-1">
                            <span className={tag}>{packPrice} gp/pack</span>
                            <span className={tag}>{cardsInPack} cards/pack</span>
                            <span className={tag}>{conjurationRate}% conj · {100 - conjurationRate}% staple</span>
                            {spellLevels.map((lvl) => levelDrawPcts[lvl] != null && levelDrawPcts[lvl]! > 0 ? (
                                <span key={lvl} className="px-2 py-0.5 rounded-full text-xs border border-slate-600/40 text-slate-300 bg-slate-800/40">
                                    {LEVEL_LABELS[lvl]} {((p) => p < 0.1 ? p.toFixed(3) : p.toFixed(1))(levelDrawPcts[lvl]! * 100)}%
                                </span>
                            ) : null)}
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close"
                        className="w-8 h-8 shrink-0 rounded-xl grid place-items-center bg-slate-800/80 text-slate-300 hover:text-white border border-slate-700/60 text-lg p-0 transition-all hover:bg-slate-700/60 cursor-pointer"
                    >
                        ×
                    </button>
                </div>

                {marketData === null ? (
                    /* Loading */
                    <div className="flex flex-col items-center justify-center py-24 gap-3">
                        <div className="w-8 h-8 rounded-full border-2 border-slate-700 border-t-indigo-400 animate-spin" />
                        <p className="text-slate-400 text-sm">Computing market prices…</p>
                    </div>
                ) : (
                    <>
                        {/* Search + sort controls */}
                        <div className="px-2 sm:px-4 py-2 border-b border-slate-700/60 shrink-0 flex flex-wrap gap-1.5 sm:gap-2 items-center">
                            <input
                                type="search"
                                placeholder="Filter spells…"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className={inp + ' flex-1 min-w-32 text-xs sm:text-sm'}
                                aria-label="Filter market"
                            />
                            <span className="text-xs text-slate-500 shrink-0">Sort:</span>
                            {(['name', 'price'] as const).map((key) => (
                                <button
                                    key={key}
                                    type="button"
                                    onClick={() => handleSort(key)}
                                    className={`shrink-0 rounded-lg px-2 py-1 text-xs font-medium border transition-all ${sortKey === key ? 'bg-indigo-500/20 text-indigo-200 border-indigo-500/40' : 'bg-white/5 text-slate-400 border-slate-700/50 hover:bg-white/10'}`}
                                >
                                    {key === 'name' ? 'Name' : 'Price'}
                                    {sortKey === key ? (sortDir === 'desc' ? ' ▼' : ' ▲') : ''}
                                </button>
                            ))}
                        </div>

                        {/* Table */}
                        <div className="overflow-y-auto flex-1 min-h-0">
                            <table className="w-full border-collapse">
                                <thead className="sticky top-0 bg-slate-900 z-10">
                                    <tr>
                                        <th className="text-left px-1.5 sm:px-4 py-1.5 sm:py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-700/60">Spell</th>
                                        <th className="text-right px-1.5 sm:px-4 py-1.5 sm:py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-700/60">Price</th>
                                        <th className="hidden sm:table-cell text-right px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-700/60">✦ Shiny</th>
                                        <th className="hidden sm:table-cell text-right px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-700/60">✍ Autograph</th>
                                        <th className="hidden sm:table-cell text-right px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-700/60">24h</th>
                                        <th className="w-16 sm:w-24 px-1.5 sm:px-4 py-1.5 sm:py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-700/60">Trend</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sortedRows.map(({ spell, currentPrice, change, changePct, history, shinyPrice, autographPrice }) => (
                                        <tr key={spell.id} className="border-b border-slate-700/30 hover:bg-white/4 transition-colors">
                                            <td className="px-1.5 sm:px-4 py-1 sm:py-2">
                                                <div className="flex items-center gap-1 flex-wrap">
                                                    <span className="text-slate-100 font-medium text-xs sm:text-sm whitespace-nowrap">{spell.displayName}</span>
                                                    <span className={`px-1.5 py-0.5 rounded-full text-xs border ${getRarityTagClass(spell.rarity)}`}>{formatRarity(spell.rarity)}</span>
                                                    <span className={tag + ' hidden sm:inline-flex'}>{spell.school}</span>
                                                </div>
                                                {/* Mobile: shiny + autograph sub-line */}
                                                <div className="sm:hidden flex gap-2 mt-0.5">
                                                    <span className="font-mono text-xs text-slate-400">✦ {shinyPrice.toLocaleString()}gp</span>
                                                    {autographPrice != null && <span className="font-mono text-xs text-amber-400">✍ {autographPrice.toLocaleString()}gp</span>}
                                                </div>
                                            </td>
                                            <td className="px-1.5 sm:px-4 py-1 sm:py-2 text-right align-middle">
                                                <div className="font-mono text-xs sm:text-sm text-slate-100 font-semibold whitespace-nowrap">{currentPrice.toLocaleString()}<span className="hidden sm:inline"> gp</span></div>
                                                <div className={`sm:hidden font-mono text-xs whitespace-nowrap ${change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                                    {change >= 0 ? '+' : ''}{changePct.toFixed(1)}%
                                                </div>
                                            </td>
                                            <td className="hidden sm:table-cell px-4 py-2 text-right font-mono text-xs text-slate-300 whitespace-nowrap">
                                                {shinyPrice.toLocaleString()} gp
                                            </td>
                                            <td className="hidden sm:table-cell px-4 py-2 text-right font-mono text-xs whitespace-nowrap">
                                                {autographPrice != null
                                                    ? <span className="text-amber-300">{autographPrice.toLocaleString()} gp</span>
                                                    : <span className="text-slate-600">—</span>
                                                }
                                            </td>
                                            <td className={`hidden sm:table-cell px-4 py-2 text-right font-mono text-xs whitespace-nowrap ${change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                                <div>{change >= 0 ? '+' : ''}{change.toLocaleString()} gp</div>
                                                <div className="opacity-70">{change >= 0 ? '+' : ''}{changePct.toFixed(1)}%</div>
                                            </td>
                                            <td className="px-1.5 sm:px-4 py-1 sm:py-2 w-16 sm:w-24">
                                                <Sparkline prices={history} up={change >= 0} />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
