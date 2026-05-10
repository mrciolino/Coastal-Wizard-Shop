import { useState } from 'react';
import type { SpellOdds } from '../utils/odds';
import type { SpellLevel } from '../utils/spells';
import { spellLevels } from '../utils/spells';
import { formatRarity } from '../utils/format';
import { getRarityTagClass, inp, panel, tag } from './tokens';

const LEVEL_LABELS: Record<number, string> = {
    0: 'Cantrip', 1: 'L1', 2: 'L2', 3: 'L3', 4: 'L4',
    5: 'L5', 6: 'L6', 7: 'L7', 8: 'L8', 9: 'L9',
};

type OddsModalProps = {
    onClose: () => void;
    spellOdds: SpellOdds[];
    cardsInPack: number;
    packPrice: number;
    conjurationRate: number;
    levelWeights: Record<SpellLevel, number>;
};

type SortKey = 'name' | 'chance';
type SortDir = 'asc' | 'desc';

export default function OddsModal({ onClose, spellOdds, cardsInPack, packPrice, conjurationRate, levelWeights: _levelWeights }: OddsModalProps) {
    const [search, setSearch] = useState('');
    const [sortKey, setSortKey] = useState<SortKey>('chance');
    const [sortDir, setSortDir] = useState<SortDir>('asc');

    function handleSort(key: SortKey) {
        if (sortKey === key) {
            setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        } else {
            setSortKey(key);
            setSortDir('desc');
        }
    }

    const levelDrawPcts = spellLevels.reduce<Record<number, number>>((acc, lvl) => {
        acc[lvl] = spellOdds.reduce((s, { spell, pDraw }) => s + (spell.level === lvl ? pDraw : 0), 0);
        return acc;
    }, {});

    const filtered = spellOdds
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
            return dir * (a.pDraw - b.pDraw);
        });

    return (
        <div
            className="fixed inset-0 bg-slate-950/92 backdrop-blur-md flex items-start justify-center p-1 sm:p-4 z-30 overflow-y-auto"
            onClick={onClose}
            role="presentation"
        >
            <div
                className={`${panel} relative w-full max-w-5xl my-1 sm:my-8 flex flex-col`}
                style={{ maxHeight: 'calc(100dvh - 0.5rem)' }}
                role="dialog"
                aria-modal="true"
                aria-labelledby="odds-modal-title"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between gap-2 px-3 sm:px-5 py-2 sm:py-3 border-b border-slate-700/60 shrink-0">
                    <div>
                        <h2 id="odds-modal-title" className="text-base sm:text-lg font-bold text-slate-50 m-0">Spell Odds</h2>
                        <p className="hidden sm:block text-xs text-slate-400 mt-0.5 m-0">Per-card draw chance &amp; probability per {cardsInPack}-card pack</p>
                        <div className="hidden sm:flex flex-wrap gap-1 mt-1">
                            <span className={tag}>{conjurationRate}% conj · {100 - conjurationRate}% staple</span>
                            <span className={tag}>{cardsInPack} cards/pack</span>
                            <span className={tag}>{packPrice} gp/pack</span>
                            {spellLevels.map((lvl) => levelDrawPcts[lvl] > 0 ? (
                                <span key={lvl} className="px-2 py-0.5 rounded-full text-xs border border-slate-600/40 text-slate-300 bg-slate-800/40">
                                    {LEVEL_LABELS[lvl]} {(levelDrawPcts[lvl] * 100).toFixed(1)}%
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

                {/* Search + sort */}
                <div className="px-2 sm:px-4 py-2 border-b border-slate-700/60 shrink-0 flex flex-wrap gap-1.5 sm:gap-2 items-center">
                    <input
                        type="search"
                        placeholder="Filter spells…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className={inp + ' flex-1 min-w-32 text-xs sm:text-sm'}
                        aria-label="Filter spells"
                    />
                    <span className="text-xs text-slate-500 shrink-0">Sort:</span>
                    {(['name', 'chance'] as const).map((key) => (
                        <button
                            key={key}
                            type="button"
                            onClick={() => handleSort(key)}
                            className={`shrink-0 rounded-lg px-2 py-1 text-xs font-medium border transition-all ${sortKey === key ? 'bg-indigo-500/20 text-indigo-200 border-indigo-500/40' : 'bg-white/5 text-slate-400 border-slate-700/50 hover:bg-white/10'}`}
                        >
                            {key === 'name' ? 'Name' : 'Chance'}
                            {sortKey === key ? (sortDir === 'desc' ? ' ▼' : ' ▲') : ''}
                        </button>
                    ))}
                </div>

                {/* Table */}
                <div className="overflow-y-auto flex-1 min-h-0">
                    <table className="w-full border-collapse">
                        <thead className="sticky top-0 bg-slate-900 z-10">
                            <tr>
                                <th className="text-left px-2 sm:px-4 py-1.5 sm:py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-700/60">Spell</th>
                                <th className="text-right px-2 sm:px-4 py-1.5 sm:py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-700/60">Per card</th>
                                <th className="hidden sm:table-cell text-right px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-700/60">Per pack ({cardsInPack})</th>
                                <th className="hidden sm:table-cell text-right px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-700/60">Exp. packs</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map(({ spell, pDraw, pHitInPack, expectedPacks }) => (
                                <tr key={spell.id} className="border-b border-slate-700/30 hover:bg-white/4 transition-colors">
                                    <td className="px-2 sm:px-4 py-1 sm:py-2">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                            <span className="text-slate-100 font-medium text-xs sm:text-sm whitespace-nowrap">{spell.displayName}</span>
                                            <span className={`px-1.5 py-0.5 rounded-full text-xs border ${getRarityTagClass(spell.rarity)}`}>{formatRarity(spell.rarity)}</span>
                                            <span className={tag + ' hidden sm:inline-flex'}>{spell.school}</span>
                                        </div>
                                    </td>
                                    <td className="px-2 sm:px-4 py-1 sm:py-2 text-right align-top">
                                        <div className="font-mono text-xs text-slate-300">{pDraw > 0 ? (pDraw * 100).toFixed(4) + '%' : '—'}</div>
                                        <div className="sm:hidden font-mono text-xs text-slate-500 leading-tight">{pHitInPack > 0 ? (pHitInPack * 100).toFixed(3) + '%' : '—'}</div>
                                        <div className="sm:hidden font-mono text-xs text-slate-500 leading-tight">{Number.isFinite(expectedPacks) ? Math.ceil(expectedPacks).toLocaleString() + ' pks' : '—'}</div>
                                    </td>
                                    <td className="hidden sm:table-cell px-4 py-2 text-right text-slate-300 font-mono text-xs">
                                        {pHitInPack > 0 ? (pHitInPack * 100).toFixed(3) + '%' : '—'}
                                    </td>
                                    <td className="hidden sm:table-cell px-4 py-2 text-right text-slate-300 font-mono text-xs">
                                        {Number.isFinite(expectedPacks) ? Math.ceil(expectedPacks).toLocaleString() : '—'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
