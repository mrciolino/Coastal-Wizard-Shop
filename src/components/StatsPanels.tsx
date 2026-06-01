import { type GeneratedResult } from '../utils/pack';
import { spellLevels, type SpellLevel } from '../utils/spells';
import { schoolOrder, fmtStat, fmtGold } from '../utils/format';
import { LEVEL_LABELS } from '../utils/presets';
import { panel, row, statLabel } from './tokens';

export type SessionStatRow = { label: string; value: number | string };

type Variant = 'desktop' | 'mobile';

type StatsProps = {
    variant: Variant;
    sessionStats: ReadonlyArray<SessionStatRow>;
    schoolCounts: Partial<Record<string, number>>;
    visibleCards: GeneratedResult[];
    profit: number | null;
};

export function SessionStatsPanel({ variant, sessionStats, profit }: Pick<StatsProps, 'variant' | 'sessionStats' | 'profit'>) {
    if (variant === 'desktop') {
        return (
            <section className={`${panel} p-4`}>
                <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mt-0 mb-3">Session stats</h2>
                <div className="grid gap-2">
                    {sessionStats.map(({ label, value }) => (
                        <div key={label} className="flex justify-between items-baseline gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-slate-700/50">
                            <span className={statLabel + ' shrink-0'}>{label}</span>
                            <strong className="text-sm font-bold text-slate-100 text-right leading-none">
                                {typeof value === 'number' ? fmtStat(value) : value}
                            </strong>
                        </div>
                    ))}
                    {profit != null && (
                        <div className="flex justify-between items-baseline gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-slate-700/50">
                            <span className={statLabel + ' shrink-0'}>Gold profit</span>
                            <strong className={`text-sm font-bold text-right leading-none ${profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {profit >= 0 ? '+' : ''}{fmtGold(Math.abs(profit))}
                            </strong>
                        </div>
                    )}
                </div>
            </section>
        );
    }
    return (
        <section className="grid gap-2">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mt-0 mb-0">Session stats</h2>
            {sessionStats.map(({ label, value }) => (
                <div key={label} className="flex justify-between gap-2 text-xs rounded-lg bg-white/5 border border-slate-700/50 px-3 py-2">
                    <span className="text-slate-300">{label}</span>
                    <strong className="text-slate-100">{typeof value === 'number' ? fmtStat(value) : value}</strong>
                </div>
            ))}
            {profit != null && (
                <div className="flex justify-between gap-2 text-xs rounded-lg bg-white/5 border border-slate-700/50 px-3 py-2">
                    <span className="text-slate-300">Gold profit</span>
                    <strong className={profit >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                        {profit >= 0 ? '+' : ''}{fmtGold(Math.abs(profit))}
                    </strong>
                </div>
            )}
        </section>
    );
}

export function LevelStatsPanel({ variant, visibleCards }: Pick<StatsProps, 'variant' | 'visibleCards'>) {
    const levelCount = (lvl: SpellLevel) => visibleCards.filter((e) => e.card.level === lvl).length;
    if (variant === 'desktop') {
        return (
            <section className={`${panel} p-4`}>
                <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mt-0 mb-2.5">By Level</h2>
                <ul className="list-none p-0 m-0 grid gap-1.5">
                    {spellLevels.map((lvl) => (
                        <li key={lvl} className={row}>
                            <span className="text-slate-300">{LEVEL_LABELS[lvl]}</span>
                            <strong className="text-slate-100">{fmtStat(levelCount(lvl))}</strong>
                        </li>
                    ))}
                </ul>
            </section>
        );
    }
    return (
        <section className="grid gap-2">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mt-0 mb-0">By Level</h2>
            {spellLevels.map((lvl) => (
                <div key={lvl} className="flex justify-between gap-2 text-xs rounded-lg bg-white/5 border border-slate-700/50 px-3 py-2">
                    <span className="text-slate-300">{LEVEL_LABELS[lvl]}</span>
                    <strong className="text-slate-100">{fmtStat(levelCount(lvl))}</strong>
                </div>
            ))}
        </section>
    );
}

export function SchoolStatsPanel({ variant, schoolCounts }: Pick<StatsProps, 'variant' | 'schoolCounts'>) {
    if (variant === 'desktop') {
        return (
            <section className={`${panel} p-4`}>
                <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mt-0 mb-2.5">Schools</h2>
                <ul className="list-none p-0 m-0 grid gap-1.5">
                    {schoolOrder.map((school) => (
                        <li key={school} className={row}>
                            <span className="text-slate-300">{school}</span>
                            <strong className="text-slate-100">{fmtStat(schoolCounts[school] ?? 0)}</strong>
                        </li>
                    ))}
                </ul>
            </section>
        );
    }
    return (
        <section className="grid gap-2">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mt-0 mb-0">Schools</h2>
            {schoolOrder.map((school) => (
                <div key={school} className="flex justify-between gap-2 text-xs rounded-lg bg-white/5 border border-slate-700/50 px-3 py-2">
                    <span className="text-slate-300">{school}</span>
                    <strong className="text-slate-100">{fmtStat(schoolCounts[school] ?? 0)}</strong>
                </div>
            ))}
        </section>
    );
}
