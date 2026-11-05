import { useEffect, useState } from "react";
import { SpeakerHigh, SpeakerX, CaretDown } from "@phosphor-icons/react";
import { useRoomStore } from "../store/roomStore";

interface SpotifyDeviceView {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  isRestricted: boolean;
}

export function SpeakerCard({
  code,
  onDevicePicked,
  collapsible = false,
  deviceName = null,
}: {
  code: string;
  onDevicePicked?: (deviceName: string) => void;
  /** The speaker the room already saved, so the card can collapse before (or without) a Spotify answer. */
  deviceName?: string | null;
  /** Rail usage: collapses to a one-line chip once a device is chosen and
   * connected; stays expanded by default until then (or on disconnect). */
  collapsible?: boolean;
}) {
  const [devices, setDevices] = useState<SpotifyDeviceView[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);
  const [activeDeviceName, setActiveDeviceName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [limited, setLimited] = useState(false);
  const [failed, setFailed] = useState(false);
  const [authProblem, setAuthProblem] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const speaker = useRoomStore((s) => s.speaker);

  async function refreshDevices() {
    setLoading(true);
    try {
      const res = await fetch(`/rooms/${code}/devices`);
      setLimited(res.status === 503);
      setAuthProblem(res.status === 401);
      setFailed(!res.ok && res.status !== 503 && res.status !== 401);
      if (res.ok) {
        const data = await res.json();
        setDevices(data.devices);
        setActiveDeviceId((prev) => data.activeDeviceId ?? prev);
      }
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshDevices();
    // Every 30s, and not at all while the tab is hidden: each poll is a Spotify call.
    const interval = setInterval(() => {
      if (!document.hidden) refreshDevices();
    }, 30_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  async function pickDevice(device: SpotifyDeviceView) {
    setActiveDeviceId(device.id);
    setActiveDeviceName(device.name);
    await fetch(`/rooms/${code}/device`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: device.id, deviceName: device.name }),
    });
    onDevicePicked?.(device.name);
  }

  const chosenDeviceName =
    activeDeviceName ?? devices.find((d) => d.id === activeDeviceId)?.name ?? deviceName ?? null;
  // Fine unless the speaker has been lost or moved: no news is good news (before the first poll, or while
  // Spotify is rate-limited, there is no status yet, and that shouldn't keep six speakers on screen all night).
  const isHealthy = !!chosenDeviceName && (!speaker || speaker.status === "connected");

  if (collapsible && isHealthy && !expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="flex w-full items-center justify-between rounded-lg bg-panel ring-1 ring-panel-line px-3 py-2 text-left"
      >
        <span className="flex min-w-0 items-center gap-1.5 text-sm text-accent-100">
          <SpeakerHigh size={15} weight="fill" className="shrink-0" />
          <span className="truncate">{chosenDeviceName}</span>
          <span className="shrink-0 text-accent-300">· connected</span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-accent-200">
          Change <CaretDown size={12} />
        </span>
      </button>
    );
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-3 rounded-lg bg-panel ring-1 ring-panel-line p-4">
      <button
        onClick={() => collapsible && isHealthy && setExpanded(false)}
        className="flex items-center justify-between text-left"
        disabled={!collapsible || !isHealthy}
      >
        <p className="text-accent-300 text-xs uppercase tracking-wide">Speaker</p>
        {collapsible && isHealthy && (
          <CaretDown size={13} className="rotate-180 text-accent-300" />
        )}
      </button>

      {chosenDeviceName && (!speaker || speaker.status === "connected") && (
        <p className="flex items-center gap-1.5 text-accent-100 text-sm">
          <SpeakerHigh size={16} weight="fill" /> {chosenDeviceName} · connected
        </p>
      )}
      {chosenDeviceName && speaker?.status === "disconnected" && (
        <div className="flex items-center justify-between rounded-md bg-danger/20 px-3 py-2">
          <p className="flex items-center gap-1.5 text-danger text-sm">
            <SpeakerX size={16} weight="fill" /> Speaker disconnected
          </p>
          <button
            onClick={() =>
              activeDeviceId && chosenDeviceName
                ? pickDevice({ id: activeDeviceId, name: chosenDeviceName, type: "", isActive: false, isRestricted: false })
                : undefined
            }
            className="rounded-md bg-accent px-3 py-1 text-xs font-semibold text-bg"
          >
            Reconnect
          </button>
        </div>
      )}
      {speaker?.status === "moved" && (
        <div className="flex items-center justify-between rounded-md bg-accent-700/40 px-3 py-2">
          <p className="text-accent-100 text-sm">Playback moved to {speaker.movedToDeviceName}</p>
          <button
            onClick={() =>
              activeDeviceId && chosenDeviceName
                ? pickDevice({ id: activeDeviceId, name: chosenDeviceName, type: "", isActive: false, isRestricted: false })
                : undefined
            }
            className="rounded-md bg-accent px-3 py-1 text-xs font-semibold text-bg"
          >
            Move back
          </button>
        </div>
      )}

      <div className="flex flex-col gap-1">
        {limited && (
          <p className="text-danger text-xs">
            Spotify is rate-limiting the app, so speakers can't be listed right now. The banner above says until when.
          </p>
        )}
        {authProblem && <p className="text-danger text-xs">Spotify needs you to log in again before speakers can be listed.</p>}
        {failed && !limited && <p className="text-danger text-xs">Couldn't reach Spotify to list speakers. It'll retry.</p>}
        {devices.length === 0 && !loading && !limited && !failed && !authProblem && (
          <p className="text-accent-300 text-xs">
            No speakers found. Open Spotify on your phone, tap the speaker icon and pick the Sonos
            once, then refresh.
          </p>
        )}
        {devices.map((d) => (
          <button
            key={d.id}
            disabled={d.isRestricted}
            onClick={() => pickDevice(d)}
            className="flex items-center justify-between rounded-md px-3 py-2 text-left text-sm disabled:opacity-40"
            style={{
              background:
                d.id === activeDeviceId
                  ? "rgb(var(--color-accent-700) / 0.5)"
                  : "rgb(var(--color-bg))",
              color: "rgb(var(--color-accent-100))",
            }}
          >
            <span className="inline-flex items-center gap-1.5">
              {d.isActive && <SpeakerHigh size={14} weight="fill" />}
              {d.name}{" "}
              <span className="text-accent-300 text-xs">
                ({d.type}
                {d.isRestricted ? " · can't be controlled remotely" : ""})
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
