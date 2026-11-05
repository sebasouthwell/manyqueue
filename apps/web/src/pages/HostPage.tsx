import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { MonitorPlay, ChatCircleText, DoorOpen } from "@phosphor-icons/react";
import { SOCKET_EVENTS, type RoomExportPayload } from "@manyqueue/shared";
import { DebugPanel } from "../components/DebugPanel";
import { SpeakerCard } from "../components/SpeakerCard";
import { FallbackPlaylistCard } from "../components/FallbackPlaylistCard";
import { HostNowPlayingCard } from "../components/HostNowPlayingCard";
import { HostQueueList } from "../components/HostQueueList";
import { HostChecklist } from "../components/HostChecklist";
import { PendingApprovalsCard } from "../components/PendingApprovalsCard";
import { AiNicknameCard } from "../components/AiNicknameCard";
import { HostSearchCard } from "../components/HostSearchCard";
import { PeopleCard } from "../components/PeopleCard";
import { SettingsCard } from "../components/SettingsCard";
import { ActionLogCard } from "../components/ActionLogCard";
import { HostDesk } from "../components/HostDesk";
import { PartyNameEditor } from "../components/PartyNameEditor";
import { GamesPanel } from "../components/GamesPanel";
import { StartScreen } from "../components/StartScreen";
import { ResyncBanner } from "../components/ResyncBanner";
import { SpotifyLimitBanner } from "../components/SpotifyLimitBanner";
import { useRoomConnection } from "../hooks/useRoomConnection";
import { useRoomStore } from "../store/roomStore";
import { getSocket } from "../socket";

type AuthState =
  | { status: "loading" }
  | { status: "logged_out" }
  | { status: "premium_required" }
  | { status: "logged_in"; displayName: string };

interface RoomInfo {
  code: string;
  name: string;
  joinUrl: string;
  fallbackPlaylistUri: string | null;
  deviceName: string | null;
}

interface EndedInfo {
  songCount: number;
  playlistUrl: string | null;
  exportPending: boolean;
  recapKey?: string;
}

