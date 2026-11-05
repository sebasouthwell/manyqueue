// Curated set so every guest's identity renders identically everywhere —
// no open-ended emoji picker to keep TV/phone rendering consistent.
export const GUEST_EMOJI = [
  "🦋", "🦊", "🌮", "🌙", "🐙", "🔥", "🎧", "🍕", "🐸", "👽", "🌈", "🦄",
  "🍒", "⚡", "🐼", "🎸", "🌵", "🍩", "🍉", "🐳", "🦁", "🐢", "🍔", "🎲",
  "🌻", "🦖", "🍦", "🎯", "🐧", "🍿", "🧃", "🎨", "🐨", "🍋", "🚀", "🎃",
  "🦩", "🍓", "🐝", "🎱", "🌸", "🍪", "🦈", "🎺", "🐬", "🍄", "⭐", "🦥","🎩","👹","🧓","💃","🕺","🥃"
] as const;

export type GuestEmoji = (typeof GUEST_EMOJI)[number];
