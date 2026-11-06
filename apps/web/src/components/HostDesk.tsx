import { useState } from "react";
import { ChartBar, Queue as QueueIcon, Users, Gear, DoorOpen, MonitorPlay, Trophy, type Icon } from "@phosphor-icons/react";
import type { RoomSettings } from "@manyqueue/shared";
import { SpeakerCard } from "./SpeakerCard";
import { HostNowPlayingBanner } from "./HostNowPlayingBanner";
import { useRoomStore } from "../store/roomStore";
import { PendingApprovalsCard } from "./PendingApprovalsCard";
import { AiNicknameCard } from "./AiNicknameCard";
import { RecapPreview } from "./RecapPreview";
import { HostSearchCard } from "./HostSearchCard";
import { HostChecklist } from "./HostChecklist";
import { HostQueueList } from "./HostQueueList";
import { PeopleCard } from "./PeopleCard";
import { PartyNameEditor } from "./PartyNameEditor";
import { HistoryList } from "./HistoryList";
import { SettingsCard } from "./SettingsCard";
import { FallbackPlaylistCard } from "./FallbackPlaylistCard";
import { ActionLogCard } from "./ActionLogCard";
import { ResyncBanner } from "./ResyncBanner";
import { SpotifyLimitBanner } from "./SpotifyLimitBanner";
import { GamesSection } from "./GamesSection";
import { LiveGameCard } from "./LiveGameCard";
import { ContestPanel } from "./ContestPanel";
import { useGames } from "../hooks/useGames";
import { HolidayDecor } from "./Holiday";

type Section = "queue" | "games" | "people" | "recap" | "settings";

const NAV: { id: Section; label: string; icon: Icon }[] = [
  { id: "queue", label: "Queue", icon: QueueIcon },
  { id: "games", label: "Games", icon: Trophy },
  { id: "people", label: "People", icon: Users },
  { id: "recap", label: "Recap", icon: ChartBar },
  { id: "settings", label: "Settings", icon: Gear },
];

interface HostDeskRoom {
  code: string;
  name: string;
  deviceName: string | null;
  fallbackPlaylistUri: string | null;
}

interface HostDeskProps {
  room: HostDeskRoom;
  settings: RoomSettings | null;
  ending: boolean;
  onEndNight: () => void;
  onOpenTv: () => void;
  onDevicePicked: (name: string) => void;
  onRenamed?: (name: string) => void;
}

/**
 * The real host-desk panel system (UI-GUIDE §4.1) — nav / main / rail — for
 * wide viewports. Below the lg breakpoint, HostPage falls back to the
 * original single-column stacked layout instead of squeezing this into a
 * phone width; same underlying cards either way, just arranged differently.
 */
export function HostDesk({ room, settings, ending, onEndNight, onOpenTv, onDevicePicked, onRenamed }: HostDeskProps) {
  const [section, setSection] = useState<Section>("queue");
  const games = useGames(room.code);
  const [pickingTwo, setPickingTwo] = useState(false);
  const pendingCount = useRoomStore((s) => s.queue.filter((i) => i.status === "pending").length);

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 p-5">
    <HolidayDecor variant="phone" />
    <SpotifyLimitBanner />
    <HostNowPlayingBanner code={room.code} />
    <div className="grid grid-cols-[216px_1fr_312px] gap-5">
      <div className="flex flex-col gap-4">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <img src="/logo-mark.png" alt="" className="h-6 w-auto" />
            <img src="/logo-text.png" alt="ManyQueue" className="h-4 w-auto" />
          </div>
          <p className="text-2xl font-extrabold tracking-[0.2em] text-accent-100">{room.code}</p>
          <div className="mt-1">
            <PartyNameEditor code={room.code} initialName={room.name} onRenamed={onRenamed} />
          </div>
        </div>

        <button
          onClick={onOpenTv}
          className="flex items-center justify-center gap-2 rounded-md border border-accent px-3 py-2 text-sm font-semibold text-accent-100 hover:bg-accent-700/30"
        >
          <MonitorPlay size={16} weight="fill" /> Open TV
        </button>

        <nav className="flex flex-col gap-1">
          {NAV.map((n) => {
            const active = section === n.id;
            return (
              <button
                key={n.id}
                onClick={() => setSection(n.id)}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-accent-100"
                style={{
                  background: active ? "rgb(var(--color-accent-700) / 0.5)" : "transparent",
                }}
              >
                <n.icon size={18} weight={active ? "fill" : "regular"} /> {n.label}
                {n.id === "games" && games.state?.live && (
                  <span className="ml-auto h-2.5 w-2.5 rounded-full bg-accent" aria-label="A game is live" />
                )}
                {n.id === "queue" && pendingCount > 0 && (
                  <span
                    className="ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1.5 text-[11px] font-bold text-bg"
                    aria-label={`${pendingCount} waiting for approval`}
                  >
                    {pendingCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <button
          onClick={onEndNight}
          disabled={ending}
          className="mt-auto flex items-center justify-center gap-2 rounded-md border border-danger px-3 py-2 text-sm text-danger disabled:opacity-50"
        >
          <DoorOpen size={16} /> {ending ? "Ending night…" : "End night"}
        </button>
      </div>

      <div className="flex min-w-0 flex-col items-start gap-4">
        <HostChecklist code={room.code} deviceName={room.deviceName} />
        <ResyncBanner code={room.code} />

        {section === "queue" && (
          <div className="flex w-full flex-col gap-4">
            <HostSearchCard code={room.code} wide />
            <div className="grid w-full grid-cols-2 items-start gap-4">
              <HostQueueList code={room.code} wide />
              <div className="flex min-w-0 flex-col gap-4">
                <PendingApprovalsCard code={room.code} showEmpty />
                <AiNicknameCard code={room.code} />
              </div>
            </div>
            <div className="flex w-full flex-col gap-2 rounded-lg bg-panel ring-1 ring-panel-line p-4">
              <p className="text-xs uppercase tracking-wide text-accent-300">Played tonight</p>
              <HistoryList code={room.code} limit={3} />
            </div>
          </div>
        )}
        {section === "games" && (
          <GamesSection
            code={room.code}
            state={games.state}
            history={games.history}
            settings={settings}
            canVeto
            onPickTwo={() => setPickingTwo(true)}
            onChanged={games.refresh}
          />
        )}
        {section === "people" && <PeopleCard code={room.code} wide />}
        {section === "recap" && <RecapPreview code={room.code} />}
        {section === "settings" && (
          <div className="flex w-full flex-col items-start gap-4">
            <SettingsCard code={room.code} settings={settings} />
            <FallbackPlaylistCard code={room.code} initialSet={!!room.fallbackPlaylistUri} />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <SpeakerCard code={room.code} onDevicePicked={onDevicePicked} collapsible deviceName={room.deviceName} />
        <LiveGameCard code={room.code} state={games.state} canVeto onPickTwo={() => setPickingTwo(true)} />
        <ActionLogCard code={room.code} limit={5} />
      </div>
    </div>
    {pickingTwo && games.state && <ContestPanel code={room.code} pool={games.state.contest} onClose={() => setPickingTwo(false)} />}
    </div>
  );
}
