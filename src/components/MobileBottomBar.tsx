import { type GeneratedResult } from '../utils/pack';
import { fmtStat } from '../utils/format';
import { panel } from './tokens';
import { SessionStatsPanel, LevelStatsPanel, SchoolStatsPanel, type SessionStatRow } from './StatsPanels';

type Props = {
    visiblePacks: GeneratedResult[][];
    visibleCards: GeneratedResult[];
    sessionStats: ReadonlyArray<SessionStatRow>;
    schoolCounts: Partial<Record<string, number>>;
    shinyCount: number;
    autographedCount: number;
    totalOpened: number;
    profit: number | null;
    showStats: boolean;
    onToggleStats: () => void;
};

export default function MobileBottomBar({
    visiblePacks, visibleCards, sessionStats, schoolCounts,
    shinyCount, autographedCount, totalOpened, profit,
    showStats, onToggleStats,
}: Props) {
    return (
        <div className="xl:hidden fixed inset-x-2 bottom-2 z-10">
            {showStats && (
                <div className={`${panel} mb-2 p-3 max-h-[55vh] overflow-y-auto`}>
                    <div className="grid gap-3 sm:grid-cols-3">
                        <SessionStatsPanel variant="mobile" sessionStats={sessionStats} profit={profit} />
                        <LevelStatsPanel variant="mobile" visibleCards={visibleCards} />
                        <SchoolStatsPanel variant="mobile" schoolCounts={schoolCounts} />
                    </div>
                </div>
            )}
            <div className={`${panel} px-3 py-2.5`}>
                <div className="flex items-center gap-3">
                    <div className="grid flex-1 grid-cols-4 gap-2">
                        {[
                            { label: 'Packs', value: visiblePacks.length },
                            { label: 'Cards', value: totalOpened },
                            { label: 'Shiny', value: shinyCount },
                            { label: 'Autog.', value: autographedCount },
                        ].map(({ label, value }) => (
                            <div key={label} className="rounded-xl bg-white/5 border border-slate-700/50 px-2 py-2 text-center">
                                <div className="text-[10px] uppercase tracking-wider text-slate-400">{label}</div>
                                <div className="text-sm font-semibold text-slate-50">{fmtStat(value)}</div>
                            </div>
                        ))}
                    </div>
                    <button
                        type="button"
                        onClick={onToggleStats}
                        className={`shrink-0 rounded-xl px-3 py-2 text-sm font-medium transition-all border ${showStats ? 'bg-indigo-500/20 text-indigo-200 border-indigo-500/40' : 'bg-white/8 text-slate-200 border-slate-700/50 hover:bg-white/12'}`}
                    >
                        Stats
                    </button>
                </div>
            </div>
        </div>
    );
}
