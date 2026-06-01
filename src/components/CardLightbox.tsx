import { useRef, type TouchEvent } from 'react';
import { RefreshCw } from 'lucide-react';
import { type GeneratedResult, type SelectedCard } from '../utils/pack';
import { type MarketEntry } from '../utils/pricing';
import { formatRarity } from '../utils/format';
import { panel, eyebrow, secTitle, shinyTag, autographedTag, getRarityTagClass } from './tokens';

type Props = {
    selected: SelectedCard;
    currentPack: GeneratedResult[] | null;
    totalPacks: number;
    flippedCards: Record<string, boolean>;
    marketMap: Map<string, MarketEntry>;
    canPrevCard: boolean;
    canNextCard: boolean;
    canPrevPack: boolean;
    canNextPack: boolean;
    onClose: () => void;
    onNavigate: (dPack: number, dCard: number) => void;
    onToggleFlip: (packIndex: number, cardIndex: number, e: React.MouseEvent) => void;
};

export default function CardLightbox({
    selected, currentPack, totalPacks, flippedCards, marketMap,
    canPrevCard, canNextCard, canPrevPack, canNextPack,
    onClose, onNavigate, onToggleFlip,
}: Props) {
    const touchStart = useRef<{ x: number; y: number } | null>(null);
    const flipKey = `${selected.packIndex}-${selected.cardIndex}`;
    const isFlipped = flippedCards[flipKey] && selected.card.backImageUrl;
    const mEntry = marketMap.get(selected.card.id);
    const price = mEntry
        ? selected.isShiny ? mEntry.shinyPrice
            : selected.isAutographed ? (mEntry.autographPrice ?? mEntry.currentPrice)
                : mEntry.currentPrice
        : null;

    function handleTouchStart(e: TouchEvent<HTMLDivElement>) {
        const touch = e.changedTouches.item(0);
        if (!touch) return;
        touchStart.current = { x: touch.clientX, y: touch.clientY };
    }
    function handleTouchEnd(e: TouchEvent<HTMLDivElement>) {
        if (!touchStart.current) return;
        const touch = e.changedTouches.item(0);
        if (!touch) return;
        const dx = touch.clientX - touchStart.current.x;
        const dy = touch.clientY - touchStart.current.y;
        touchStart.current = null;
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 48) {
            onNavigate(0, dx > 0 ? -1 : 1);
            return;
        }
        if (Math.abs(dy) > 64) {
            onNavigate(dy > 0 ? -1 : 1, 0);
        }
    }

    return (
        <div
            className="fixed inset-0 bg-slate-950/92 backdrop-blur-md flex items-center justify-center p-1 sm:p-4 z-20"
            onClick={onClose}
            role="presentation"
        >
            <div
                className={`${panel} relative flex flex-col w-full max-w-9/10 overflow-hidden`}
                style={{ maxHeight: 'calc(100dvh - 0.5rem)' }}
                role="dialog"
                aria-modal="true"
                aria-labelledby="modal-title"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between gap-3 px-3 py-2 sm:py-3 sm:px-5 border-b border-slate-700/60 shrink-0">
                    <div className="w-8 shrink-0" />
                    <div className="flex flex-col items-center gap-0.5 sm:gap-1 flex-1 text-center">
                        <span className="text-sm font-medium text-slate-200">
                            Pack <span className="text-white font-bold">{selected.packIndex + 1}</span>
                            <span className="text-slate-500 mx-2">·</span>
                            Card <span className="text-white font-bold">{selected.cardIndex + 1}</span>
                            <span className="text-slate-500 mx-1">/</span>
                            <span className="text-slate-400">{currentPack?.length ?? 0}</span>
                        </span>
                        <span className="hidden sm:block text-xs text-slate-500">
                            use{' '}<kbd className="px-1 py-0.5 rounded bg-slate-800 border border-slate-700 text-xs font-mono">←</kbd>
                            <kbd className="ml-0.5 px-1 py-0.5 rounded bg-slate-800 border border-slate-700 text-xs font-mono">→</kbd>
                            <kbd className="ml-0.5 px-1 py-0.5 rounded bg-slate-800 border border-slate-700 text-xs font-mono">↑</kbd>
                            <kbd className="ml-0.5 px-1 py-0.5 rounded bg-slate-800 border border-slate-700 text-xs font-mono">↓</kbd>
                            {' '}to navigate
                        </span>
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

                {/* Body */}
                <div className="flex flex-col sm:flex-row gap-0 overflow-hidden flex-1 min-h-0">
                    {/* Image area */}
                    <div
                        className="flex flex-col flex-[3] min-h-0 sm:flex-none sm:w-3/5 bg-slate-950/60 touch-pan-y"
                        onTouchStart={handleTouchStart}
                        onTouchEnd={handleTouchEnd}
                        onTouchCancel={() => { touchStart.current = null; }}
                    >
                        <button
                            type="button"
                            onClick={() => onNavigate(-1, 0)}
                            disabled={!canPrevPack}
                            aria-label="Previous pack"
                            className="h-7 shrink-0 flex items-center justify-center border-b border-slate-700/50 text-base sm:text-lg font-bold text-slate-400 hover:text-white hover:bg-white/6 disabled:opacity-20 disabled:cursor-not-allowed transition-all"
                        >
                            ↑
                        </button>

                        <div className="flex items-stretch flex-1 min-h-0">
                            <button
                                type="button"
                                onClick={() => onNavigate(0, -1)}
                                disabled={!canPrevCard}
                                aria-label="Previous card"
                                className="w-8 shrink-0 flex items-center justify-center border-r border-slate-700/50 text-2xl font-bold text-slate-400 hover:text-white hover:bg-white/6 disabled:opacity-20 disabled:cursor-not-allowed transition-all"
                            >
                                ‹
                            </button>

                            <div className="relative flex-1 flex items-center justify-center overflow-hidden p-1 sm:p-3">
                                {selected.isShiny && <div className="shiny-card absolute inset-0 pointer-events-none" />}
                                {selected.isAutographed && <div className="autographed-card absolute inset-0 pointer-events-none" />}
                                <img
                                    src={isFlipped ? selected.card.backImageUrl! : selected.card.imageUrl}
                                    alt={selected.card.displayName}
                                    className="object-contain max-w-full max-h-full"
                                />
                                {selected.card.backImageUrl && (
                                    <button
                                        type="button"
                                        aria-label={isFlipped ? 'Show front' : 'Show back'}
                                        onClick={(e) => onToggleFlip(selected.packIndex, selected.cardIndex, e)}
                                        className="absolute top-2 right-2 w-10 h-10 flex items-center justify-center rounded-full bg-black/60 hover:bg-indigo-600 text-white opacity-50 hover:opacity-100 transition-all cursor-pointer z-10 shadow-lg"
                                    >
                                        <RefreshCw size={20} strokeWidth={2} />
                                    </button>
                                )}
                            </div>

                            <button
                                type="button"
                                onClick={() => onNavigate(0, 1)}
                                disabled={!canNextCard}
                                aria-label="Next card"
                                className="w-8 shrink-0 flex items-center justify-center border-l border-slate-700/50 text-2xl font-bold text-slate-400 hover:text-white hover:bg-white/6 disabled:opacity-20 disabled:cursor-not-allowed transition-all"
                            >
                                ›
                            </button>
                        </div>

                        <button
                            type="button"
                            onClick={() => onNavigate(1, 0)}
                            disabled={!canNextPack}
                            aria-label="Next pack"
                            className="h-7 shrink-0 flex items-center justify-center border-t border-slate-700/50 text-base sm:text-lg font-bold text-slate-400 hover:text-white hover:bg-white/6 disabled:opacity-20 disabled:cursor-not-allowed transition-all"
                        >
                            ↓
                        </button>
                    </div>

                    {/* Metadata panel */}
                    <div className="flex-[2] min-h-0 sm:flex-none sm:w-2/5 border-t sm:border-t-0 sm:border-l border-slate-700/60 flex flex-col overflow-y-auto">
                        <div className="p-3 sm:p-5 flex flex-col gap-2.5 sm:gap-4 flex-1">
                            <div>
                                <p className={eyebrow}>
                                    Pack {selected.packIndex + 1} of {totalPacks}
                                    {' · '}
                                    Card {selected.cardIndex + 1} of {currentPack?.length ?? 0}
                                </p>
                                <h2 id="modal-title" className="text-xl sm:text-2xl font-bold text-slate-50 mt-1 mb-0 leading-tight">
                                    {selected.card.displayName}
                                </h2>
                                <p className="text-slate-500 text-sm mt-1 mb-0 break-words">
                                    {selected.card.fileName}.png
                                </p>
                            </div>

                            <div className="flex flex-wrap gap-2">
                                {selected.isShiny && <span className={shinyTag}>✦ Shiny</span>}
                                {selected.isAutographed && <span className={autographedTag}>✍ Autographed</span>}
                                <span className="px-3 py-1 rounded-lg text-sm text-slate-300 bg-white/5 border border-slate-700/50">
                                    {selected.card.school}
                                </span>
                                <span className="px-3 py-1 rounded-lg text-sm text-slate-300 bg-white/5 border border-slate-700/50">
                                    Level {selected.card.level}
                                </span>
                                <span className={`px-3 py-1 rounded-lg text-sm border ${getRarityTagClass(selected.card.rarity)}`}>
                                    {formatRarity(selected.card.rarity)}
                                </span>
                            </div>

                            {mEntry && price != null && (
                                <div className="rounded-xl p-3 bg-white/5 border border-slate-700/50">
                                    <p className={`${secTitle} mb-1.5`}>Market price</p>
                                    <div className="flex items-baseline gap-2">
                                        <span className="text-lg font-bold text-slate-100">{price} gp</span>
                                        <span className={`text-sm font-medium ${mEntry.changePct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                            {mEntry.changePct >= 0 ? '+' : ''}{mEntry.changePct.toFixed(1)}%
                                        </span>
                                        <span className="text-xs text-slate-500 ml-auto">vs yesterday</span>
                                    </div>
                                </div>
                            )}

                            <div className="grid gap-1 rounded-xl p-3 bg-white/5 border border-slate-700/50">
                                <p className={`${secTitle} mb-1`}>Pack context</p>
                                {currentPack && (() => {
                                    const conjCount = currentPack.filter((e) => e.pool === 'conjuration').length;
                                    return (
                                        <div className="grid grid-cols-2 gap-1">
                                            {[
                                                ['Pack', `${selected.packIndex + 1} of ${totalPacks}`],
                                                ['Card in pack', `${selected.cardIndex + 1} of ${currentPack.length}`],
                                                ['Conjuration', conjCount],
                                                ['Staple', currentPack.length - conjCount],
                                            ].map(([label, value]) => (
                                                <div key={String(label)} className="grid gap-0.5 p-1 rounded-lg bg-white/4 text-xs">
                                                    <span className="text-slate-400 leading-none">{label}</span>
                                                    <strong className="text-slate-200 leading-tight">{value}</strong>
                                                </div>
                                            ))}
                                        </div>
                                    );
                                })()}
                            </div>

                            <div className="hidden sm:grid grid-cols-2 gap-2 mt-auto pt-2">
                                <button
                                    type="button"
                                    onClick={() => onNavigate(0, -1)}
                                    disabled={!canPrevCard}
                                    className="rounded-xl py-2.5 bg-white/8 border border-slate-700/50 text-slate-200 text-sm font-medium hover:bg-white/12 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                                >
                                    ‹ Prev card
                                </button>
                                <button
                                    type="button"
                                    onClick={() => onNavigate(0, 1)}
                                    disabled={!canNextCard}
                                    className="rounded-xl py-2.5 bg-white/8 border border-slate-700/50 text-slate-200 text-sm font-medium hover:bg-white/12 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                                >
                                    Next card ›
                                </button>
                                <button
                                    type="button"
                                    onClick={() => onNavigate(-1, 0)}
                                    disabled={!canPrevPack}
                                    className="rounded-xl py-2.5 bg-white/5 border border-slate-700/40 text-slate-400 text-sm font-medium hover:bg-white/10 hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                                >
                                    ↑ Prev pack
                                </button>
                                <button
                                    type="button"
                                    onClick={() => onNavigate(1, 0)}
                                    disabled={!canNextPack}
                                    className="rounded-xl py-2.5 bg-white/5 border border-slate-700/40 text-slate-400 text-sm font-medium hover:bg-white/10 hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                                >
                                    Next pack ↓
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
