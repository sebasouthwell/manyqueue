import { Trophy, Prohibit, Detective, X } from "@phosphor-icons/react";
import type { GamesHistory, GamesState, RoomSettings } from "@manyqueue/shared";
import { Emoji } from "./Emoji";

function ago(at: number): string {
  const min = Math.max(0, Math.round((Date.now() - at) / 60_000));
  return min < 1 ? "just now" : `${min} min ago`;
}

function Card({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-lg bg-panel ring-1 ring-panel-line p-4">
      <h3 className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-accent-300">
        {icon} {title}
      </h3>
      {children}
    </section>
  );
}

/** The desk's Games section: the contest pool, ban votes and Guess Who, each with how it went tonight. */
export function GamesSection({
  code,
  state,
  history,
  settings,
  canVeto,
  onPickTwo,
  onChanged,
}: {
  code: string;
  state: GamesState | null;
  history: GamesHistory | null;
  settings: RoomSettings | null;
  canVeto: boolean;
  onPickTwo: () => void;
  onChanged: () => void;
}) {
  const pool = state?.contest;

  async function removeEntry(id: string) {
    await fetch(`/rooms/${code}/contest/entries/${id}`, { method: "DELETE" });
    onChanged();
  }

  async function patchSetting(patch: Partial<RoomSettings>) {
    await fetch(`/rooms/${code}/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }
  const setGuessWho = (on: boolean) => patchSetting({ guessWhoMode: on });

  async function startContest() {
    await fetch(`/rooms/${code}/contest/start`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  }

  return (
    <div className="grid w-full grid-cols-2 items-start gap-4">
      <div className="col-span-2">
        <Card icon={<Trophy size={14} />} title={`Song contest · ${pool?.entries.length ?? 0} waiting`}>
          {pool && pool.entries.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {pool.entries.map((e) => (
                <li key={e.id} className="flex items-center gap-3 rounded-md bg-bg p-2">
                  {e.albumArtUrl ? <img src={e.albumArtUrl} alt="" className="h-10 w-10 rounded" /> : <div className="h-10 w-10 rounded bg-accent-800" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-accent-100">{e.trackName}</p>
                    <p className="flex items-center gap-1 truncate text-xs text-accent-300">
                      {e.mystery ? (
                        <>
                          <Emoji value="🕵️" size={12} /> Mystery pick
                        </>
                      ) : e.enteredBy ? (
                        <>
                          <Emoji value={e.enteredBy.emoji} size={12} /> {e.enteredBy.nickname}
                        </>
                      ) : null}
                      {e.losses > 0 && <span> · lost {e.losses}</span>}
                    </p>
                  </div>
                  <button onClick={() => removeEntry(e.id)} aria-label={`Remove ${e.trackName} from the pool`} className="text-accent-300">
                    <X size={16} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-accent-300">Guests add songs to the contest from the add sheet. Two from two different guests can start one.</p>
          )}
          <div className="flex gap-2">
            <button
              onClick={startContest}
              disabled={!!pool?.blocker || !!state?.live}
              className="rounded-md border border-accent px-4 py-2 text-sm font-semibold text-accent-100 hover:bg-accent-700/30 disabled:opacity-40"
            >
              Start
            </button>
            <button
              onClick={onPickTwo}
              disabled={(pool?.entries.length ?? 0) < 2 || !!state?.live}
              className="rounded-md border border-accent px-4 py-2 text-sm font-semibold text-accent-100 disabled:opacity-40"
            >
              Pick two
            </button>
            {pool?.blocker && <span className="self-center text-xs text-accent-300">{pool.blocker}</span>}
          </div>
          <p className="text-xs text-accent-300">
            Fairness: a contest winner jumps to the front of the queue, ahead of fair order. It's the one exception, and it lasts for that one song.
          </p>
          {history && history.contests.length > 0 && (
            <ul className="mt-1 flex flex-col gap-1 border-t border-accent-700/50 pt-2 text-xs text-accent-200">
              {history.contests.slice(0, 5).map((c) => (
                <li key={c.id}>
                  <span className="text-accent-100">{c.winner}</span> beat {c.loser}
                  {c.outcome === "tie_break" ? " (a tie, entered first)" : c.outcome === "no_votes" ? " (nobody voted)" : ""} · {ago(c.at)}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card icon={<Prohibit size={14} />} title="Ban votes">
        <p className="text-xs text-accent-300">
          Any guest can call one every {settings?.banCooldownMin ?? 20} minutes. It passes at half the room (at least 4). {canVeto ? "Only you can veto one." : "Only the host can veto."}
        </p>
        {history && history.bans.length > 0 ? (
          <ul className="flex flex-col gap-1.5 text-sm">
            {history.bans.slice(0, 8).map((b) => (
              <li key={b.id} className="rounded-md bg-bg p-2">
                <p className="truncate text-accent-100">{b.trackName}</p>
                <p className="text-xs text-accent-300">
                  {b.outcome === "banned" ? "Banned" : b.outcome === "host_kept" ? "Host kept it" : "Kept"} · {b.yes} ban / {b.no} keep
                  {b.calledBy ? ` · called by ${b.calledBy}` : ""} · {ago(b.at)}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-accent-300">No ban votes yet.</p>
        )}
      </Card>

      <Card icon={<Detective size={14} />} title="Guess Who">
        <label className="flex items-center justify-between gap-3 text-sm text-accent-100">
          Every pick is a mystery
          <input
            type="checkbox"
            checked={settings?.guessWhoMode ?? false}
            onChange={(e) => setGuessWho(e.target.checked)}
            className="h-5 w-5 accent-[rgb(var(--color-accent))]"
          />
        </label>
        <p className="text-xs text-accent-300">Guests can also queue one anonymously. Adders stay hidden, even from you, until the reveal.</p>
        <label className="flex items-center justify-between gap-3 text-sm text-accent-100">
          Quick "Who queued this?" on some songs
          <input
            type="checkbox"
            checked={settings?.quickGuess ?? false}
            onChange={(e) => patchSetting({ quickGuess: e.target.checked })}
            className="h-5 w-5 accent-[rgb(var(--color-accent))]"
          />
        </label>
        <p className="text-xs text-accent-300">About one ordinary song in five, for 20 seconds, just for fun. No tokens.</p>
        {history && history.guesses.length > 0 ? (
          <ul className="flex flex-col gap-1.5 text-sm">
            {history.guesses.slice(0, 8).map((g) => (
              <li key={g.id} className="rounded-md bg-bg p-2">
                <p className="truncate text-accent-100">
                  {g.trackName} · <span className="text-accent-300">{g.adder}</span>
                </p>
                <p className="text-xs text-accent-300">
                  {g.correct} of {g.guessers} guessed right · {ago(g.at)}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-accent-300">No reveals yet.</p>
        )}
      </Card>
    </div>
  );
}
