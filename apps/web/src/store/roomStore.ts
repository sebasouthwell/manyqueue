import { create } from "zustand";
import { FIRE_REACTION, type Permission, sanitizeReactionSet, shouldOpenVote, type ReactionEmoji } from "@manyqueue/shared";
import type {
  RoomStateSnapshot,
  ToastPayload,
  PlaybackUpdatePayload,
  SpeakerStatusPayload,
  QueueItemView,
  VoteTallyPayload,
  RoomSettings,
  GuestRole,
  GuestRemovedPayload,
  IdentityChangedPayload,
  VoteOpenedPayload,
  VoteClosedPayload,
  AiNicknamePayload,
  AiNicknameView,
  SceneId,
  MineQueueItemView,
  RotationRoomView,
  HostRotationBoardView,
} from "@manyqueue/shared";

const REACTION_KEY = "manyqueue_reactions";

function loadReactionSet(): ReactionEmoji[] {
  try {
    return sanitizeReactionSet(JSON.parse(localStorage.getItem(REACTION_KEY) ?? "null"));
  } catch {
    return sanitizeReactionSet(null);
  }
}

interface RoomStore {
  /** My four reaction buttons: fire first (fixed), three of my choosing. */
  reactionSet: ReactionEmoji[];
  setReactionSlot: (slot: number, emoji: ReactionEmoji) => void;
  snapshot: RoomStateSnapshot | null;
  toasts: ToastPayload[];
  clockOffsetMs: number;
  connected: boolean;
  playback: PlaybackUpdatePayload | null;
  speaker: SpeakerStatusPayload | null;
  queue: QueueItemView[];
  /** Rotation mode only: my own personal queue. */
  mine: MineQueueItemView[];
  setMine: (mine: MineQueueItemView[]) => void;
  /** Rotation mode only: on deck + the rotation order, everyone's view. */
  rotationRoom: RotationRoomView | null;
  setRotationRoom: (rotationRoom: RotationRoomView) => void;
  /** Rotation mode only, host/co-host only: the full Queues board with real song titles. */
  rotationHost: HostRotationBoardView | null;
  setRotationHost: (rotationHost: HostRotationBoardView) => void;
  /** Rotation mode only, private: my own turn weight, only ever set when it's above x1 (§8). */
  myWeight: number | null;
  setMyWeight: (myWeight: number) => void;
  voteTally: VoteTallyPayload | null;
  settings: RoomSettings | null;
  tokenBalance: number | null;
  myRole: GuestRole | null;
  muted: boolean;
  /** Announcements are on by default; staff can take it away from just this guest. */
  canAnnounce: boolean;
  removed: GuestRemovedPayload | null;
  identityOverride: IdentityChangedPayload | null;
  votes: VoteOpenedPayload[];
  voteClosed: Record<string, VoteClosedPayload>;
  myBallots: Record<string, string>;
  voteCounts: Record<string, Record<string, number>>;
  openVote: (vote: VoteOpenedPayload) => void;
  closeVote: (closed: VoteClosedPayload) => void;
  setMyBallot: (voteId: string, optionId: string | null) => void;
  setVoteCounts: (voteId: string, counts: Record<string, number>, extras?: { threshold?: number; active?: number }) => void;
  /** Ban votes: yes votes needed and how many could vote, kept live from the tally. */
  voteMeta: Record<string, { threshold?: number; active?: number }>;
  setSnapshot: (snapshot: RoomStateSnapshot) => void;
  addToast: (toast: ToastPayload) => void;
  setClockOffset: (ms: number) => void;
  setConnected: (connected: boolean) => void;
  setPlayback: (playback: PlaybackUpdatePayload) => void;
  setSpeaker: (speaker: SpeakerStatusPayload) => void;
  setQueue: (queue: QueueItemView[]) => void;
  setVoteTally: (voteTally: VoteTallyPayload) => void;
  setSettings: (settings: RoomSettings) => void;
  setTokenBalance: (balance: number) => void;
  setMyRole: (role: GuestRole) => void;
  myPerms: Permission[];
  setMyPerms: (perms: Permission[]) => void;
  /** Spotify has rate-limited the app until this time (epoch ms), or null. */
  spotifyBlockedUntil: number | null;
  setSpotifyBlockedUntil: (until: number | null) => void;
  spotifyAuthFailed: boolean;
  spotifyBackupNeedsLogin: boolean;
  setSpotifyAuthFailed: (failed: boolean) => void;
  setSpotifyBackupNeedsLogin: (needsLogin: boolean) => void;
  /** The server has an AI key, so the AI nickname settings and cards make sense. */
  aiNicknamesAvailable: boolean;
  /** My own AI nickname (null when I have none or it was hidden). */
  myAiNickname: AiNicknamePayload | null;
  setMyAiNickname: (nickname: AiNicknamePayload | null) => void;
  /** Staff only: every guest's newest AI nickname with its status. */
  aiNicknames: AiNicknameView[];
  setAiNicknames: (nicknames: AiNicknameView[]) => void;
  /** The night is over (set by room:ended, or by a snapshot of an ended room); carries the recap link key. */
  /** The TV's genre scene for the playing song (null = plain background). */
  scene: SceneId | null;
  setScene: (scene: SceneId | null) => void;
  roomEnded: { recapKey?: string } | null;
  setRoomEnded: (ended: { recapKey?: string } | null) => void;
  /** Queue items I added anonymously: the server won't say they're mine, so I remember. */
  myMysteryIds: string[];
  rememberMyMystery: (itemId: string) => void;
  /** Speaker volume 0-100 as last reported by Spotify, null when unknown. */
  volumePercent: number | null;
  setVolumePercent: (percent: number | null) => void;
  setMuted: (muted: boolean) => void;
  setCanAnnounce: (canAnnounce: boolean) => void;
  setRemoved: (removed: GuestRemovedPayload) => void;
  setIdentityOverride: (identity: IdentityChangedPayload) => void;
}

