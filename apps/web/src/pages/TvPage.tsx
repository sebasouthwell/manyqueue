import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { SOCKET_EVENTS, type VoteTallyPayload, type RoomEndedPayload } from "@manyqueue/shared";
import { DiceFive, SpeakerX, ArrowsClockwise } from "@phosphor-icons/react";
import { QrCode } from "../components/QrCode";
import { Emoji } from "../components/Emoji";
import { ReconnectingPill } from "../components/ReconnectingPill";
import { Crossfade } from "../components/Crossfade";
import { SkipRing } from "../components/SkipRing";
import { Takeover } from "../components/Takeover";
import { TvToastSlot } from "../components/TvToastSlot";
import { ReactionLayer } from "../components/ReactionLayer";
import { TvJamNotice } from "../components/TvJamNotice";
import { RecapSlides } from "../components/RecapSlides";
import { useIdle } from "../hooks/useIdle";
import { SceneBackground } from "../components/SceneBackground";
import type { BallotView, RecapData, SceneId } from "@manyqueue/shared";
import { formatSecs } from "../components/BallotCard";
import { DedicationLine } from "../components/DedicationLine";
import { DedicationSplash } from "../components/DedicationSplash";
import { GuessLine } from "../components/GuessLine";
import { reactionBus } from "../lib/reactionBus";
import { useMomentEngine } from "../hooks/useMomentEngine";
import { runMomentsDemo } from "../lib/momentsDemo";
import { seedDemoSong } from "../lib/demoQueue";
import { useStageScale, STAGE_WIDTH, STAGE_HEIGHT } from "../hooks/useStageScale";
import { useWakeLock } from "../hooks/useWakeLock";
import { useRoomConnection } from "../hooks/useRoomConnection";
import { useAnimatedProgress } from "../hooks/useAnimatedProgress";
import { useRoomStore } from "../store/roomStore";
import { formatDuration, ordinal } from "../lib/format";
import { getSocket } from "../socket";

interface RoomInfo {
  code: string;
  name: string;
  joinUrl: string;
  deviceId: string | null;
}

// Steps the title down (108 -> 88 -> 72px) rather than a full canvas-measured fit-text —
// a length-based heuristic good enough for a two-line clamp at this box width.
function titleFontSize(name: string): number {
  if (name.length <= 18) return 108;
  if (name.length <= 34) return 88;
  return 72;
}

