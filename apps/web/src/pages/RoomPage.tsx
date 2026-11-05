import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { GUEST_EMOJI, type GuestRole, type Permission } from "@manyqueue/shared";
import { GuestApp } from "../components/GuestApp";
import { Emoji } from "../components/Emoji";
import { useRoomConnection } from "../hooks/useRoomConnection";
import { useRoomStore } from "../store/roomStore";

interface RoomInfo {
  code: string;
  name: string;
}

interface GuestInfo {
  id: string;
  nickname: string;
  emoji: string;
  role: GuestRole;
  perms?: Permission[];
  tokenBalance: number;
  muted: boolean;
  canAnnounce: boolean;
}

type Stage =
  | { kind: "checking" }
  | { kind: "not_found" }
  | { kind: "removed" }
  | { kind: "form"; room: RoomInfo }
  | { kind: "joined"; room: RoomInfo; guest: GuestInfo };

const GUEST_ID_KEY = "manyqueue_guest_id";

export default function RoomPage() {
  const { code } = useParams();
  const [stage, setStage] = useState<Stage>({ kind: "checking" });
  const [nickname, setNickname] = useState("");
  const [emoji, setEmoji] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  useEffect(() => {
    if (!code) return;
    let cancelled = false;

    async function load() {
      const roomRes = await fetch(`/rooms/${code}`);
      if (!roomRes.ok) {
        if (!cancelled) setStage({ kind: "not_found" });
        return;
      }
      const { room } = await roomRes.json();

      const meRes = await fetch(`/rooms/${code}/me`);
      if (meRes.status === 403) {
        if (!cancelled) setStage({ kind: "removed" });
        return;
      }
      if (meRes.ok) {
        const { guest } = await meRes.json();
        localStorage.setItem(GUEST_ID_KEY, guest.id);
        if (!cancelled) setStage({ kind: "joined", room, guest });
      } else if (!cancelled) {
        setStage({ kind: "form", room });
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [code]);

  const joinedGuestId = stage.kind === "joined" ? stage.guest.id : null;
  useRoomConnection(stage.kind === "joined" ? code! : null, "guest", joinedGuestId ?? undefined);

  const setTokenBalance = useRoomStore((s) => s.setTokenBalance);
  const setMyRole = useRoomStore((s) => s.setMyRole);
  const setMyPerms = useRoomStore((s) => s.setMyPerms);
  const setMuted = useRoomStore((s) => s.setMuted);
  const setCanAnnounce = useRoomStore((s) => s.setCanAnnounce);
  useEffect(() => {
    if (stage.kind === "joined") {
      setTokenBalance(stage.guest.tokenBalance);
      setMyRole(stage.guest.role);
      setMyPerms(stage.guest.perms ?? []);
      setMuted(stage.guest.muted);
      setCanAnnounce(stage.guest.canAnnounce);
    }
  }, [stage, setTokenBalance, setMyRole, setMyPerms, setMuted, setCanAnnounce]);

  const removed = useRoomStore((s) => s.removed);
  useEffect(() => {
    if (removed) setStage({ kind: "removed" });
  }, [removed]);

  async function handleJoin() {
    if (stage.kind !== "form" || !nickname.trim() || !emoji) return;
    setJoining(true);
    setJoinError(null);
    try {
      const res = await fetch(`/rooms/${code}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname: nickname.trim(), emoji }),
      });
      if (res.status === 403) {
        setStage({ kind: "removed" });
        return;
      }
      if (!res.ok) {
        setJoinError("Couldn't join — try again.");
        return;
      }
      const { guest } = await res.json();
      localStorage.setItem(GUEST_ID_KEY, guest.id);
      setStage({ kind: "joined", room: stage.room, guest });
    } catch {
      setJoinError("Couldn't join — check your connection.");
    } finally {
      setJoining(false);
    }
  }

  if (stage.kind === "checking") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-accent-200">Loading…</p>
      </div>
    );
  }

  if (stage.kind === "removed") {
    return (
      <div className="min-h-screen flex items-center justify-center px-6 text-center">
        <p className="text-accent-200">You've been removed from this party.</p>
      </div>
    );
  }

  if (stage.kind === "not_found") {
    return (
      <div className="min-h-screen flex items-center justify-center px-6 text-center">
        <p className="text-accent-200">That room doesn't exist. Check the code on the TV.</p>
      </div>
    );
  }

  if (stage.kind === "joined") {
    return <GuestApp code={stage.room.code} guest={stage.guest} />;
  }

  const { room } = stage;

  return (
    <div className="min-h-screen flex flex-col gap-6 px-6 py-10">
      <div className="flex items-center gap-2.5">
        <img src="/logo-mark.png" alt="" className="h-8 w-auto" />
        <img src="/logo-text.png" alt="ManyQueue" className="h-5 w-auto" />
      </div>
      <div className="flex flex-col gap-1">
        <span className="self-start rounded-full bg-accent-700 px-3 py-1 text-xs font-bold tracking-widest text-accent-100">
          ROOM {room.code}
        </span>
        <h1 className="text-3xl font-bold text-accent-100">{room.name}</h1>
        <p className="text-accent-300 text-sm">No account needed.</p>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-accent-200 text-sm" htmlFor="nickname">
          Nickname
        </label>
        <input
          id="nickname"
          value={nickname}
          onChange={(e) => setNickname(e.target.value.slice(0, 20))}
          placeholder="Maya"
          className="rounded-md bg-section px-4 py-3 text-lg text-accent-100 outline-none"
          maxLength={20}
        />
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-accent-300 text-xs">Pick your emoji</p>
        <div className="grid grid-cols-6 gap-1.5">
          {GUEST_EMOJI.map((e) => (
            <button
              key={e}
              onClick={() => setEmoji(e)}
              className="grid h-12 place-items-center rounded-md transition-transform"
              style={{
                background: e === emoji ? "rgb(var(--color-accent) / 0.16)" : "rgb(var(--color-section))",
                boxShadow: e === emoji ? "0 0 0 2px rgb(var(--color-accent))" : "none",
                transform: e === emoji ? "scale(1.08)" : "scale(1)",
              }}
            >
              <Emoji value={e} size={26} />
            </button>
          ))}
        </div>
      </div>

      <div className="mt-auto flex flex-col gap-2">
        {joinError && <p className="text-danger text-sm text-center">{joinError}</p>}
        <button
          onClick={handleJoin}
          disabled={!nickname.trim() || !emoji || joining}
          className="rounded-md bg-accent px-6 py-4 font-semibold text-bg disabled:opacity-40"
        >
          {joining ? "Joining…" : "Join the party"}
        </button>
        {emoji && nickname.trim() && (
          <p className="flex items-center justify-center gap-1 text-accent-300 text-center text-xs">
            You'll show up on the TV as <Emoji value={emoji} size={14} /> {nickname.trim()}
          </p>
        )}
      </div>
    </div>
  );
}