export const useRoomStore = create<RoomStore>((set) => ({
  reactionSet: loadReactionSet(),
  // Slot 0 is fire and never changes. Picking an emoji another slot already
  // has swaps the two, so the set stays four distinct emoji.
  setReactionSlot: (slot, emoji) =>
    set((state) => {
      if (slot < 1 || slot >= state.reactionSet.length || emoji === FIRE_REACTION) return {};
      const next = [...state.reactionSet];
      const other = next.indexOf(emoji);
      if (other !== -1) next[other] = next[slot];
      next[slot] = emoji;
      const clean = sanitizeReactionSet(next);
      try {
        localStorage.setItem(REACTION_KEY, JSON.stringify(clean));
      } catch {
        // storage blocked: the choice just lasts until reload
      }
      return { reactionSet: clean };
    }),
  snapshot: null,
  toasts: [],
  clockOffsetMs: 0,
  connected: false,
  playback: null,
  speaker: null,
  queue: [],
  mine: [],
  rotationRoom: null,
  rotationHost: null,
  myWeight: null,
  voteTally: null,
  settings: null,
  tokenBalance: null,
  myRole: null,
  muted: false,
  canAnnounce: true,
  removed: null,
  identityOverride: null,
  votes: [],
  voteClosed: {},
  myBallots: {},
  voteCounts: {},
  voteMeta: {},
  // A snapshot that lists active votes is the truth on reconnect: drop any
  // vote it no longer lists, and never open one that already ended.
  setSnapshot: (snapshot) =>
    set((state) => {
      const next: Partial<RoomStore> = { snapshot, settings: snapshot.settings };
      if (snapshot.volumePercent !== undefined) next.volumePercent = snapshot.volumePercent;
      if (snapshot.spotifyBlockedUntil !== undefined) next.spotifyBlockedUntil = snapshot.spotifyBlockedUntil;
      if (snapshot.spotifyAuthFailed !== undefined) next.spotifyAuthFailed = snapshot.spotifyAuthFailed;
      if (snapshot.spotifyBackupNeedsLogin !== undefined) next.spotifyBackupNeedsLogin = snapshot.spotifyBackupNeedsLogin;
      if (snapshot.aiNicknamesAvailable !== undefined) next.aiNicknamesAvailable = snapshot.aiNicknamesAvailable;
      if (snapshot.scene !== undefined) next.scene = snapshot.scene;
      if (snapshot.status === "ended") next.roomEnded = { recapKey: snapshot.recapKey };
      if (snapshot.activeVotes) {
        const now = Date.now() + state.clockOffsetMs;
        const live = snapshot.activeVotes.filter((v) => shouldOpenVote(v, now));
        const ballots = { ...state.myBallots };
        for (const v of live) if (v.myOptionId) ballots[v.id] = v.myOptionId;
        // A vote the server already closed stays for its 2s result hold even
        // though the snapshot no longer lists it.
        const listed = new Set(live.map((v) => v.id));
        const holding = state.votes.filter((v) => !listed.has(v.id) && state.voteClosed[v.id]);
        next.votes = [...live, ...holding];
        next.myBallots = ballots;
      }
      return next;
    }),
  openVote: (vote) =>
    set((state) => {
      const now = Date.now() + state.clockOffsetMs;
      if (!shouldOpenVote(vote, now) || state.votes.some((v) => v.id === vote.id)) return {};
      return {
        voteMeta:
          vote.threshold !== undefined
            ? { ...state.voteMeta, [vote.id]: { threshold: vote.threshold, active: vote.active } }
            : state.voteMeta,
        votes: [...state.votes, vote],
        myBallots: vote.myOptionId ? { ...state.myBallots, [vote.id]: vote.myOptionId } : state.myBallots,
      };
    }),
  closeVote: (closed) =>
    set((state) => ({ voteClosed: { ...state.voteClosed, [closed.id]: closed } })),
  setMyBallot: (voteId, optionId) =>
    set((state) => {
      const ballots = { ...state.myBallots };
      if (optionId) ballots[voteId] = optionId;
      else delete ballots[voteId];
      return { myBallots: ballots };
    }),
  setVoteCounts: (voteId, counts, extras) =>
    set((state) => ({
      voteCounts: { ...state.voteCounts, [voteId]: counts },
      voteMeta: extras ? { ...state.voteMeta, [voteId]: { ...state.voteMeta[voteId], ...extras } } : state.voteMeta,
    })),
  addToast: (toast) => set((state) => ({ toasts: [...state.toasts.slice(-4), toast] })),
  setClockOffset: (clockOffsetMs) => set({ clockOffsetMs }),
  setConnected: (connected) => set({ connected }),
  setPlayback: (playback) => set({ playback }),
  setSpeaker: (speaker) => set({ speaker }),
  setQueue: (queue) => set({ queue }),
  setMine: (mine) => set({ mine }),
  setRotationRoom: (rotationRoom) => set({ rotationRoom }),
  setRotationHost: (rotationHost) => set({ rotationHost }),
  setMyWeight: (myWeight) => set({ myWeight }),
  setVoteTally: (voteTally) => set({ voteTally }),
  setSettings: (settings) => set({ settings }),
  setTokenBalance: (tokenBalance) => set({ tokenBalance }),
  setMyRole: (myRole) => set({ myRole }),
  myPerms: [],
  setMyPerms: (myPerms) => set({ myPerms }),
  spotifyBlockedUntil: null,
  setSpotifyBlockedUntil: (spotifyBlockedUntil) => set({ spotifyBlockedUntil }),
  spotifyAuthFailed: false,
  spotifyBackupNeedsLogin: false,
  aiNicknamesAvailable: false,
  myAiNickname: null,
  setMyAiNickname: (myAiNickname) => set({ myAiNickname }),
  aiNicknames: [],
  scene: null,
  setScene: (scene) => set({ scene }),
  roomEnded: null,
  setRoomEnded: (roomEnded) => set({ roomEnded }),
  setAiNicknames: (aiNicknames) => set({ aiNicknames }),
  setSpotifyBackupNeedsLogin: (spotifyBackupNeedsLogin) => set({ spotifyBackupNeedsLogin }),
  setSpotifyAuthFailed: (spotifyAuthFailed) => set({ spotifyAuthFailed }),
  myMysteryIds: [],
  rememberMyMystery: (itemId) => set((state) => ({ myMysteryIds: [...state.myMysteryIds, itemId].slice(-50) })),
  volumePercent: null,
  setVolumePercent: (volumePercent) => set({ volumePercent }),
  setMuted: (muted) => set({ muted }),
  setCanAnnounce: (canAnnounce) => set({ canAnnounce }),
  setRemoved: (removed) => set({ removed }),
  setIdentityOverride: (identityOverride) => set({ identityOverride }),
}));
