import { useState } from "react";
import { Trophy, Prohibit, Detective, Stop } from "@phosphor-icons/react";
import { banBarLayout, type GamesState } from "@manyqueue/shared";
import { useServerNow } from "../hooks/useServerNow";
import { formatCountdown } from "../lib/format";
import { Emoji } from "./Emoji";

const ICON = { contest: Trophy, ban: Prohibit, guess: Detective, skip: Stop } as const;

/**
 * Right-rail slot 3 (UI-GUIDE §4.4). While a vote is live: the question, a live
 * bar, the countdown, and End now / Veto (veto is the host's alone). Otherwise
 * a launcher for the song contest with the reason it can't start, if any.
 */
export function LiveGameCard({
  code,
  state,
  canVeto,
  onPickTwo,
}: {
  code: string;
  state: GamesState | null;
  canVeto: boolean;
  onPickTwo: () => void;
}) {
  const live = state?.live ?? null;
  const now = useServerNow(!!live, 250);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post(path: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/rooms/${code}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? "That didn't work. Try again.");
      }
    } catch {
      setError("That didn't work. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  if (live) {
    const Icon = ICON[live.type as keyof typeof ICON] ?? Trophy;
    const left = Math.max(0, live.deadlineAt - now);
    const yes = live.options.find((o) => o.id === "yes")?.count ?? 0;
    const no = live.options.find((o) => o.id === "no")?.count ?? 0;
    const layout = live.ban ? banBarLayout(yes, no, live.ban.active, live.ban.threshold) : null;
    const optionTotal = Math.max(1, live.options.reduce((sum, o) => sum + o.count, 0));

    return (
      <div className="flex w-full flex-col gap-3 rounded-lg bg-panel ring-1 ring-panel-line p-4 shadow-[0_0_0_1px_rgb(var(--color-accent))]" role="group" aria-label="Live game">
        <div className="flex items-start justify-between gap-2">
          <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-accent-300">
            <Icon size={14} weight="fill" /> Live now
          </p>
          <p className="tabular-nums text-xl font-bold text-accent-100">{formatCountdown(left)}</p>
        </div>
        <p className="text-sm font-semibold text-accent-100">{live.title}</p>

        {layout && live.ban ? (
          <div>
            <div className="relative">
              <div className="flex h-2.5 overflow-hidden rounded-full bg-accent-800">
                <div style={{ width: `${layout.yesPct}%`, background: "rgb(var(--color-danger))", transition: "width 300ms ease" }} />
                <div className="flex-1" />
                <div style={{ width: `${layout.noPct}%`, background: "rgb(var(--color-accent-300))", transition: "width 300ms ease" }} />
              </div>
              <div className="absolute bg-accent-100" style={{ left: `${layout.thresholdPct}%`, top: -4, width: 3, height: 18, borderRadius: 2, transform: "translateX(-1.5px)" }} />
            </div>
            <div className="mt-1.5 flex justify-between text-xs tabular-nums text-accent-300">
              <span>Ban · {yes}</span>
              <span className="text-accent-100">Needs {live.ban.threshold}</span>
              <span>Keep · {no}</span>
            </div>
          </div>
        ) : live.countsHidden ? (
          <p className="text-xs text-accent-300">{live.total} guess{live.total === 1 ? "" : "es"} in. Results stay hidden until the reveal.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {live.options.map((o) => (
              <div key={o.id}>
                <div className="flex items-center justify-between gap-2 text-xs text-accent-200">
                  <span className="flex min-w-0 items-center gap-1 truncate">
                    {o.emoji && <Emoji value={o.emoji} size={12} />}
                    {o.label}
                  </span>
                  <span className="tabular-nums">{o.count}</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-accent-800">
                  <div className="h-full rounded-full bg-accent-300" style={{ width: `${(o.count / optionTotal) * 100}%`, transition: "width 300ms ease" }} />
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={() => post("/games/end")}
            disabled={busy}
            className="flex-1 rounded-md border border-accent px-3 py-2 text-sm font-semibold text-accent-100 disabled:opacity-50"
          >
            End now
          </button>
          {live.type === "ban" && canVeto && (
            <button
              onClick={() => post("/ban/veto")}
              disabled={busy}
              className="flex-1 rounded-md bg-danger/20 px-3 py-2 text-sm font-semibold text-danger disabled:opacity-50"
            >
              Veto
            </button>
          )}
        </div>
        {error && <p className="text-xs text-danger" role="alert">{error}</p>}
      </div>
    );
  }

  const pool = state?.contest;
  const count = pool?.entries.length ?? 0;
  const blocked = pool?.blocker ?? null;

  return (
    <div className="flex w-full flex-col gap-2 rounded-lg bg-panel ring-1 ring-panel-line p-4" role="group" aria-label="Game launcher">
      <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-accent-300">
        <Trophy size={14} /> Song contest
      </p>
      <p className="text-sm text-accent-200">
        {count} song{count === 1 ? "" : "s"} waiting{blocked ? ` · ${blocked}` : ""}
      </p>
      {(pool?.nextAutoInSongs != null || (pool?.spacingSongs ?? 0) > 0) && (
        <p className="text-xs text-accent-300">
          {pool?.nextAutoInSongs != null &&
            (pool.nextAutoInSongs === 0 ? "Auto-contest is due at the next song." : `Auto-contest in ${pool.nextAutoInSongs} song${pool.nextAutoInSongs === 1 ? "" : "s"}.`)}
          {pool?.nextAutoInSongs != null && (pool?.spacingSongs ?? 0) > 0 && " "}
          {(pool?.spacingSongs ?? 0) > 0 && `Guest games resume in ${pool?.spacingSongs} song${pool?.spacingSongs === 1 ? "" : "s"}.`}
        </p>
      )}
      <div className="flex gap-2">
        <button
          onClick={() => post("/contest/start")}
          disabled={busy || !!blocked}
          className="flex-1 rounded-md border border-accent px-3 py-2 text-sm font-semibold text-accent-100 hover:bg-accent-700/30 disabled:opacity-40"
        >
          Start
        </button>
        <button
          onClick={onPickTwo}
          disabled={busy || count < 2}
          className="flex-1 rounded-md border border-accent px-3 py-2 text-sm font-semibold text-accent-100 disabled:opacity-40"
        >
          Pick two
        </button>
      </div>
      {error && <p className="text-xs text-danger" role="alert">{error}</p>}
    </div>
  );
}
