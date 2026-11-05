export const TOAST_MS = 4000;
export const MAX_WAITING_TOASTS = 5;

export interface JoinInfo {
  emoji: string;
  nickname: string;
}

export interface QueuedToast {
  id: string;
  message: string;
  emoji?: string;
  /** Present on join toasts — waiting ones merge into a single line. */
  joins?: JoinInfo[];
}

export interface ToastState {
  current: { toast: QueuedToast; startedAt: number } | null;
  queue: QueuedToast[];
}

export const initialToastState: ToastState = { current: null, queue: [] };

export function joinMessage(joins: JoinInfo[]): string {
  const [first, ...others] = joins;
  if (others.length === 0) return `${first.emoji} ${first.nickname} joined`;
  return `${first.emoji} ${first.nickname} and ${others.length} other${others.length === 1 ? "" : "s"} joined`;
}

function settle(state: ToastState, now: number): ToastState {
  let { current, queue } = state;
  if (current && now - current.startedAt >= TOAST_MS) current = null;
  if (!current && queue.length > 0) {
    current = { toast: queue[0], startedAt: now };
    queue = queue.slice(1);
  }
  return { current, queue };
}

/** Adds a toast: first in, first out, at most 5 waiting (the stalest is
 * dropped), and joins still waiting merge into one line. */
export function addToast(state: ToastState, incoming: QueuedToast, now: number): ToastState {
  const all = [state.current?.toast, ...state.queue].filter(Boolean);
  if (all.some((t) => t!.id === incoming.id)) return state;

  let queue = state.queue;
  if (incoming.joins) {
    const idx = queue.findIndex((t) => t.joins);
    if (idx !== -1) {
      const joins = [...queue[idx].joins!, ...incoming.joins];
      queue = queue.map((t, i) => (i === idx ? { ...t, joins, message: joinMessage(joins) } : t));
      return settle({ ...state, queue }, now);
    }
  }
  queue = [...queue, incoming];
  if (queue.length > MAX_WAITING_TOASTS) queue = queue.slice(queue.length - MAX_WAITING_TOASTS);
  return settle({ ...state, queue }, now);
}

export function tickToasts(state: ToastState, now: number): ToastState {
  return settle(state, now);
}