export default function HostPage() {
  const [params] = useSearchParams();
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [ended, setEnded] = useState<EndedInfo | null>(null);
  const [ending, setEnding] = useState(false);
  // Result of linking the backup Spotify app (the login redirects back here with ?auth=backup_...).
  const [backupNote, setBackupNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const result = params.get("auth");
    const notes: Record<string, { ok: boolean; text: string }> = {
      backup_ok: { ok: true, text: "Backup Spotify app linked. ManyQueue will switch to it whenever the main app hits Spotify's limit." },
      backup_wrong_account: { ok: false, text: "That backup login was a different Spotify account than the one hosting. Log in with the same account (and add it to the backup app's users in the Spotify dashboard)." },
      backup_not_configured: { ok: false, text: "No backup Spotify app is set up on the server yet (BACKUP_CLIENT_ID / BACKUP_SECRET_ID)." },
    };
    if (result && notes[result]) {
      setBackupNote(notes[result]);
      const t = setTimeout(() => setBackupNote(null), 12_000);
      return () => clearTimeout(t);
    }
  }, [params]);

  useEffect(() => {
    if (params.get("auth") === "premium_required") {
      setAuth({ status: "premium_required" });
      return;
    }

    fetch("/auth/me")
      .then(async (res) => {
        if (!res.ok) {
          setAuth({ status: "logged_out" });
          return;
        }
        const data = await res.json();
        setAuth({ status: "logged_in", displayName: data.host.displayName });
      })
      .catch(() => setAuth({ status: "logged_out" }));
  }, [params]);

  useEffect(() => {
    if (auth.status !== "logged_in") return;
    fetch("/rooms", { method: "POST" })
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json();
        setRoom(data.room);
      })
      .catch(() => {});
  }, [auth.status]);

  useRoomConnection(room?.code ?? null, "host");
  const settings = useRoomStore((s) => s.settings);

  useEffect(() => {
    const socket = getSocket();
    function onExport(payload: RoomExportPayload) {
      setEnded((prev) => (prev ? { ...prev, playlistUrl: payload.playlistUrl, exportPending: false } : prev));
    }
    socket.on(SOCKET_EVENTS.ROOM_EXPORT, onExport);
    return () => {
      socket.off(SOCKET_EVENTS.ROOM_EXPORT, onExport);
    };
  }, []);

  async function endNight() {
    if (!room) return;
    if (!window.confirm("End the night? This exports a playlist and closes the room.")) return;
    setEnding(true);
    try {
      const res = await fetch(`/rooms/${room.code}/end`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setEnded({ songCount: data.songCount, playlistUrl: data.playlistUrl, exportPending: !!data.exportPending, recapKey: data.recapKey });
      }
    } finally {
      setEnding(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 lg:items-start lg:px-0">
      {backupNote && (
        <div
          className={`fixed left-1/2 top-4 z-50 w-[min(92vw,34rem)] -translate-x-1/2 rounded-xl px-4 py-3 text-sm text-accent-100 shadow-lg ${backupNote.ok ? "bg-accent-800" : "bg-danger/25"}`}
          role="status"
          onClick={() => setBackupNote(null)}
        >
          {backupNote.text}
        </div>
      )}
      {auth.status === "loading" && (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4">
          <img src="/logo-mark.png" alt="" className="h-14 w-auto animate-pulse" />
          <p className="text-accent-200">Loading…</p>
        </div>
      )}

      {auth.status === "logged_out" && <StartScreen />}

      {auth.status === "premium_required" && (
        <StartScreen
          notice={
            <div className="flex items-start gap-3 rounded-xl bg-danger/15 px-4 py-3 text-left shadow-[0_0_0_1px_rgb(var(--color-danger)/0.5)]" role="alert">
              <p className="text-sm text-accent-100">
                <span className="font-semibold text-danger">Premium needed to host.</span> ManyQueue plays through Spotify Connect, which needs a
                Premium account. Log in with a Premium account to continue.
              </p>
            </div>
          }
        />
      )}

      {auth.status === "logged_in" && ended && (
        <div className="flex flex-col items-center gap-3 text-center">
          <h1 className="text-3xl font-bold text-accent-100">Thanks for coming 💜</h1>
          <p className="text-accent-200">
            {ended.songCount} song{ended.songCount === 1 ? "" : "s"} played tonight.
          </p>
          {ended.exportPending && !ended.playlistUrl && <p className="text-accent-300 text-sm">Making your playlist on Spotify…</p>}
          {ended.recapKey && room && (
            <a href={`/rooms/${room.code}/recap?key=${ended.recapKey}`} target="_blank" rel="noreferrer" className="rounded-md bg-accent px-6 py-3 font-semibold text-bg">
              See the recap
            </a>
          )}
          {ended.playlistUrl && (
            <a
              href={ended.playlistUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-md bg-accent px-6 py-3 font-semibold text-bg"
            >
              Open the playlist on Spotify
            </a>
          )}
        </div>
      )}

      {auth.status === "logged_in" && !ended && !room && (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4">
          <img src="/logo-mark.png" alt="" className="h-14 w-auto animate-pulse" />
          <p className="text-accent-200">Setting up your room…</p>
        </div>
      )}

      {auth.status === "logged_in" && !ended && room && (
        <>
          {/* ≥1024px: the real nav/main/rail desk. Below that: the original
              single-column stacked layout — a phone-width desk squeeze isn't
              the goal, this is a genuinely different arrangement. */}
          <div className="hidden w-full lg:block">
            <HostDesk
              room={room}
              settings={settings}
              ending={ending}
              onEndNight={endNight}
              onOpenTv={() => window.open("/tv", "manyqueue-tv")}
              onDevicePicked={(deviceName) => setRoom((prev) => (prev ? { ...prev, deviceName } : prev))}
              onRenamed={(name) => setRoom((prev) => (prev ? { ...prev, name } : prev))}
            />
          </div>

          <div className="flex w-full max-w-5xl flex-col items-center gap-4 text-center lg:hidden">
            <h1 className="text-3xl font-bold text-accent-100">Hi, {auth.displayName}</h1>

            <div className="rounded-lg bg-section px-8 py-6">
              <p className="text-accent-300 text-sm uppercase tracking-wide">Room code</p>
              <p className="text-5xl font-extrabold tracking-[0.3em] text-accent-100">{room.code}</p>
              <div className="mt-2 flex justify-center">
                <PartyNameEditor
                  code={room.code}
                  initialName={room.name}
                  onRenamed={(name) => setRoom((prev) => (prev ? { ...prev, name } : prev))}
                />
              </div>
            </div>
            <button
              onClick={() => window.open("/tv", "manyqueue-tv")}
              className="flex items-center gap-2 rounded-md border border-accent px-6 py-3 font-semibold text-accent-100 hover:bg-accent-700/30"
            >
              <MonitorPlay size={18} weight="fill" /> Open TV window
            </button>
            <p className="text-accent-300 text-sm max-w-xs">
              Drag it to the TV, then press F11 to go fullscreen.
            </p>

            <HostChecklist code={room.code} deviceName={room.deviceName} />
            <SpotifyLimitBanner />
            <ResyncBanner code={room.code} />

            {/* Cards reflow into a responsive grid on wider viewports and
                stack single-column on a phone — same markup, flex-wrap does
                the work either way. */}
            <div className="flex w-full flex-wrap items-start justify-center gap-4">
              <PendingApprovalsCard code={room.code} />
              <AiNicknameCard code={room.code} />

              <SpeakerCard
                code={room.code}
                onDevicePicked={(deviceName) =>
                  setRoom((prev) => (prev ? { ...prev, deviceName } : prev))
                }
              />

              <GamesPanel code={room.code} canVeto />

              <HostNowPlayingCard code={room.code} />

              <HostSearchCard code={room.code} />

              <HostQueueList code={room.code} />

              <PeopleCard code={room.code} />

              <ActionLogCard code={room.code} limit={5} />

              <FallbackPlaylistCard code={room.code} initialSet={!!room.fallbackPlaylistUri} />

              <SettingsCard code={room.code} settings={settings} />
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                onClick={() =>
                  getSocket().emit(SOCKET_EVENTS.DEV_TOAST, {
                    message: `Test toast at ${new Date().toLocaleTimeString()}`,
                  })
                }
                className="flex items-center gap-1.5 rounded-md border border-accent px-4 py-2 text-sm text-accent-100"
              >
                <ChatCircleText size={16} /> Send test toast
              </button>

              <button
                onClick={endNight}
                disabled={ending}
                className="flex items-center gap-1.5 rounded-md border border-danger px-4 py-2 text-sm text-danger disabled:opacity-50"
              >
                <DoorOpen size={16} /> {ending ? "Ending night…" : "End night"}
              </button>
            </div>
          </div>
        </>
      )}

      <DebugPanel />
    </div>
  );
}
