import { Info } from 'lucide-react';
import { type PackPreset, getPackRarityBreakdown } from '../utils/presets';
import { formatRarity } from '../utils/format';
import { getRarityTagClass } from './tokens';

type Props = {
    presets: PackPreset[];
    selectedId: string;
    onSelect: (preset: PackPreset) => void;
};

export default function PackPresetPicker({ presets, selectedId, onSelect }: Props) {
    return (
        <div className="flex gap-2">
            {presets.map((preset, i) => {
                const rarityRows = getPackRarityBreakdown(preset.levelWeights);
                const isSelected = selectedId === preset.id;
                return (
                    <div key={preset.id} className="flex-1 relative group/pack">
                        <button
                            type="button"
                            onClick={() => onSelect(preset)}
                            className={`w-full rounded-xl px-3 py-2 text-sm font-semibold transition-all border flex flex-col items-center leading-tight ${isSelected ? 'bg-indigo-500/20 text-indigo-200 border-indigo-500/40' : 'bg-white/8 text-slate-200 border-slate-700/50 hover:bg-white/12'}`}
                        >
                            <span className="block">{preset.name}</span>
                            <span className="block text-[10px] font-normal opacity-70">{preset.packPrice.toLocaleString()} gp</span>
                        </button>
                        <Info size={10} className="absolute top-1 right-1.5 text-slate-600 group-hover/pack:text-slate-400 pointer-events-none transition-colors" />
                        <div className={`absolute top-full mt-1 z-50 w-52 rounded-xl bg-slate-900 border border-slate-700/60 shadow-xl p-2.5 opacity-0 group-hover/pack:opacity-100 transition-opacity pointer-events-none ${i === 0 ? 'left-0' : 'right-0'}`}>
                            <p className="text-xs font-semibold text-slate-300 mb-1.5 pb-1 border-b border-slate-700/50">
                                {preset.cardsInPack} cards · {preset.conjurationRate}% Conj · {100 - preset.conjurationRate}% Staple
                            </p>
                            <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-1 my-1.5">
                                {rarityRows.map(({ rarity, pct, levelLabel }) => (
                                    <div key={levelLabel} className="contents">
                                        <span className={`${getRarityTagClass(rarity)} px-1.5 py-0.5 rounded border text-xs capitalize`}>
                                            {formatRarity(rarity)}
                                        </span>
                                        <span className="text-slate-400 text-xs">{levelLabel}</span>
                                        <span className="text-slate-200 text-xs font-medium text-right tabular-nums">{pct >= 10 ? pct.toFixed(0) : pct >= 1 ? pct.toFixed(1) : pct >= 0.1 ? pct.toFixed(2) : pct.toFixed(3)}%</span>
                                    </div>
                                ))}
                            </div>
                            <div className="border-t border-slate-700/50 pt-1.5 grid gap-0.5">
                                <div className="flex justify-between text-xs">
                                    <span className="text-slate-400">✦ Shiny</span>
                                    <span className="text-slate-200">{(preset.shinyChance * 100).toFixed(1)}%</span>
                                </div>
                                <div className="flex justify-between text-xs">
                                    <span className="text-slate-400">✍ Autograph</span>
                                    <span className="text-slate-200">{(preset.autographChance * 100).toFixed(1)}%</span>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
