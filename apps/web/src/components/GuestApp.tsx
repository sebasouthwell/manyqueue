import { useEffect, useState } from "react";
import { Play, MagnifyingGlass, Queue as QueueIcon, User, Users, Check, ArrowBendUpRight, Star, Key, Trophy, type Icon } from "@phosphor-icons/react";
import { ReconnectingPill } from "./ReconnectingPill";
import { TokenPill } from "./TokenPill";
import { GuestToasts } from "./GuestToasts";
import { NowTab } from "./tabs/NowTab";
import { SearchTab } from "./tabs/SearchTab";
import { QueueTab } from "./tabs/QueueTab";
import { MeTab } from "./tabs/MeTab";
import { ApproveTab } from "./tabs/ApproveTab";
import { HostRotationBoard } from "./HostRotationBoard";
import { PeopleCard } from "./PeopleCard";
import { GamesPanel } from "./GamesPanel";
import { useCan, useCanAny } from "../hooks/useCan";
import { useRoomStore } from "../store/roomStore";
import { SheetManagerProvider } from "./sheets/SheetManager";
import { castBallot } from "../lib/votes";

type TabId = "now" | "search" | "queue" | "me" | "approve" | "people" | "games";

const GUEST_TABS: { id: TabId; label: string; icon: Icon }[] = [
  { id: "now", label: "Now", icon: Play },
  { id: "search", label: "Search", icon: MagnifyingGlass },
  { id: "queue", label: "Queue", icon: QueueIcon },
  { id: "me", label: "Me", icon: User },
];

/** In Rotation mode there's no pending-approval workflow at all (drafting style replaces it — §18), so
 * "approve" permission means drafting power there instead: the tab becomes Draft, not a permanently
 * empty Approve list. Same permission, same "commit a song to play" idea, different mechanism. */
function approveTab(mode: "shared" | "rotation"): { id: TabId; label: string; icon: Icon } {
  return mode === "rotation"
    ? { id: "approve", label: "Draft", icon: ArrowBendUpRight }
    : { id: "approve", label: "Approve", icon: Check };
}

const GAMES_TAB: { id: TabId; label: string; icon: Icon } = {
  id: "games",
  label: "Games",
  icon: Trophy,
};

const PEOPLE_TAB: { id: TabId; label: string; icon: Icon } = {
  id: "people",
  label: "People",
  icon: Users,
};

interface GuestAppProps {
  code: string;
  guest: { id: string; nickname: string; emoji: string };
}

export function GuestApp({ code, guest }: GuestAppProps) {
  const [tab, setTab] = useState<TabId>("search");
  const myRole = useRoomStore((s) => s.myRole);
  const isCohost = myRole === "cohost";
  const myPerms = useRoomStore((s) => s.myPerms);
  const mode = useRoomStore((s) => s.settings?.mode ?? "shared");
  // Co-hosts hold every permission; anyone else gets only the tabs for what the host gave them.
  const canApprove = useCan("approve");
  const canPeople = useCanAny(["tokens", "moderation"]);

  const tabs = [
    GUEST_TABS[0],
    ...(canApprove ? [approveTab(mode)] : []),
    ...GUEST_TABS.slice(1, 3),
    ...(canPeople ? [PEOPLE_TAB] : []),
    ...(isCohost ? [GAMES_TAB] : []),
    GUEST_TABS[3],
  ];

  // If a permission is taken away while its tab is open, fall back to Now.
  const missing = (tab === "approve" && !canApprove) || (tab === "people" && !canPeople) || (tab === "games" && !isCohost);
  useEffect(() => {
    if (missing) setTab("now");
  }, [missing]);

  const roomEnded = useRoomStore((s) => s.roomEnded);
  if (roomEnded) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-8 text-center">
        <img src="/logo-mark.png" alt="" className="h-14 w-auto" />
        <h1 className="text-3xl font-bold text-accent-100">Thanks for coming 💜</h1>
        <p className="text-accent-200">The night is over. The queue is closed.</p>
        {roomEnded.recapKey && (
          <a href={`/rooms/${code}/recap?key=${roomEnded.recapKey}`} className="mt-2 rounded-md bg-accent px-6 py-3 font-semibold text-bg">
            See tonight's recap
          </a>
        )}
      </div>
    );
  }

  return (
    <SheetManagerProvider onPick={(voteId, optionId) => castBallot(code, voteId, optionId)}>
    <div className="flex min-h-screen flex-col pb-16 pt-14">
      <ReconnectingPill />
      <TokenPill />
      <div className="pointer-events-none fixed left-0 right-0 top-3 z-30 flex h-8 items-center justify-center">
        <img src="/logo-text.png" alt="ManyQueue" className="h-5 w-auto" />
      </div>
      <GuestToasts />

      {isCohost ? (
        <div className="fixed left-3 top-3 z-40 flex items-center gap-1 rounded-full bg-accent-700/60 px-3 py-1.5 text-xs font-semibold text-accent-100">
          <Star size={14} weight="fill" /> Co-host
        </div>
      ) : (
        myPerms.length > 0 && (
          <div className="fixed left-3 top-3 z-40 flex items-center gap-1 rounded-full bg-accent-700/60 px-3 py-1.5 text-xs font-semibold text-accent-100">
            <Key size={14} weight="fill" /> Xtra Perms
          </div>
        )
      )}

      {tab === "now" && <NowTab code={code} guestId={guest.id} />}
      {tab === "search" && <SearchTab code={code} />}
      {tab === "queue" && <QueueTab code={code} guestId={guest.id} />}
      {tab === "me" && <MeTab code={code} nickname={guest.nickname} emoji={guest.emoji} />}
      {tab === "approve" && canApprove && mode === "rotation" && (
        <div className="px-4 py-4">
          <HostRotationBoard code={code} />
        </div>
      )}
      {tab === "approve" && canApprove && mode === "shared" && <ApproveTab code={code} />}
      {tab === "games" && isCohost && (
        <div className="flex justify-center px-4 py-4">
          <GamesPanel code={code} canVeto={false} />
        </div>
      )}
      {tab === "people" && canPeople && (
        <div className="flex justify-center px-4 py-4">
          <PeopleCard code={code} asHost={false} selfId={guest.id} />
        </div>
      )}

      <nav className="fixed bottom-0 left-0 right-0 flex border-t border-accent-800 bg-bg">
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium"
              style={{
                color: active ? "rgb(var(--color-accent-100))" : "rgb(var(--color-accent-300))",
              }}
            >
              <t.icon size={22} weight={active ? "fill" : "regular"} />
              {t.label}
            </button>
          );
        })}
      </nav>
    </div>
    </SheetManagerProvider>
  );
}
