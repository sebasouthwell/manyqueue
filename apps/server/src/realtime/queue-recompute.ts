import type { Room } from "../db/rooms.js";
import { getRoomSettings } from "../db/settings.js";
import { applyFairOrder, recomputeApprovalLockAt } from "../db/queue.js";

/** Recomputes queued positions via fairOrder, but only when the room has it
 * turned on — off means plain first-in, first-out (i.e. do nothing, leave
 * whatever position add/remove/move already assigned). Call right before the
 * caller's own serializeQueue + QUEUE_UPDATE broadcast so there's one
 * broadcast reflecting the final settled order. */
export function maybeApplyFairOrder(room: Room): void {
  const settings = getRoomSettings(room.id);
  if (settings.fairOrder) applyFairOrder(room.id);
}

/** Recomputes every pending item's approvalLockAt, but only when approvals
 * are turned on. Call after any queue-structure change (add/remove/reorder)
 * — ideally after maybeApplyFairOrder, since that may have just changed
 * positions the lock-time estimate depends on. */
export function maybeRecomputeApprovalLockAt(room: Room): void {
  const settings = getRoomSettings(room.id);
  if (settings.approvals) recomputeApprovalLockAt(room.id, settings.approvalGraceSec);
}
