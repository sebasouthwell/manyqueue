import { useEffect, useState } from "react";
import { Coin, PencilSimple, Sparkle } from "@phosphor-icons/react";
import { GUEST_EMOJI, type LabelView, type TokenActivityItem } from "@manyqueue/shared";
import { Emoji, EmojiText } from "../Emoji";
import { Sheet } from "../Sheet";
import { ReactionPicker } from "../ReactionPicker";
import { AnnouncementComposer } from "../AnnouncementComposer";
import { useRoomStore } from "../../store/roomStore";

interface MeTabProps {
  code: string;
  nickname: string;
  emoji: string;
}

const TOKEN_DOTS = 5;

export function MeTab({ code, nickname: initialNickname, emoji: initialEmoji }: MeTabProps) {
  const [nickname, setNickname] = useState(initialNickname);
  const [emoji, setEmoji] = useState(initialEmoji);
  const identityOverride = useRoomStore((s) => s.identityOverride);
  useEffect(() => {
    if (!identityOverride) return;
    setNickname(identityOverride.nickname);
    setEmoji(identityOverride.emoji);
  }, [identityOverride]);
  const settings = useRoomStore((s) => s.settings);
  const myAiNickname = useRoomStore((s) => s.myAiNickname);
  const setMyAiNickname = useRoomStore((s) => s.setMyAiNickname);
  const tokenBalance = useRoomStore((s) => s.tokenBalance);
  const songsUntilNextToken = useRoomStore((s) => s.snapshot?.songsUntilNextToken);

  const [activity, setActivity] = useState<TokenActivityItem[]>([]);
  const [songsAdded, setSongsAdded] = useState(0);
  const [earnedLabels, setEarnedLabels] = useState<{ key: string; emoji: string; name: string }[]>([]);
  const [labelProgress, setLabelProgress] = useState<LabelView[]>([]);
  const [reactionsGot, setReactionsGot] = useState<{ total: number; topEmoji: string | null }>({ total: 0, topEmoji: null });
  const playingId = useRoomStore((s) => s.queue.find((i) => i.status === "playing")?.id ?? null);

  const [editing, setEditing] = useState(false);
  const [draftNickname, setDraftNickname] = useState(nickname);
  const [draftEmoji, setDraftEmoji] = useState(emoji);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/rooms/${code}/me/tokens`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        setActivity(data.activity);
        setSongsAdded(data.songsAdded);
        if (data.reactionsGot) setReactionsGot(data.reactionsGot);
        setMyAiNickname(data.aiNickname ?? null);
      })
      .catch(() => {});
    // Labels are worked out as songs finish; look again whenever the playing song changes.
    fetch(`/rooms/${code}/me/labels`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        setEarnedLabels(data.earned);
        setLabelProgress(data.progress);
      })
      .catch(() => {});
    // Re-fetch when the balance or the playing song changes so the list and the reaction count stay current.
  }, [code, tokenBalance, playingId]);

  const tokenMode = settings?.tokenMode ?? false;
  const filledDots = tokenBalance !== null ? Math.min(TOKEN_DOTS, tokenBalance) : 0;
  const showPassiveIncome =
    tokenMode && settings && typeof songsUntilNextToken === "number" && settings.earnEverySongs > 0;
  const progressPct = showPassiveIncome
    ? Math.round(((settings!.earnEverySongs - songsUntilNextToken!) / settings!.earnEverySongs) * 100)
    : 0;

  function openEdit() {
    setDraftNickname(nickname);
    setDraftEmoji(emoji);
    setSaveError(null);
    setEditing(true);
  }

  async function saveIdentity() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/rooms/${code}/me`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname: draftNickname.trim(), emoji: draftEmoji }),
      });
      if (res.status === 429) {
        const body = await res.json();
        const minutes = Math.max(1, Math.ceil((body.retryAfterMs ?? 0) / 60000));
        setSaveError(`You can change this again in ${minutes} min.`);
        return;
      }
      if (!res.ok) {
        setSaveError("Couldn't save — try again.");
        return;
      }
      const data = await res.json();
      setNickname(data.guest.nickname);
      setEmoji(data.guest.emoji);
      setEditing(false);
    } catch {
      setSaveError("Couldn't save — check your connection.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-5 px-6 py-6">
      <button onClick={openEdit} className="flex flex-col items-center gap-2">
        <Emoji value={emoji} size={72} />
        <span className="flex items-center gap-1.5 text-xl font-semibold text-accent-100">
          {nickname} <PencilSimple size={14} className="text-accent-300" />
        </span>
        <span className="text-accent-300 text-xs">Guest</span>
      </button>
      {myAiNickname && (
        <div className="flex max-w-xs flex-col items-center gap-1 text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-700/40 px-3 py-1 text-sm font-semibold text-accent-100 shadow-[0_0_0_1px_rgb(var(--color-accent-500))]">
            <Sparkle size={12} weight="fill" className="text-accent-300" aria-label="Made by AI" /> <EmojiText text={myAiNickname.nickname} size={16} />
          </span>
          <span className="text-neutral-400 text-xs">{myAiNickname.why}</span>
        </div>
      )}

      {tokenMode && (
        <div className="flex w-full max-w-xs flex-col items-center gap-3 rounded-lg bg-section p-4">
          <p className="text-4xl font-bold tabular-nums text-accent-100">{tokenBalance ?? 0}</p>
          <div className="flex gap-1.5">
            {Array.from({ length: TOKEN_DOTS }).map((_, i) => (
              <Coin
                key={i}
                size={16}
                weight={i < filledDots ? "fill" : "regular"}
                className={i < filledDots ? "text-accent-300" : "text-accent-800"}
              />
            ))}
          </div>
          {showPassiveIncome && (
            <div className="flex w-full flex-col gap-1">
              <p className="text-center text-accent-300 text-xs">
                +1 for everyone in {songsUntilNextToken} song{songsUntilNextToken === 1 ? "" : "s"}
              </p>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-accent-900">
                <div
                  className="h-full rounded-full bg-accent transition-all"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      <ReactionPicker />
      <AnnouncementComposer code={code} />

      <div className="flex w-full max-w-xs justify-around rounded-lg bg-section p-3 text-center">
        <div>
          <p className="text-lg font-semibold tabular-nums text-accent-100">{songsAdded}</p>
          <p className="text-accent-300 text-[10px]">Songs added</p>
        </div>
        <div>
          <p className="flex items-center justify-center gap-1 text-lg font-semibold tabular-nums text-accent-100">
            {reactionsGot.topEmoji && <Emoji value={reactionsGot.topEmoji} size={18} />} {reactionsGot.total}
          </p>
          <p className="text-accent-300 text-[10px]">Reactions got</p>
        </div>
        <div>
          <p className="text-lg font-semibold tabular-nums text-accent-100">{activity.filter((a) => a.reason === "refund_contest").length}</p>
          <p className="text-accent-300 text-[10px]">Contests won</p>
        </div>
      </div>

      <div className="w-full max-w-xs">
        <p className="text-accent-300 text-xs uppercase tracking-wide">Labels</p>
        {earnedLabels.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {earnedLabels.map((l) => (
              <span
                key={l.key}
                className="inline-flex items-center gap-1.5 rounded-full bg-accent-700/40 px-3 py-1 text-sm font-semibold text-accent-100 shadow-[0_0_0_1px_rgb(var(--color-accent-500))]"
              >
                <Emoji value={l.emoji} size={16} /> {l.name}
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-1 text-accent-300 text-xs">None yet. Add songs and get the room reacting to earn them.</p>
        )}
        {labelProgress.length > 0 && (
          <div className="mt-3 flex flex-col gap-2">
            <p className="text-accent-300 text-[10px] uppercase tracking-wide">Next up</p>
            {labelProgress.map((l) => (
              <div key={l.key} className="rounded-lg bg-section p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-sm text-accent-100">
                    <Emoji value={l.emoji} size={16} /> {l.name}
                  </span>
                  <span className="text-xs tabular-nums text-accent-300">
                    {l.value}/{l.target}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-accent-900">
                  <div className="h-full rounded-full bg-accent-300" style={{ width: `${(l.value / l.target) * 100}%` }} />
                </div>
                <p className="mt-1 text-[11px] text-accent-300">{l.how}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {tokenMode && (
        <div className="flex w-full max-w-xs flex-col gap-1.5">
          <p className="text-accent-300 text-xs uppercase tracking-wide">Token activity</p>
          {activity.length === 0 && <p className="text-accent-300 text-xs">Nothing yet.</p>}
          {activity.map((a) => (
            <div key={a.id} className="flex items-center justify-between text-sm">
              <span className="text-accent-200">{a.label}</span>
              <span
                className={`tabular-nums font-medium ${a.delta >= 0 ? "text-accent-300" : "text-accent-200"}`}
              >
                {a.delta >= 0 ? "+" : ""}
                {a.delta}
              </span>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <Sheet onClose={() => setEditing(false)}>
          <p className="mb-4 text-lg font-semibold text-accent-100">Change nickname / emoji</p>
          <input
            value={draftNickname}
            onChange={(e) => setDraftNickname(e.target.value.slice(0, 20))}
            maxLength={20}
            className="mb-3 w-full rounded-md bg-bg px-4 py-3 text-accent-100 outline-none"
          />
          <div className="mb-4 grid grid-cols-6 gap-1.5">
            {GUEST_EMOJI.map((e) => (
              <button
                key={e}
                onClick={() => setDraftEmoji(e)}
                className="grid h-11 place-items-center rounded-md"
                style={{
                  background: e === draftEmoji ? "rgb(var(--color-accent) / 0.16)" : "rgb(var(--color-bg))",
                  boxShadow: e === draftEmoji ? "0 0 0 2px rgb(var(--color-accent))" : "none",
                }}
              >
                <Emoji value={e} size={22} />
              </button>
            ))}
          </div>
          {saveError && <p className="mb-2 text-center text-danger text-xs">{saveError}</p>}
          <button
            onClick={saveIdentity}
            disabled={saving || !draftNickname.trim()}
            className="w-full rounded-md bg-accent px-4 py-3 font-semibold text-bg disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </Sheet>
      )}
    </div>
  );
}
