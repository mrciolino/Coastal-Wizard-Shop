import { RefreshCw } from 'lucide-react';
import { type GeneratedResult, type SelectedCard } from '../utils/pack';
import { type MarketEntry } from '../utils/pricing';
import { formatRarity } from '../utils/format';
import { panel, tag, shinyTag, autographedTag, muted, getRarityTagClass } from './tokens';

type Props = {
    packs: GeneratedResult[][];
    renderedCount: number;
    flippedCards: Record<string, boolean>;
    marketMap: Map<string, MarketEntry>;
    onSelectCard: (selection: SelectedCard) => void;
    onToggleFlip: (packIndex: number, cardIndex: number, e: React.MouseEvent) => void;
};

export default function SpellCardGrid({ packs, renderedCount, flippedCards, marketMap, onSelectCard, onToggleFlip }: Props) {
    return (
        <div className={`${panel} p-3 sm:p-4 w-full`}>
            <div className="flex items-center justify-between gap-2 mb-3">
                <h2 className="text-base font-semibold text-slate-100 mt-0 mb-0">Spell cards</h2>
                <span className={muted}>{packs.length} pack(s)</span>
            </div>

            {packs.length === 0 ? (
                <div className="border border-dashed border-slate-700/60 rounded-xl p-6 sm:p-8 text-center">
                    <p className="text-slate-300 font-medium mb-1">No packs opened yet.</p>
                    <span className="text-slate-500 text-sm">Configure the pack settings, then open it.</span>
                </div>
            ) : (
                <div className="grid gap-3">
                    {packs.slice(0, renderedCount).map((pack, packIndex) => {
                        const conjCount = pack.filter((e) => e.pool === 'conjuration').length;
                        return (
                            <article key={`${packIndex}-${pack.length}`}
                                className="rounded-xl p-3 bg-slate-950/50 border border-slate-700/40">
                                <header className="flex items-baseline justify-between gap-2 mb-3">
                                    <h3 className="text-sm font-semibold text-slate-100 mt-0 mb-0 shrink-0">Pack {packIndex + 1}</h3>
                                    <p className="text-slate-500 text-xs m-0 text-right">{conjCount} conjuration · {pack.length - conjCount} staple · {pack.length} cards</p>
                                </header>

                                <ol className="list-none p-0 m-0 grid gap-2 grid-cols-1 sm:grid-cols-[repeat(auto-fit,minmax(280px,1fr))]">
                                    {pack.map((entry, cardIndex) => {
                                        const key = `${packIndex}-${cardIndex}`;
                                        const isFlipped = flippedCards[key] && entry.card.backImageUrl;
                                        const mEntry = marketMap.get(entry.card.id);
                                        const price = mEntry
                                            ? entry.isShiny ? mEntry.shinyPrice
                                                : entry.isAutographed ? (mEntry.autographPrice ?? mEntry.currentPrice)
                                                    : mEntry.currentPrice
                                            : null;
                                        return (
                                            <li
                                                key={`${entry.card.id}-${cardIndex}`}
                                                onClick={() => onSelectCard({ card: entry.card, pool: entry.pool, isShiny: entry.isShiny, isAutographed: entry.isAutographed, packIndex, cardIndex })}
                                                className={`relative overflow-hidden p-2.5 rounded-xl bg-white/4 border border-slate-700/40 hover:bg-white/8 transition-colors cursor-zoom-in${entry.isShiny ? ' shiny-card' : ''}${entry.isAutographed ? ' autographed-card' : ''}`}
                                            >
                                                <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3 items-center sm:grid-cols-[6rem_minmax(0,1fr)]">
                                                    <div className="relative overflow-hidden w-20 h-28 sm:w-24 sm:h-32 shrink-0 group">
                                                        <img
                                                            src={isFlipped ? entry.card.backImageUrl! : entry.card.imageUrl}
                                                            alt={entry.card.fileName}
                                                            loading="lazy"
                                                            className="w-full h-full object-contain rounded-lg border border-slate-700/40 bg-slate-950/80"
                                                        />
                                                        {entry.card.backImageUrl && (
                                                            <button
                                                                type="button"
                                                                aria-label={isFlipped ? 'Show front' : 'Show back'}
                                                                onClick={(e) => onToggleFlip(packIndex, cardIndex, e)}
                                                                className="absolute top-1 right-1 w-7 h-7 flex items-center justify-center rounded-full bg-black/60 hover:bg-indigo-600 text-white opacity-0 group-hover:opacity-100 transition-all cursor-pointer z-10 shadow-lg"
                                                            >
                                                                <RefreshCw size={14} strokeWidth={2.5} />
                                                            </button>
                                                        )}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <div className="font-semibold text-sm leading-tight text-slate-100 mb-0.5">{entry.card.displayName}</div>
                                                        <div className="text-xs text-slate-500 mb-2 break-words">{entry.card.fileName}.png</div>
                                                        <div className="flex flex-wrap gap-1">
                                                            {entry.isShiny && <span className={shinyTag}>Shiny</span>}
                                                            {entry.isAutographed && <span className={autographedTag}>Autographed</span>}
                                                            <span className={tag}>{entry.card.school}</span>
                                                            <span className={tag}>Level {entry.card.level}</span>
                                                            <span className={`px-2 py-0.5 rounded-full text-xs border ${getRarityTagClass(entry.card.rarity)}`}>{formatRarity(entry.card.rarity)}</span>
                                                        </div>
                                                        {mEntry && price != null && (
                                                            <div className="flex items-center justify-start gap-1.5 mt-1.5">
                                                                <span className="text-xs font-semibold text-amber-400">{price} gp</span>
                                                                <span className={`text-xs font-medium ${mEntry.changePct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                                                    {mEntry.changePct >= 0 ? '+' : ''}{mEntry.changePct.toFixed(1)}%
                                                                </span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </li>
                                        );
                                    })}
                                </ol>
                            </article>
                        );
                    })}
                    {renderedCount < packs.length && (
                        <p className="text-center text-slate-500 text-xs py-2">
                            Showing {Math.min(renderedCount, packs.length)} of {packs.length} packs — scroll for more
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
