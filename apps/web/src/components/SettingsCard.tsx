import { useEffect, useState, type ReactNode } from "react";
import type { RoomSettings } from "@manyqueue/shared";
import { useRoomStore } from "../store/roomStore";

interface SettingsCardProps {
  code: string;
  settings: RoomSettings | null;
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-left text-sm text-accent-100">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        // shrink-0: a long label next to it in a narrow phone column used to squash the track.
        // The ring: "off" is the page background, nearly the same colour as the card it sits on.
        className="relative h-6 w-11 shrink-0 rounded-full p-0 ring-1 ring-inset ring-panel-line transition-colors"
        style={{ background: checked ? "rgb(var(--color-accent))" : "rgb(var(--color-bg))" }}
      >
        {/* left-0 is what was missing: a button centres its content, so without it the knob started in
            the middle of the track and translateX pushed it out the right side when switched on. */}
        <span
          aria-hidden
          className="pointer-events-none absolute left-0 top-0.5 h-5 w-5 rounded-full bg-accent-100 shadow transition-transform"
          style={{ transform: checked ? "translateX(22px)" : "translateX(2px)" }}
        />
      </button>
    </label>
  );
}

function NumberField({
  label,
  value,
  onCommit,
  min = 0,
  max,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  min?: number;
  max?: number;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  return (
    <label className="flex flex-col gap-1 rounded-md bg-panel px-2.5 py-1.5 text-accent-200">
      <span className="text-[10px] uppercase tracking-wide text-accent-300">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          let n = Math.max(min, Number(draft) || min);
          if (max !== undefined) n = Math.min(max, n);
          setDraft(String(n));
          if (n !== value) onCommit(n);
        }}
        className="w-14 bg-transparent text-sm text-accent-100 outline-none"
      />
    </label>
  );
}

/** One "mini box" — a self-contained group of related settings, visually separated from the rest so
 * Shared-only and Rotation-only groups read as distinct at a glance instead of one long flat list. */
function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-w-[240px] flex-1 flex-col gap-2 rounded-lg bg-bg p-3">
      <p className="text-xs uppercase tracking-wide text-accent-300">{title}</p>
      {children}
    </div>
  );
}

