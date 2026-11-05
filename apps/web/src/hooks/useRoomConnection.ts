import { useEffect } from "react";
import {
  SOCKET_EVENTS,
  type ClientRole,
  type RoomStateSnapshot,
  type ToastPayload,
  type PongPayload,
  type PlaybackUpdatePayload,
  type SpeakerStatusPayload,
  type QueueItemView,
  type VoteTallyPayload,
  type VoteCountsPayload,
  type RoomSettings,
  type TokenUpdatePayload,
  type RoleChangedPayload,
  type GuestRemovedPayload,
  type IdentityChangedPayload,
  type MutedChangedPayload,
  type AnnounceAllowedChangedPayload,
  type VoteOpenedPayload,
  type VoteClosedPayload,
  type ReactionPayload,
  type VolumeUpdatePayload,
  type SpotifyStatusPayload,
  type AiNicknamePayload,
  type RoomEndedPayload,
  type ScenePayload,
  type AiNicknamesPayload,
  type MineQueueItemView,
  type RotationRoomView,
  type HostRotationBoardView,
  type MyWeightPayload,
} from "@manyqueue/shared";
import { getSocket } from "../socket";
import { useRoomStore } from "../store/roomStore";
import { reactionBus } from "../lib/reactionBus";

export function useRoomConnection(code: string | null, role: ClientRole, guestId?: string) {
  const setSnapshot = useRoomStore((s) => s.setSnapshot);
  const addToast = useRoomStore((s) => s.addToast);
  const setClockOffset = useRoomStore((s) => s.setClockOffset);
  const setConnected = useRoomStore((s) => s.setConnected);
  const setPlayback = useRoomStore((s) => s.setPlayback);
  const setSpeaker = useRoomStore((s) => s.setSpeaker);
  const setQueue = useRoomStore((s) => s.setQueue);
  const setMine = useRoomStore((s) => s.setMine);
  const setRotationRoom = useRoomStore((s) => s.setRotationRoom);
  const setRotationHost = useRoomStore((s) => s.setRotationHost);
  const setMyWeight = useRoomStore((s) => s.setMyWeight);
  const setVoteTally = useRoomStore((s) => s.setVoteTally);
  const openVote = useRoomStore((s) => s.openVote);
  const closeVote = useRoomStore((s) => s.closeVote);
  const setVoteCounts = useRoomStore((s) => s.setVoteCounts);
  const setSettings = useRoomStore((s) => s.setSettings);
  const setTokenBalance = useRoomStore((s) => s.setTokenBalance);
  const setMyRole = useRoomStore((s) => s.setMyRole);
  const setMyPerms = useRoomStore((s) => s.setMyPerms);
  const setVolumePercent = useRoomStore((s) => s.setVolumePercent);
  const setSpotifyBlockedUntil = useRoomStore((s) => s.setSpotifyBlockedUntil);
  const setSpotifyAuthFailed = useRoomStore((s) => s.setSpotifyAuthFailed);
  const setSpotifyBackupNeedsLogin = useRoomStore((s) => s.setSpotifyBackupNeedsLogin);
  const setMyAiNickname = useRoomStore((s) => s.setMyAiNickname);
  const setAiNicknames = useRoomStore((s) => s.setAiNicknames);
  const setRoomEnded = useRoomStore((s) => s.setRoomEnded);
  const setScene = useRoomStore((s) => s.setScene);
  const setMuted = useRoomStore((s) => s.setMuted);
  const setCanAnnounce = useRoomStore((s) => s.setCanAnnounce);
  const setRemoved = useRoomStore((s) => s.setRemoved);
  const setIdentityOverride = useRoomStore((s) => s.setIdentityOverride);

  useEffect(() => {
    if (!code) return;
    const socket = getSocket();

    function join() {
      socket.emit(SOCKET_EVENTS.ROOM_JOIN, { code, role, guestId });
      socket.emit(SOCKET_EVENTS.PING, { clientTime: Date.now() });
    }

    function handleConnect() {
      setConnected(true);
      join();
      fetch(`/rooms/${code}/queue`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => data && setQueue(data.queue))
        .catch(() => {});
      fetch(`/rooms/${code}/rotation`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => data && setRotationRoom(data.rotation))
        .catch(() => {});
      // 403s harmlessly for anyone who isn't host/co-host — same "just try it" pattern as the fetch above.
      fetch(`/rooms/${code}/rotation/host`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => data && setRotationHost(data.board))
        .catch(() => {});
      if (guestId) {
        fetch(`/rooms/${code}/mine`)
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => data && setMine(data.mine))
          .catch(() => {});
      }
    }
    function handleDisconnect() {
      setConnected(false);
    }
    function handleStateFull(snapshot: RoomStateSnapshot) {
      setSnapshot(snapshot);
    }
    function handleToast(toast: ToastPayload) {
      addToast(toast);
    }
    function handlePong(payload: PongPayload) {
      const now = Date.now();
      const roundTripMs = now - payload.clientTime;
      setClockOffset(payload.serverTime - (payload.clientTime + roundTripMs / 2));
    }
    function handlePlayback(payload: PlaybackUpdatePayload) {
      setPlayback(payload);
    }
    function handleSpeaker(payload: SpeakerStatusPayload) {
      setSpeaker(payload);
    }
    function handleQueueUpdate(payload: QueueItemView[]) {
      setQueue(payload);
    }
    function handleMineUpdate(payload: MineQueueItemView[]) {
      setMine(payload);
    }
    function handleRotationUpdate(payload: RotationRoomView) {
      setRotationRoom(payload);
    }
    function handleRotationHostUpdate(payload: HostRotationBoardView) {
      setRotationHost(payload);
    }
    function handleMyWeightUpdate(payload: MyWeightPayload) {
      setMyWeight(payload.weight);
    }
    function handleVolume(payload: VolumeUpdatePayload) {
      setVolumePercent(payload.percent);
    }
    function handleSpotifyStatus(payload: SpotifyStatusPayload) {
      if (payload.blockedUntil !== undefined) setSpotifyBlockedUntil(payload.blockedUntil);
      if (payload.authFailed !== undefined) setSpotifyAuthFailed(payload.authFailed);
      if (payload.backupNeedsLogin !== undefined) setSpotifyBackupNeedsLogin(payload.backupNeedsLogin);
    }
    function handleScene(payload: ScenePayload) {
      setScene(payload.scene);
    }
    function handleRoomEnded(payload: RoomEndedPayload) {
      setRoomEnded({ recapKey: payload.recapKey });
    }
    function handleAiNickname(payload: AiNicknamePayload | null) {
      setMyAiNickname(payload);
    }
    function handleAiNicknames(payload: AiNicknamesPayload) {
      setAiNicknames(payload.nicknames);
    }
    function handleReaction(payload: ReactionPayload) {
      reactionBus.emit(payload);
    }
    function handleVoteOpened(payload: VoteOpenedPayload) {
      openVote(payload);
    }
    function handleVoteClosed(payload: VoteClosedPayload) {
      closeVote(payload);
    }
    // vote:tally carries either the skip-vote tally or a timed vote's counts.
    function handleVoteTally(payload: VoteTallyPayload | VoteCountsPayload) {
      if ("voteId" in payload) setVoteCounts(payload.voteId, payload.counts, { threshold: payload.threshold, active: payload.active });
      else setVoteTally(payload);
    }
    function handleSettingsUpdate(payload: RoomSettings) {
      setSettings(payload);
    }
    function handleTokenUpdate(payload: TokenUpdatePayload) {
      if (payload.guestId === guestId) setTokenBalance(payload.balance);
    }
    function handleRoleChanged(payload: RoleChangedPayload) {
      if (payload.guestId === guestId && (payload.role === "guest" || payload.role === "cohost")) {
        setMyRole(payload.role);
        if (payload.perms) setMyPerms(payload.perms);
      }
    }
    function handleGuestRemoved(payload: GuestRemovedPayload) {
      setRemoved(payload);
    }
    function handleMutedChanged(payload: MutedChangedPayload) {
      setMuted(payload.muted);
    }
    function handleAnnounceAllowedChanged(payload: AnnounceAllowedChangedPayload) {
      setCanAnnounce(payload.canAnnounce);
    }
    function handleIdentityChanged(payload: IdentityChangedPayload) {
      setIdentityOverride(payload);
    }
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        socket.emit(SOCKET_EVENTS.STATE_REQUEST);
      }
    }

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on(SOCKET_EVENTS.STATE_FULL, handleStateFull);
    socket.on(SOCKET_EVENTS.TOAST, handleToast);
    socket.on(SOCKET_EVENTS.PONG, handlePong);
    socket.on(SOCKET_EVENTS.PLAYBACK_UPDATE, handlePlayback);
    socket.on(SOCKET_EVENTS.SPEAKER_STATUS, handleSpeaker);
    socket.on(SOCKET_EVENTS.QUEUE_UPDATE, handleQueueUpdate);
    socket.on(SOCKET_EVENTS.MINE_UPDATE, handleMineUpdate);
    socket.on(SOCKET_EVENTS.ROTATION_UPDATE, handleRotationUpdate);
    socket.on(SOCKET_EVENTS.ROTATION_HOST_UPDATE, handleRotationHostUpdate);
    socket.on(SOCKET_EVENTS.MY_WEIGHT_UPDATE, handleMyWeightUpdate);
    socket.on(SOCKET_EVENTS.VOTE_TALLY, handleVoteTally);
    socket.on(SOCKET_EVENTS.VOTE_OPENED, handleVoteOpened);
    socket.on(SOCKET_EVENTS.REACTION, handleReaction);
    socket.on(SOCKET_EVENTS.SPOTIFY_STATUS, handleSpotifyStatus);
    socket.on(SOCKET_EVENTS.ROOM_ENDED, handleRoomEnded);
    socket.on(SOCKET_EVENTS.SCENE, handleScene);
    socket.on(SOCKET_EVENTS.AI_NICKNAME, handleAiNickname);
    socket.on(SOCKET_EVENTS.AI_NICKNAMES, handleAiNicknames);
    socket.on(SOCKET_EVENTS.VOLUME_UPDATE, handleVolume);
    socket.on(SOCKET_EVENTS.VOTE_CLOSED, handleVoteClosed);
    socket.on(SOCKET_EVENTS.SETTINGS_UPDATE, handleSettingsUpdate);
    socket.on(SOCKET_EVENTS.TOKEN_UPDATE, handleTokenUpdate);
    socket.on(SOCKET_EVENTS.ROLE_CHANGED, handleRoleChanged);
    socket.on(SOCKET_EVENTS.GUEST_KICKED, handleGuestRemoved);
    socket.on(SOCKET_EVENTS.IDENTITY_CHANGED, handleIdentityChanged);
    socket.on(SOCKET_EVENTS.MUTED_CHANGED, handleMutedChanged);
    socket.on(SOCKET_EVENTS.ANNOUNCE_ALLOWED_CHANGED, handleAnnounceAllowedChanged);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    if (socket.connected) handleConnect();

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off(SOCKET_EVENTS.STATE_FULL, handleStateFull);
      socket.off(SOCKET_EVENTS.TOAST, handleToast);
      socket.off(SOCKET_EVENTS.PONG, handlePong);
      socket.off(SOCKET_EVENTS.PLAYBACK_UPDATE, handlePlayback);
      socket.off(SOCKET_EVENTS.SPEAKER_STATUS, handleSpeaker);
      socket.off(SOCKET_EVENTS.QUEUE_UPDATE, handleQueueUpdate);
      socket.off(SOCKET_EVENTS.MINE_UPDATE, handleMineUpdate);
      socket.off(SOCKET_EVENTS.ROTATION_UPDATE, handleRotationUpdate);
      socket.off(SOCKET_EVENTS.ROTATION_HOST_UPDATE, handleRotationHostUpdate);
      socket.off(SOCKET_EVENTS.MY_WEIGHT_UPDATE, handleMyWeightUpdate);
      socket.off(SOCKET_EVENTS.VOTE_TALLY, handleVoteTally);
      socket.off(SOCKET_EVENTS.VOTE_OPENED, handleVoteOpened);
      socket.off(SOCKET_EVENTS.REACTION, handleReaction);
      socket.off(SOCKET_EVENTS.SPOTIFY_STATUS, handleSpotifyStatus);
      socket.off(SOCKET_EVENTS.ROOM_ENDED, handleRoomEnded);
      socket.off(SOCKET_EVENTS.SCENE, handleScene);
      socket.off(SOCKET_EVENTS.AI_NICKNAME, handleAiNickname);
      socket.off(SOCKET_EVENTS.AI_NICKNAMES, handleAiNicknames);
      socket.off(SOCKET_EVENTS.VOLUME_UPDATE, handleVolume);
      socket.off(SOCKET_EVENTS.VOTE_CLOSED, handleVoteClosed);
      socket.off(SOCKET_EVENTS.SETTINGS_UPDATE, handleSettingsUpdate);
      socket.off(SOCKET_EVENTS.TOKEN_UPDATE, handleTokenUpdate);
      socket.off(SOCKET_EVENTS.ROLE_CHANGED, handleRoleChanged);
      socket.off(SOCKET_EVENTS.GUEST_KICKED, handleGuestRemoved);
      socket.off(SOCKET_EVENTS.IDENTITY_CHANGED, handleIdentityChanged);
      socket.off(SOCKET_EVENTS.MUTED_CHANGED, handleMutedChanged);
      socket.off(SOCKET_EVENTS.ANNOUNCE_ALLOWED_CHANGED, handleAnnounceAllowedChanged);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    code,
    role,
    guestId,
    setSnapshot,
    addToast,
    setClockOffset,
    setConnected,
    setPlayback,
    setSpeaker,
    setQueue,
    setMine,
    setRotationRoom,
    setRotationHost,
    setMyWeight,
    setVoteTally,
    openVote,
    closeVote,
    setVoteCounts,
    setSettings,
    setTokenBalance,
    setMyRole,
    setMyPerms,
    setVolumePercent,
    setSpotifyBlockedUntil,
    setSpotifyAuthFailed,
    setSpotifyBackupNeedsLogin,
    setMyAiNickname,
    setAiNicknames,
    setRoomEnded,
    setScene,
    setRemoved,
    setIdentityOverride,
    setMuted,
    setCanAnnounce,
  ]);
}
