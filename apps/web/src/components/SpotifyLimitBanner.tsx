import { useEffect, useState } from "react";
import { WarningCircle } from "@phosphor-icons/react";
import { useRoomStore } from "../store/roomStore";

function untilLabel(until: number): string {
  const at = new Date(until).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const mins = Math.max(1, Math.round((until - Date.now()) / 60_000));
  const span = mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`;
  return `${at} (about ${span})`;
}

/** Spotify rate-limits an app that asks too much, sometimes for hours. While that's
 * on, playback control and the speaker list can't work; this says so, and until when. */
export function SpotifyLimitBanner({ audience = "host" }: { audience?: "host" | "guest" }) {
  const until = useRoomStore((s) => s.spotifyBlockedUntil);
  const authFailed = useRoomStore((s) => s.spotifyAuthFailed);
  const backupNeedsLogin = useRoomStore((s) => s.spotifyBackupNeedsLogin);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [until]);

  if (authFailed) {
    if (audience === "guest") return <div className="w-full rounded-lg bg-danger/15 px-4 py-3 text-sm text-accent-100" role="alert">Song search is paused: the host needs to log in with Spotify again.</div>;
    return (
      <div className="flex w-full flex-wrap items-center gap-3 rounded-lg bg-danger/15 px-4 py-3 text-left shadow-[0_0_0_1px_rgb(var(--color-danger)/0.5)]" role="alert">
        <WarningCircle size={22} weight="fill" className="shrink-0 text-danger" />
        <p className="min-w-0 flex-1 text-sm text-accent-100">
          <span className="font-semibold">Spotify didn't accept the saved login.</span> This happens after the app's client ID or secret changes.
          Log in with Spotify again to reconnect playback, search and speakers.
        </p>
        <a href="/auth/login" className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-bg">
          Log in with Spotify
        </a>
      </div>
    );
  }

  const limited = !!until && until > Date.now();
  // A backup Spotify app is set up but not linked yet: one login through it and rate limits stop mattering.
  const backupLink = backupNeedsLogin && audience === "host" && (
    <a href="/auth/login?slot=backup" className="mt-2 inline-block rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-bg">
      Log in with the backup Spotify app
    </a>
  );
  if (!limited) {
    if (!backupLink) return null;
    return (
      <div className="w-full rounded-lg bg-accent-900 px-4 py-3 text-left shadow-[0_0_0_1px_rgb(var(--color-accent-700))]" role="status">
        <p className="text-sm text-accent-100">
          <span className="font-semibold">Backup Spotify app not linked yet.</span> Log in through it once, and ManyQueue switches to it
          by itself whenever the main app hits Spotify's limit.
        </p>
        {backupLink}
      </div>
    );
  }
  if (!until) return null;
  return (
    <div className="flex w-full items-start gap-3 rounded-lg bg-danger/15 px-4 py-3 text-left shadow-[0_0_0_1px_rgb(var(--color-danger)/0.5)]" role="alert">
      <WarningCircle size={22} weight="fill" className="mt-0.5 shrink-0 text-danger" />
      <p className="text-sm text-accent-100">
        {audience === "host" ? (
          <>
            <span className="font-semibold">Spotify is limiting ManyQueue's playback control until {untilLabel(until)}.</span> The queue can't
            advance and the speaker list is paused until then, so the TV is telling the room to switch to a Spotify Jam. Song search still works,
            nothing is lost, reactions keep flowing, and it resumes by itself.
            {backupLink}
          </>
        ) : (
          <>Spotify has paused the app's playback until about {new Date(until).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. Your songs are still queued, and reactions still work.</>
        )}
      </p>
    </div>
  );
}