export default function TvPage() {
  const scale = useStageScale();
  const engine = useMomentEngine();
  const snapshotName = useRoomStore((s) => s.snapshot?.name);
  const voteCounts = useRoomStore((s) => s.voteCounts);
  const voteMeta = useRoomStore((s) => s.voteMeta);
  const mostActive = useRoomStore((s) => s.snapshot?.mostActive ?? null);
  const [params] = useSearchParams();
  const demoMoments = params.get("demo") === "moments";
  const demoReactions = params.get("demo") === "reactions";
  const demoJam = params.get("demo") === "jam";
  const demoWinner = params.get("demo") === "winner";
  const demoRecap = params.get("demo") === "recap";
  // /tv?demo=scene&scene=neon — preview one genre scene behind a demo song.
  const demoSceneParam = params.get("scene");
  const demoScene = params.get("demo") === "scene" ? ((demoSceneParam as SceneId | null) ?? "neon") : null;
  const demoMode = demoMoments || demoReactions || demoJam || demoWinner || demoRecap || demoScene !== null;
  const requestWakeLock = useWakeLock();
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [started, setStarted] = useState(false);

  const queue = useRoomStore((s) => s.queue);
  const spotifyBlockedUntil = useRoomStore((s) => s.spotifyBlockedUntil);
  const storedScene = useRoomStore((s) => s.scene);
  const idle = useIdle(3000); // hide the cursor 3s after the mouse last moved
  const playback = useRoomStore((s) => s.playback);
  const clockOffsetMs = useRoomStore((s) => s.clockOffsetMs);
  const liveVoteTally = useRoomStore((s) => s.voteTally);
  const progressMs = useAnimatedProgress(playback, clockOffsetMs);
  const [seededTally, setSeededTally] = useState<VoteTallyPayload | null>(null);
  const [endedEvent, setEnded] = useState<RoomEndedPayload | null>(null);
  const roomEnded = useRoomStore((s) => s.roomEnded);
  const ended = endedEvent ?? (roomEnded ? ({ songCount: 0, playlistUrl: null } as RoomEndedPayload) : null);

  useEffect(() => {
    const socket = getSocket();
    function onRoomEnded(payload: RoomEndedPayload) {
      setEnded(payload);
    }
    socket.on(SOCKET_EVENTS.ROOM_ENDED, onRoomEnded);
    return () => {
      socket.off(SOCKET_EVENTS.ROOM_ENDED, onRoomEnded);
    };
  }, []);

  useEffect(() => {
    fetch("/rooms/current")
      .then(async (res) => {
        if (!res.ok) {
          setLoadError(true);
          return;
        }
        const data = await res.json();
        setRoom(data.room);
      })
      .catch(() => setLoadError(true));
  }, []);

  useRoomConnection(room?.code ?? null, "tv");

  // The demo shouldn't need a real host session or a real party.
  useEffect(() => {
    if (demoMode && loadError && !room) {
      setRoom({ code: "DEMO", name: "Demo party", joinUrl: "https://manyqueue.example/r/DEMO", deviceId: "demo" });
      setStarted(true);
    }
  }, [demoMode, loadError, room]);

  // /tv?demo=moments fires one of each moment (press "d" to fire it again).
  useEffect(() => {
    if (!demoMoments || !started) return;
    seedDemoSong();
    runMomentsDemo(engine);
    function onKey(e: KeyboardEvent) {
      if (e.key === "d") runMomentsDemo(engine);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoMoments, started]);

  // /tv?demo=reactions — a playing song and a stream of reactions (25/s for 12s), to watch the pool cap out and burst.
  useEffect(() => {
    if (!demoReactions || !started) return;
    seedDemoSong();
    const emojis = ["🔥", "🔥", "🔥", "💀", "💃", "😭"] as const;
    const stop = Date.now() + 12_000;
    const id = setInterval(() => {
      if (Date.now() > stop) return clearInterval(id);
      reactionBus.emit({ emoji: emojis[Math.floor(Math.random() * emojis.length)], guestId: "bot" });
    }, 40);
    return () => clearInterval(id);
  }, [demoReactions, started]);

  // /tv?demo=winner — the song contest's winner celebration (press "d" to play it again).
  useEffect(() => {
    if (!demoWinner || !started) return;
    seedDemoSong();
    let n = 0;
    const fire = () => {
      n += 1;
      const now = engine.serverNow();
      engine.pushMoment({
        id: `demo-winner-${n}`,
        kind: "contest",
        priority: 1,
        minMs: 7000,
        until: now + 7000,
        payload: {
          question: "Which plays next?",
          vs: true,
          winnerChoiceId: "a",
          resultText: "Levitating plays next",
          choices: [
            { id: "a", label: "Levitating", sublabel: "Dua Lipa", artUrl: null, byline: "Maya 🦋", percent: 68 },
            { id: "b", label: "Blinding Lights", sublabel: "The Weeknd", artUrl: null, byline: "Sam 🐸", percent: 32 },
          ],
        },
      });
    };
    fire();
    function onKey(e: KeyboardEvent) {
      if (e.key === "d") fire();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoWinner, started]);

  useEffect(() => {
    if (demoScene === null || !started) return;
    seedDemoSong();
  }, [demoScene, started]);

  // /tv?demo=jam — the "Spotify is limiting us, switch to Jam" notice, with reactions still flying.
  useEffect(() => {
    if (!demoJam || !started) return;
    seedDemoSong();
    useRoomStore.getState().setSpotifyBlockedUntil(Date.now() + 47 * 60_000);
    const id = setInterval(() => reactionBus.emit({ emoji: "🔥", guestId: "bot" }), 700);
    return () => clearInterval(id);
  }, [demoJam, started]);

  // A dedication is a priority-3 moment but shows as a line in the now-playing
  // card, so only the other kinds count as a takeover of the stage.
  const activeTakeover = engine.takeover && engine.takeover.kind !== "dedication" && engine.takeover.kind !== "guess" ? engine.takeover : null;
  const guessMoment = engine.takeover?.kind === "guess" ? engine.takeover : null;
  const dedicationMoment = engine.takeover?.kind === "dedication" ? engine.takeover : null;
  const dedicationPayload = dedicationMoment?.payload as { question?: string; splash?: boolean } | undefined;
  // The big splash plays once, the first time a song-change dedication becomes the current moment.
  const [splashDoneFor, setSplashDoneFor] = useState<string | null>(null);
  const splashing = !!dedicationMoment && !!dedicationPayload?.splash && splashDoneFor !== dedicationMoment.id;
  const dedicationText = dedicationMoment && !splashing ? (dedicationPayload?.question ?? null) : null;

  const mode = useRoomStore((s) => s.settings?.mode ?? "shared");
  const rotationRoom = useRoomStore((s) => s.rotationRoom);

  const nowPlaying = queue.find((item) => item.status === "playing") ?? null;
  const sharedUpNext = queue.filter((item) => item.status === "queued" || item.status === "locked").slice(0, 5);
  // Rotation mode: on deck is its own list (§5) — the currently-playing song is already shown above via
  // nowPlaying, so it's filtered back out here rather than teaching the server payload to exclude it.
  const rotationOnDeck = (rotationRoom?.onDeck ?? []).filter((item) => item.id !== nowPlaying?.id).slice(0, 5);
  // "Then it's": whose songs come next, in the live forecast's order (the same one "Coming up" shows),
  // each person once. Falls back to the rotation list when there's no forecast (DJ mode).
  const rotationStrip = (() => {
    const upcoming = rotationRoom?.upcoming ?? [];
    if (upcoming.length === 0) return (rotationRoom?.rotation ?? []).filter((r) => !r.empty).map((r) => ({ guestId: r.guestId, emoji: r.emoji }));
    const seen = new Set<string>();
    const strip: { guestId: string; emoji: string }[] = [];
    for (const slot of upcoming) {
      if (slot.kind !== "guest" || !slot.guestId || !slot.addedBy || seen.has(slot.guestId)) continue;
      seen.add(slot.guestId);
      strip.push({ guestId: slot.guestId, emoji: slot.addedBy.emoji });
    }
    return strip;
  })();
  const ballot = mode === "rotation" ? (rotationRoom?.ballot ?? null) : null;
  // Nothing waiting: the bottom row tells guests what to do, and the QR code grows.
  const emptyQueue = (mode === "rotation" ? rotationOnDeck : sharedUpNext).length === 0 && !ballot;
  const durationMs = nowPlaying?.durationMs ?? playback?.durationMs ?? 0;
  const progressPct = durationMs > 0 ? Math.min(100, (progressMs / durationMs) * 100) : 0;

  useEffect(() => {
    if (!room || !nowPlaying) return;
    fetch(`/rooms/${room.code}/votes/current`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data?.vote && setSeededTally(data.vote))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.code, nowPlaying?.id]);

  const activeTally =
    liveVoteTally && nowPlaying && liveVoteTally.targetQueueItemId === nowPlaying.id
      ? liveVoteTally
      : seededTally;

  return (
    <div className={`fixed inset-0 flex items-center justify-center bg-section overflow-hidden ${idle ? "cursor-none" : ""}`}>
      <ReconnectingPill />
      <div
        style={{
          width: STAGE_WIDTH,
          height: STAGE_HEIGHT,
          transform: `scale(${scale})`,
        }}
        className="relative flex-none bg-gradient-to-br from-bg to-section"
      >
        {started && !ended && <SceneBackground scene={demoScene ?? storedScene} />}
        {!room && !loadError && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-accent-200" style={{ fontSize: 32 }}>
              Loading room…
            </p>
          </div>
        )}

        {loadError && !demoMode && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-accent-200" style={{ fontSize: 32 }}>
              No active room. Open /host on this laptop and log in first.
            </p>
          </div>
        )}

        {room && (
          <>
            {!started && (
              <div className="absolute inset-0 flex items-center justify-center bg-bg/60">
                <button
                  onClick={() => {
                    requestWakeLock();
                    setStarted(true);
                  }}
                  className="rounded-lg bg-accent px-12 py-6 font-bold text-bg"
                  style={{ fontSize: 40 }}
                >
                  Start the party 🎉
                </button>
              </div>
            )}

            {started && (ended || demoRecap) && (
              <RecapSlides code={room.code} baseUrl={new URL(room.joinUrl).origin} demoData={demoRecap ? DEMO_RECAP : undefined} />
            )}

            {started && !ended && !demoRecap && (
              <>
                <ReactionLayer hidden={!!activeTakeover || splashing} trackKey={nowPlaying?.id ?? null} />
                <TvToastSlot toast={engine.toast} />

                {splashing && dedicationMoment && (
                  <DedicationSplash
                    key={dedicationMoment.id}
                    text={dedicationPayload?.question ?? ""}
                    trackName={nowPlaying?.trackName ?? null}
                    artistName={nowPlaying?.artistName ?? null}
                    onDone={() => setSplashDoneFor(dedicationMoment.id)}
                  />
                )}
                {activeTakeover && (
                  <Takeover
                    key={activeTakeover.id}
                    moment={activeTakeover}
                    serverNow={engine.serverNow}
                    counts={voteCounts[(activeTakeover.payload as { voteId?: string }).voteId ?? ""]}
                    meta={voteMeta[(activeTakeover.payload as { voteId?: string }).voteId ?? ""]}
                  />
                )}

                {/* Progress keeps running as a thin line under the header during a takeover. */}
                {activeTakeover && (
                  <div className="absolute bg-accent-800" style={{ top: 100, left: 96, right: 96, height: 6, zIndex: 45, borderRadius: 3 }}>
                    <div style={{ width: `${progressPct}%`, height: "100%", borderRadius: 3, background: "linear-gradient(90deg, rgb(var(--color-accent-600)), rgb(var(--color-accent-300)))", boxShadow: "0 0 12px rgb(var(--color-accent-400) / 0.6)" }} />
                  </div>
                )}

                {nowPlaying && (
                  <div className="absolute" style={{ top: 138, right: 96, transform: "scale(1.5)", transformOrigin: "top right" }}>
                    <SkipRing tally={activeTally} />
                  </div>
                )}

                {/* Header */}
                <div
                  className="absolute flex items-center gap-4"
                  style={{ top: 42, left: 96, right: 96, zIndex: 40 }}
                >
                  <img src="/logo-mark.png" alt="" style={{ height: 40 }} />
                  <img src="/logo-text.png" alt="ManyQueue" style={{ height: 30 }} />
                  <p className="text-accent-200" style={{ fontSize: 24 }}>
                    {snapshotName ?? room.name}
                  </p>
                </div>

                {/* Now playing */}
                {nowPlaying ? (
                  <Crossfade trackKey={nowPlaying.trackUri}>
                    <div className="absolute" style={{ top: 138, left: 96 }}>
                      {nowPlaying.albumArtUrl ? (
                        <img
                          src={nowPlaying.albumArtUrl}
                          alt=""
                          style={{ width: 630, height: 630, borderRadius: 14 }}
                          className="shadow-2xl"
                        />
                      ) : (
                        <div
                          style={{ width: 630, height: 630, borderRadius: 14 }}
                          className="bg-gradient-to-br from-accent-700 to-accent-900 shadow-2xl"
                        />
                      )}
                    </div>
                    <div
                      className="absolute flex flex-col"
                      style={{ top: 180, left: 810, width: 1014, gap: 14 }}
                    >
                      <p
                        className="font-medium leading-none text-accent-100"
                        style={{
                          fontSize: titleFontSize(nowPlaying.trackName),
                          letterSpacing: "-0.03em",
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {nowPlaying.trackName}
                      </p>
                      <p className="text-accent-200" style={{ fontSize: 28 }}>
                        {nowPlaying.artistName}
                      </p>
                      <DedicationLine text={dedicationText} />
                      {guessMoment && (
                        <GuessLine
                          deadlineAt={(guessMoment.payload as { deadlineAt?: number }).deadlineAt ?? null}
                          serverNow={engine.serverNow}
                        />
                      )}
                      {nowPlaying.playsTonight > 0 && (
                        <span
                          className="inline-flex w-fit items-center gap-2 rounded-full text-accent-300"
                          style={{
                            fontSize: 20,
                            padding: "4px 14px",
                            border: "1px solid rgb(var(--color-accent-300))",
                          }}
                        >
                          <ArrowsClockwise size={18} /> {ordinal(nowPlaying.playsTonight + 1)} play tonight
                        </span>
                      )}
                      {nowPlaying.mystery ? (
                        <p style={{ fontSize: 30 }} className="flex items-center gap-2 text-accent-300">
                          Added by <Emoji value="🕵️" size={32} /> Mystery pick
                        </p>
                      ) : nowPlaying.addedBy ? (
                        <p
                          style={{ fontSize: 30 }}
                          className="flex items-center gap-2 text-accent-300"
                        >
                          Added by <Emoji value={nowPlaying.addedBy.emoji} size={32} />{" "}
                          {nowPlaying.addedBy.nickname}
                        </p>
                      ) : nowPlaying.source === "fallback" ? (
                        <p
                          style={{ fontSize: 30 }}
                          className="flex items-center gap-2 text-accent-300"
                        >
                          <DiceFive size={32} /> House pick
                        </p>
                      ) : null}

                      <div className="flex flex-col gap-2" style={{ marginTop: 22 }}>
                        <div style={{ height: 8, borderRadius: 4 }} className="bg-accent-800">
                          <div
                            style={{
                              width: `${progressPct}%`,
                              height: "100%",
                              borderRadius: 4,
                              background: "linear-gradient(90deg, rgb(var(--color-accent-600)), rgb(var(--color-accent-300)))",
                              boxShadow: "0 0 18px rgb(var(--color-accent-400) / 0.6)",
                            }}
                          />
                        </div>
                        <div
                          className="flex justify-between text-accent-200 tabular-nums"
                          style={{ fontSize: 24 }}
                        >
                          <span>{formatDuration(progressMs)}</span>
                          <span>{formatDuration(durationMs)}</span>
                        </div>
                      </div>
                    </div>
                  </Crossfade>
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center">
                    {room.deviceId ? (
                      <p className="text-accent-200" style={{ fontSize: 40 }}>
                        Nothing is playing yet
                      </p>
                    ) : (
                      <p
                        className="flex items-center gap-3 text-accent-200"
                        style={{ fontSize: 32 }}
                      >
                        <SpeakerX size={36} /> Speaker not selected — pick one on /host
                      </p>
                    )}
                  </div>
                )}

                {/* Up next + QR (layer 7: always visible, never covered) */}
                <div
                  className="absolute left-0 right-0 bottom-0 flex items-center gap-6"
                  style={{
                    height: 258,
                    padding: "16px 40px 16px 96px",
                    background: "linear-gradient(180deg, transparent, rgb(var(--color-bg) / 0.8) 40%)",
                  }}
                >
                  {spotifyBlockedUntil && spotifyBlockedUntil > Date.now() ? <TvJamNotice /> : null}
                  {emptyQueue && !(spotifyBlockedUntil && spotifyBlockedUntil > Date.now()) && (
                    <p className="flex items-center gap-4 font-medium text-accent-100" style={{ fontSize: 46 }}>
                      Queue's empty. Add something! <Emoji value="🎶" size={52} />
                    </p>
                  )}
                  {!(spotifyBlockedUntil && spotifyBlockedUntil > Date.now()) && mode !== "rotation" && sharedUpNext.map((item) => (
                    <div key={item.id} className="flex min-w-0 items-center gap-3" style={{ width: 220 }}>
                      {item.albumArtUrl ? (
                        <img src={item.albumArtUrl} alt="" style={{ width: 56, height: 56, borderRadius: 8 }} />
                      ) : (
                        <div style={{ width: 56, height: 56, borderRadius: 8 }} className="bg-accent-800" />
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-accent-100" style={{ fontSize: 24 }}>
                          {item.trackName}
                        </p>
                        <p
                          className="flex items-center gap-1.5 truncate text-accent-200"
                          style={{ fontSize: 24 }}
                        >
                          {item.mystery ? (
                            <>
                              <Emoji value="🕵️" size={20} /> Mystery pick
                            </>
                          ) : item.addedBy ? (
                            <>
                              <Emoji value={item.addedBy.emoji} size={20} /> {item.addedBy.nickname}
                            </>
                          ) : item.source === "fallback" ? (
                            <>
                              <DiceFive size={20} /> House pick
                            </>
                          ) : (
                            item.artistName
                          )}
                        </p>
                      </div>
                    </div>
                  ))}
                  {!(spotifyBlockedUntil && spotifyBlockedUntil > Date.now()) && mode === "rotation" && rotationOnDeck.map((item) => (
                    <div key={item.id} className="flex min-w-0 items-center gap-3" style={{ width: 220 }}>
                      {item.albumArtUrl ? (
                        <img src={item.albumArtUrl} alt="" style={{ width: 56, height: 56, borderRadius: 8 }} />
                      ) : (
                        <div style={{ width: 56, height: 56, borderRadius: 8 }} className="bg-accent-800" />
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-accent-100" style={{ fontSize: 24 }}>
                          {item.trackName}
                        </p>
                        <p className="flex items-center gap-1.5 truncate text-accent-200" style={{ fontSize: 24 }}>
                          {item.isMystery ? (
                            <>
                              <Emoji value="🕵️" size={20} /> Mystery pick
                            </>
                          ) : item.addedBy ? (
                            <>
                              <Emoji value={item.addedBy.emoji} size={20} /> {item.addedBy.nickname}
                            </>
                          ) : (
                            <>
                              <DiceFive size={20} /> House pick
                            </>
                          )}
                        </p>
                      </div>
                    </div>
                  ))}
                  {ballot && !(spotifyBlockedUntil && spotifyBlockedUntil > Date.now()) && <TvBallot ballot={ballot} />}
                  {!ballot && mode === "rotation" && rotationStrip.length > 0 && !(spotifyBlockedUntil && spotifyBlockedUntil > Date.now()) && (
                    <div className="flex min-w-0 flex-col gap-2">
                      <p className="text-accent-300" style={{ fontSize: 18, letterSpacing: "0.12em", textTransform: "uppercase" }}>
                        Then it's
                      </p>
                      <div className="flex items-center gap-2">
                        {rotationStrip.slice(0, 6).map((r) => (
                          <div
                            key={r.guestId}
                            className="grid place-items-center rounded-full bg-accent-900"
                            style={{ width: 46, height: 46, boxShadow: "inset 0 0 0 1px rgb(var(--color-accent-700))" }}
                          >
                            <Emoji value={r.emoji} size={26} />
                          </div>
                        ))}
                        {rotationStrip.length > 6 && (
                          <span className="text-accent-200" style={{ fontSize: 22 }}>
                            +{rotationStrip.length - 6}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {mostActive && (
                    <p className="absolute flex items-center gap-2 text-accent-300" style={{ left: 96, bottom: 14, fontSize: 22 }}>
                      Most active tonight: <Emoji value={mostActive.emoji} size={22} /> {mostActive.nickname} with {mostActive.songs} songs
                    </p>
                  )}
                </div>

                {/* QR corner: its own top layer so no takeover can ever cover it */}
                  <div
                    className="absolute flex items-center gap-3 rounded-2xl bg-accent-900 p-3"
                    style={{ right: 40, bottom: 16, zIndex: 50, boxShadow: "0 0 0 1px rgb(var(--color-accent-700))" }}
                  >
                    <div className="rounded-md bg-accent-100 p-2">
                      <QrCode value={room.joinUrl} size={emptyQueue ? 220 : 120} />
                    </div>
                    <div className="flex flex-col gap-0.5 pr-2">
                      <span className="text-accent-200" style={{ fontSize: emptyQueue ? 36 : 30 }}>
                        Scan to join
                      </span>
                      <span
                        className="font-medium tracking-[0.1em] text-accent-100"
                        style={{ fontSize: emptyQueue ? 40 : 30 }}
                      >
                        {room.code}
                      </span>
                    </div>
                  </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Crowd pick on the TV (mockup 4g): the candidates, live vote bars and the countdown — never names. */
function TvBallot({ ballot }: { ballot: BallotView }) {
  const clockOffsetMs = useRoomStore((s) => s.clockOffsetMs);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = ballot.closesAt === null ? null : Math.max(0, Math.round((ballot.closesAt - (now + clockOffsetMs)) / 1000));
  const max = Math.max(1, ...ballot.entries.map((e) => e.votes));
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="text-accent-300" style={{ fontSize: 18, letterSpacing: "0.12em", textTransform: "uppercase" }}>
        Up next · you pick{secs !== null ? ` · ${secs > 0 ? formatSecs(secs) : "closing"}` : ""} · vote on your phone
      </p>
      <div className="flex items-end gap-4">
        {ballot.entries.slice(0, 6).map((e) => (
          <div key={e.itemId} className="flex min-w-0 flex-col gap-1.5" style={{ width: 170 }}>
            <div className="flex min-w-0 items-center gap-2">
              {e.albumArtUrl ? (
                <img src={e.albumArtUrl} alt="" style={{ width: 44, height: 44, borderRadius: 6 }} />
              ) : (
                <div style={{ width: 44, height: 44, borderRadius: 6 }} className="bg-accent-800" />
              )}
              <div className="min-w-0">
                <p className="truncate text-accent-100" style={{ fontSize: 20 }}>
                  {e.isWildcard ? "🔥 " : e.isMystery ? "🕵️ " : ""}
                  {e.trackName}
                </p>
                <p className="truncate text-accent-300" style={{ fontSize: 16 }}>
                  {e.artistName}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-accent-900">
                <div className="h-full rounded-full bg-accent-300 transition-[width] duration-500" style={{ width: `${(e.votes / max) * 100}%` }} />
              </div>
              <span className="tabular-nums text-accent-200" style={{ fontSize: 18 }}>
                {e.votes}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const DEMO_RECAP: RecapData = {
  room: { name: "Maya's Birthday", code: "DEMO", startedAt: Date.now() - 4 * 3_600_000, endedAt: Date.now(), durationMs: 4 * 3_600_000 + 12 * 60_000 },
  totals: { songs: 34, guests: 12, reactions: 468 },
  songOfTheNight: { title: "Tití Me Preguntó", artist: "Bad Bunny", albumArtUrl: null, by: { name: "Maya", emoji: "🦋" }, fire: 61, reactions: 88 },
  mostReplayed: { title: "Mr. Brightside", artist: "The Killers", albumArtUrl: null, by: { name: "Sam", emoji: "🐸" }, plays: 3 },
  banned: [{ title: "Baby Shark", artist: "Pinkfong" }, { title: "Friday", artist: "Rebecca Black" }],
  guests: [
    { name: "Maya", emoji: "🦋", songs: 8, reactionsGot: 140, labels: [{ emoji: "🎧", name: "Reggaeton Pro" }, { emoji: "🎯", name: "Hitmaker" }], nickname: { nickname: "The Reggaeton Menace 🐰", why: "Four reggaeton bangers in a row." } },
    { name: "Sam", emoji: "🐸", songs: 6, reactionsGot: 90, labels: [{ emoji: "🙌", name: "Crowd Pleaser" }], nickname: { nickname: "Pop Sunshine ☀️", why: "Pure pop, no skips." } },
    { name: "Jo", emoji: "🦊", songs: 5, reactionsGot: 40, labels: [{ emoji: "💀", name: "Certified Skip" }, { emoji: "🏆", name: "Contest Champ" }], nickname: null },
    { name: "Alex", emoji: "🐙", songs: 4, reactionsGot: 22, labels: [], nickname: null },
    { name: "Priya", emoji: "🐼", songs: 3, reactionsGot: 12, labels: [{ emoji: "🔮", name: "Mind Reader" }], nickname: null },
  ],
};
