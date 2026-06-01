import { type PackPreset } from '../utils/presets';
import { panel, eyebrow, secTitle, field, row, inp, muted } from './tokens';
import PackPresetPicker from './PackPresetPicker';

type Props = {
    presets: PackPreset[];
    selectedPreset: PackPreset;
    onSelectPreset: (preset: PackPreset) => void;
    goldInputValue: string;
    onGoldChange: (value: string) => void;
    onGoldBlur: () => void;
    packCount: number;
    cardsInPack: number;
    libraryInfo: ReadonlyArray<readonly [string, number]>;
    onOpenPacks: () => void;
    onClear: () => void;
    onShowOdds: () => void;
    onShowMarket: () => void;
};

export default function DesktopLeftRail({
    presets, selectedPreset, onSelectPreset,
    goldInputValue, onGoldChange, onGoldBlur,
    packCount, cardsInPack, libraryInfo,
    onOpenPacks, onClear, onShowOdds, onShowMarket,
}: Props) {
    return (
        <aside className="min-w-0 overflow-y-auto py-4">
            <div className={`${panel} grid gap-0 p-0 overflow-hidden`}>
                <div className="px-4 pt-4 pb-3 border-b border-slate-700/50">
                    <p className={eyebrow}>5e Scroll Pack Opener</p>
                    <h1 className="text-xl sm:text-2xl font-bold leading-tight mt-1 mb-1 text-slate-50">Pack controls</h1>
                    <p className={`${muted} leading-snug`}>Configure values, then open a batch on the right.</p>
                </div>

                <div className="px-4 py-2.5 border-b border-slate-700/50 grid gap-1.5">
                    <p className={secTitle}>Pack type</p>
                    <PackPresetPicker presets={presets} selectedId={selectedPreset.id} onSelect={onSelectPreset} />
                </div>

                <div className="px-4 py-2.5 border-b border-slate-700/50 grid gap-1.5">
                    <button
                        type="button"
                        onClick={onOpenPacks}
                        disabled={packCount === 0 || cardsInPack <= 0}
                        className="w-full rounded-xl px-3 py-2 bg-gradient-to-br from-violet-500 to-blue-500 text-white text-sm font-semibold shadow-lg transition-all hover:-translate-y-px hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed disabled:translate-y-0 disabled:brightness-100 border-0"
                    >
                        Open {packCount} {selectedPreset.name}{packCount !== 1 ? 's' : ''}
                    </button>
                    <button
                        type="button"
                        onClick={onClear}
                        className="w-full rounded-xl px-3 py-2 bg-white/8 text-slate-200 text-sm font-medium transition-all hover:-translate-y-px hover:bg-white/12 border border-slate-700/50"
                    >
                        Clear
                    </button>
                    <button
                        type="button"
                        onClick={onShowOdds}
                        className="w-full rounded-xl px-3 py-1.5 bg-white/8 text-slate-200 text-xs font-medium transition-all hover:bg-white/12 border border-slate-700/50"
                    >
                        📊 Odds
                    </button>
                    <button
                        type="button"
                        onClick={onShowMarket}
                        className="w-full rounded-xl px-3 py-1.5 bg-white/8 text-slate-200 text-xs font-medium transition-all hover:bg-white/12 border border-slate-700/50"
                    >
                        💰 Market
                    </button>
                </div>

                <div className="px-4 py-3 border-b border-slate-700/50 grid gap-2.5">
                    <p className={secTitle}>Pack settings</p>
                    <label className={field}>
                        <span className="text-xs uppercase tracking-wider text-indigo-300/80 font-medium">Gold budget</span>
                        <input
                            type="number"
                            min={0}
                            step={5}
                            value={goldInputValue}
                            onChange={(e) => onGoldChange(e.target.value)}
                            onBlur={onGoldBlur}
                            className={inp}
                        />
                    </label>
                </div>

                <div className="px-4 py-3 grid gap-2.5">
                    <p className={secTitle}>Information</p>
                    <ul className="list-none p-0 m-0 grid gap-1.5">
                        {libraryInfo.map(([label, val]) => (
                            <li key={label} className={row}>
                                <span className="text-slate-300">{label}</span>
                                <strong className="text-slate-100">{val}</strong>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        </aside>
    );
}
