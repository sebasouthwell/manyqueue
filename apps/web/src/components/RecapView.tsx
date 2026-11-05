import { formatNightLength, type RecapData, type RecapSong } from "@manyqueue/shared";
import { Emoji, EmojiText } from "./Emoji";

function SongCard({ label, song, extra }: { label: string; song: RecapSong; extra: string }) {
  return (
    <div className="flex items-center gap-4 rounded-2xl bg-section p-4 shadow-[0_0_0_1px_rgb(var(--color-accent-700))]">
      {song.albumArtUrl ? (
        <img src={song.albumArtUrl} alt="" className="h-20 w-20 shrink-0 rounded-xl" />
      ) : (
        <div className="h-20 w-20 shrink-0 rounded-xl bg-gradient-to-br from-accent-700 to-accent-900" />
      )}
      <div className="min-w-0 flex-1 text-left">
        <p className="text-[11px] uppercase tracking-[0.2em] text-accent-300">{label}</p>
        <p className="truncate text-lg font-semibold text-accent-100">{song.title}</p>
        <p className="truncate text-sm text-accent-200">{song.artist}</p>
        <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-accent-300">
          {song.by ? (
            <>
              <Emoji value={song.by.emoji} size={13} /> {song.by.name} ·{" "}
            </>
          ) : null}
          {extra}
        </p>
      </div>
    </div>
  );
}

/** The recap, as one page (screen 2f): how the night went, its songs, and the crew with their labels and nicknames.
 * Used for the public link and for the host's live preview. */
export function RecapView({ recap }: { recap: RecapData }) {
  const date = new Date(recap.room.startedAt).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
  const stats: [string, string][] = [
    [formatNightLength(recap.room.durationMs), "The night ran"],
    [String(recap.totals.songs), recap.totals.songs === 1 ? "Song played" : "Songs played"],
    [String(recap.totals.guests), recap.totals.guests === 1 ? "Guest" : "Guests"],
    [String(recap.totals.reactions), "Reactions"],
  ];
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 pb-16">
      <div className="flex flex-col items-center gap-3 rounded-3xl bg-gradient-to-br from-section to-bg px-6 py-10 text-center shadow-[0_0_0_1px_rgb(var(--color-accent-700))]">
        <img src="/logo-text.png" alt="ManyQueue" className="h-7 w-auto" />
        <p className="mt-2 text-3xl font-bold text-accent-100">{recap.room.name}</p>
        <p className="text-sm text-accent-300">{date}</p>
        <p className="mt-2 text-accent-200">
          Thanks for coming <Emoji value="💜" size={18} />
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {stats.map(([value, label]) => (
          <div key={label} className="rounded-2xl bg-section p-4 text-center">
            <p className={`font-bold tabular-nums text-accent-100 ${value.length > 6 ? "text-lg leading-8" : "text-2xl"}`}>{value}</p>
            <p className="text-xs text-accent-300">{label}</p>
          </div>
        ))}
      </div>

      {(recap.songOfTheNight || recap.mostReplayed || recap.banned.length > 0) && (
        <div className="flex flex-col gap-3">
          <p className="text-xs uppercase tracking-[0.2em] text-accent-300">Songs of the night</p>
          {recap.songOfTheNight && <SongCard label="Most 🔥" song={recap.songOfTheNight} extra={`${recap.songOfTheNight.fire} 🔥 · ${recap.songOfTheNight.reactions} reactions`} />}
          {recap.mostReplayed && <SongCard label="Most replayed" song={recap.mostReplayed} extra={`played ${recap.mostReplayed.plays} times`} />}
          {recap.banned.length > 0 && (
            <div className="rounded-2xl bg-section p-4 text-left">
              <p className="text-[11px] uppercase tracking-[0.2em] text-accent-300">Banned by the room</p>
              {recap.banned.map((b, i) => (
                <p key={i} className="mt-1 truncate text-sm text-accent-100">
                  {b.title}
                  {b.artist ? <span className="text-accent-300"> · {b.artist}</span> : null}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {recap.guests.length > 0 && (
        <div className="flex flex-col gap-3">
          <p className="text-xs uppercase tracking-[0.2em] text-accent-300">The crew</p>
          {recap.guests.map((g, i) => (
            <div key={i} className="flex gap-3 rounded-2xl bg-section p-4 text-left">
              <Emoji value={g.emoji} size={40} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-semibold text-accent-100">{g.name}</p>
                {g.nickname && (
                  <p className="text-sm text-accent-200">
                    ✨ <EmojiText text={g.nickname.nickname} size={15} />
                    <span className="block text-xs text-neutral-400">{g.nickname.why}</span>
                  </p>
                )}
                {g.labels.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {g.labels.map((l) => (
                      <span key={l.name} className="inline-flex items-center gap-1 rounded-full bg-accent-700/40 px-2.5 py-0.5 text-xs font-semibold text-accent-100">
                        <Emoji value={l.emoji} size={13} /> {l.name}
                      </span>
                    ))}
                  </div>
                )}
                <p className="mt-2 text-xs text-accent-300">
                  {g.songs} song{g.songs === 1 ? "" : "s"} · {g.reactionsGot} reaction{g.reactionsGot === 1 ? "" : "s"} got
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