export function SettingsCard({ code, settings }: SettingsCardProps) {
  const aiAvailable = useRoomStore((s) => s.aiNicknamesAvailable);
  async function patch(update: Partial<RoomSettings>) {
    await fetch(`/rooms/${code}/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    });
  }

  if (!settings) {
    return (
      <div className="w-full rounded-lg bg-panel ring-1 ring-panel-line p-4 text-sm text-accent-300">
        Loading settings…
      </div>
    );
  }

  const isRotation = settings.mode === "rotation";

  return (
    <div className="flex w-full flex-col gap-4 rounded-lg bg-panel ring-1 ring-panel-line p-4 text-left">
      <p className="text-xs uppercase tracking-wide text-accent-300">Settings</p>

      <div className="flex flex-wrap gap-3">
        <SettingsGroup title="Room mode">
          <div className="flex gap-1 rounded-lg bg-panel p-1" role="radiogroup" aria-label="Room mode">
            {(
              [
                ["shared", "Shared"],
                ["rotation", "Rotation"],
              ] as const
            ).map(([value, label]) => {
              const selected = settings.mode === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => patch({ mode: value })}
                  className={`flex-1 whitespace-nowrap rounded-md px-2 py-1.5 text-center text-xs font-semibold transition-colors ${
                    selected ? "bg-accent text-bg" : "text-accent-200 hover:bg-panel-line/70"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <p className="text-accent-300 text-[10px]">
            Shared: one queue anyone adds to at any time — best under 10 guests. Rotation: everyone keeps their own queue, and the main queue is a live view of everyone's top picks in turn order, each locked in only about 15 seconds before it plays — built for bigger nights.
          </p>
        </SettingsGroup>

        <SettingsGroup title="Tokens">
          <Toggle label="Token mode" checked={settings.tokenMode} onChange={(v) => patch({ tokenMode: v })} />
          {settings.tokenMode && (
            <>
              <div className="flex flex-wrap gap-2">
                <NumberField label="Starting tokens" value={settings.startTokens} onCommit={(v) => patch({ startTokens: v })} />
                <NumberField label="Token cap" value={settings.tokenCap} min={1} onCommit={(v) => patch({ tokenCap: v })} />
                <NumberField label="Earn +1 / N songs" value={settings.earnEverySongs} min={1} onCommit={(v) => patch({ earnEverySongs: v })} />
                <NumberField label="Replay surcharge" value={settings.replaySurcharge} onCommit={(v) => patch({ replaySurcharge: v })} />
                <NumberField label="Co-host grants / hour" value={settings.cohostGrantHourlyLimit} max={50} onCommit={(v) => patch({ cohostGrantHourlyLimit: v })} />
                <NumberField label="Co-host penalties / hour" value={settings.cohostPenaltyHourlyLimit} max={50} onCommit={(v) => patch({ cohostPenaltyHourlyLimit: v })} />
              </div>
              <p className="text-accent-300 text-[10px]">
                The host has no limit on either. Co-hosts are capped so one can't hand out (or dock) tokens without bound.
              </p>
            </>
          )}
        </SettingsGroup>

        {!isRotation && (
          <SettingsGroup title="Shared queue">
            <Toggle label="Fair order (round-robin)" checked={settings.fairOrder} onChange={(v) => patch({ fairOrder: v })} />
            <Toggle label="Approvals" checked={settings.approvals} onChange={(v) => patch({ approvals: v })} />
            <Toggle label="Guess Who mode (every pick is a mystery)" checked={settings.guessWhoMode} onChange={(v) => patch({ guessWhoMode: v })} />
            <div className="flex flex-wrap gap-2">
              {settings.approvals && (
                <NumberField label="Approval grace (sec)" value={settings.approvalGraceSec} onCommit={(v) => patch({ approvalGraceSec: v })} />
              )}
              <NumberField label="Add cooldown (sec)" value={settings.addCooldownSec} onCommit={(v) => patch({ addCooldownSec: v })} />
            </div>
          </SettingsGroup>
        )}

        {isRotation && (
          <SettingsGroup title="Rotation queue">
            <div className="flex flex-wrap gap-2">
              <NumberField label="Personal queue cap" value={settings.personalQueueCap} min={3} max={20} onCommit={(v) => patch({ personalQueueCap: v })} />
              <NumberField label="Mystery slot every" value={settings.mysteryEvery} max={8} onCommit={(v) => patch({ mysteryEvery: v })} />
            </div>
            <p className="text-accent-300 text-[10px]">
              Mystery slot every 0 turns the mystery pool off. Drafting style and who pays are on the Queues board, next to Draft now.
            </p>
          </SettingsGroup>
        )}

        {isRotation && (
          <SettingsGroup title="Next song">
            <div className="flex gap-1 rounded-lg bg-panel p-1" role="radiogroup" aria-label="Next song method">
              {(
                [
                  ["rotation", "Rotation order"],
                  ["crowd", "Crowd pick"],
                ] as const
              ).map(([value, label]) => {
                const selected = settings.nextSongMethod === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => patch({ nextSongMethod: value })}
                    className={`flex-1 whitespace-nowrap rounded-md px-2 py-1.5 text-center text-xs font-semibold transition-colors ${
                      selected ? "bg-accent text-bg" : "text-accent-200 hover:bg-panel-line/70"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {settings.nextSongMethod === "crowd" && (
              <>
                <div className="flex flex-wrap gap-2">
                  <NumberField label="Songs on the ballot" value={settings.ballotSize} min={3} max={8} onCommit={(v) => patch({ ballotSize: v })} />
                  <NumberField label="Vote closes (sec before end)" value={settings.ballotClosesSec} min={15} max={45} onCommit={(v) => patch({ ballotClosesSec: v })} />
                  <NumberField label="Wildcard after (lost rounds)" value={settings.wildcardAfter} min={2} max={5} onCommit={(v) => patch({ wildcardAfter: v })} />
                </div>
                <Toggle label="Show how long each song has waited" checked={settings.ballotShowsWait} onChange={(v) => patch({ ballotShowsWait: v })} />
              </>
            )}
            <p className="text-accent-300 text-[10px]">
              Rotation order: everyone takes turns. Crowd pick: while a song plays, guests vote on everyone's top song (no names shown) and the winner plays next. A song that keeps losing becomes a 🔥 Wildcard and plays anyway. Songs too short to vote on, and skips with no votes, go by rotation order. Not in DJ mode.
            </p>
          </SettingsGroup>
        )}

        <SettingsGroup title="Song rules">
          <Toggle label="Allow explicit songs" checked={settings.explicit} onChange={(v) => patch({ explicit: v })} />
          <Toggle label="Limit song length" checked={settings.maxSongMin !== null} onChange={(v) => patch({ maxSongMin: v ? 10 : null })} />
          {settings.maxSongMin !== null && (
            <NumberField label="Max song length (min)" value={settings.maxSongMin} min={1} onCommit={(v) => patch({ maxSongMin: v })} />
          )}
        </SettingsGroup>

        <SettingsGroup title="Voting">
          <NumberField label="Skip vote threshold (%)" value={settings.skipVotePercent} min={10} max={100} onCommit={(v) => patch({ skipVotePercent: v })} />
          <p className="text-accent-300 text-[10px]">Of active guests, at least 3 votes either way.</p>
        </SettingsGroup>

        <SettingsGroup title="Games">
          <Toggle label="Auto-contest" checked={settings.autoContest} onChange={(v) => patch({ autoContest: v })} />
          <div className="flex flex-wrap gap-2">
            {settings.autoContest && (
              <NumberField label="Contest every (songs)" value={settings.autoContestEverySongs} min={1} max={20} onCommit={(v) => patch({ autoContestEverySongs: v })} />
            )}
            <NumberField label="Contest length (sec)" value={settings.contestSeconds} min={10} max={120} onCommit={(v) => patch({ contestSeconds: v })} />
            <NumberField label="Ban cooldown (min)" value={settings.banCooldownMin} min={1} max={240} onCommit={(v) => patch({ banCooldownMin: v })} />
          </div>
          <p className="text-accent-300 text-[10px]">
            Auto-contests start when two guests have songs in the pool. Games never run back to back: there's always a song in between.
          </p>
        </SettingsGroup>

        <SettingsGroup title="TV">
          <Toggle label="Genre scenes" checked={settings.tvScenes} onChange={(v) => patch({ tvScenes: v })} />
          <p className="text-accent-300 text-[10px]">The TV background changes with the song's genre: warm for salsa, neon for EDM, and so on.</p>
        </SettingsGroup>

        {aiAvailable && (
          <SettingsGroup title="AI nicknames">
            <div className="flex gap-1 rounded-lg bg-panel p-1" role="radiogroup" aria-label="AI nicknames">
              {(
                [
                  ["off", "Off"],
                  ["approve", "Host approves"],
                  ["auto", "Automatic"],
                ] as const
              ).map(([value, label]) => {
                const selected = settings.aiNicknames === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => patch({ aiNicknames: value })}
                    className={`flex-1 whitespace-nowrap rounded-md px-2 py-1.5 text-center text-xs font-semibold transition-colors ${
                      selected ? "bg-accent text-bg" : "text-accent-200 hover:bg-panel-line/70"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <p className="text-accent-300 text-[10px]">
              Guests with 3+ songs get a playful nickname from the music they queued, made every 8 songs. Only anonymous music data is sent to the AI, never names.
            </p>
          </SettingsGroup>
        )}
      </div>
    </div>
  );
}
