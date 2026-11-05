import { useEffect, useState } from "react";
import { Heart } from "@phosphor-icons/react";

/** The dedication under a song's title on the TV. It fades in when the moment
 * starts and out when it ends; the last text is kept while fading so it
 * doesn't blank out first. */
export function DedicationLine({ text }: { text: string | null }) {
  const [shown, setShown] = useState<string | null>(text);
  useEffect(() => {
    if (text) {
      setShown(text);
      return;
    }
    const t = setTimeout(() => setShown(null), 450); // after the fade, remove it entirely
    return () => clearTimeout(t);
  }, [text]);

  const visible = !!text;
  return (
    <div
      aria-live="polite"
      style={{
        maxHeight: visible ? 120 : 0,
        opacity: visible ? 1 : 0,
        overflow: "hidden",
        transition: "opacity 400ms ease, max-height 400ms ease",
      }}
    >
      {shown && (
        <p
          className="flex items-center gap-3 text-accent-100"
          style={{ fontSize: 34, fontWeight: 500, paddingTop: 6 }}
        >
          <Heart size={34} weight="fill" className="shrink-0 text-accent-300" />
          <span style={{ overflowWrap: "anywhere" }}>{shown}</span>
        </p>
      )}
    </div>
  );
}
