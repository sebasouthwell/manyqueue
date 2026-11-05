import { useState } from "react";

// The npm `twemoji` package ships only its JS lib, not the PNG assets — those
// live in the source repo, so we pull them from the GitHub-backed CDN instead.
const TWEMOJI_BASE = "https://cdn.jsdelivr.net/gh/jdecked/twemoji@17.0.3/assets/72x72";

/** Twemoji codepoint filename for an emoji string, per the twemoji convention
 * (lowercase hex codepoints joined by "-", variation selectors stripped). */
function toCodepoint(emoji: string): string {
  return Array.from(emoji)
    .map((c) => c.codePointAt(0)!.toString(16))
    .filter((hex) => hex !== "fe0f")
    .join("-");
}

export function twemojiUrl(emoji: string): string {
  return `${TWEMOJI_BASE}/${toCodepoint(emoji)}.png`;
}

interface EmojiProps {
  value: string;
  size?: number;
  className?: string;
}

/** Renders an emoji as a Twemoji image instead of the native glyph, so it
 * looks the same on every phone instead of varying by OS emoji font. Falls
 * back to the native glyph if the CDN image fails to load. */
export function Emoji({ value, size = 20, className }: EmojiProps) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span className={className} style={{ fontSize: size, lineHeight: 1, verticalAlign: "-0.15em" }}>
        {value}
      </span>
    );
  }

  return (
    <img
      src={twemojiUrl(value)}
      alt={value}
      draggable={false}
      className={className}
      style={{ width: size, height: size, display: "inline-block", verticalAlign: "-0.15em" }}
      onError={() => setFailed(true)}
    />
  );
}

const EMOJI_IN_TEXT = /(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*)/gu;

/** Text with any emoji in it drawn as Twemoji images (sized to the text), so a line like
 * "The Reggaeton Menace 🐰" looks the same on every screen. */
export function EmojiText({ text, size = 20 }: { text: string; size?: number }) {
  return (
    <>
      {text.split(EMOJI_IN_TEXT).map((part, i) =>
        i % 2 === 1 ? <Emoji key={i} value={part} size={size} /> : part,
      )}
    </>
  );
}
