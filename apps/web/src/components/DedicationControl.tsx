import { EyeSlash, Eye, Heart } from "@phosphor-icons/react";
import type { QueueItemView } from "@manyqueue/shared";

/** A song's dedication on a host panel, with hide / show. The server sends the
 * text only while it's visible, so a hidden one shows just its state. */
export function DedicationControl({ code, item }: { code: string; item: Pick<QueueItemView, "id" | "dedication" | "dedicationHidden"> }) {
  if (!item.dedication && !item.dedicationHidden) return null;

  async function toggle(hide: boolean) {
    await fetch(`/rooms/${code}/queue/${item.id}/dedication/${hide ? "hide" : "show"}`, { method: "POST" });
  }

  return (
    <p className="flex items-center gap-1.5 text-xs text-accent-200">
      {item.dedicationHidden ? (
        <>
          <EyeSlash size={12} /> Dedication hidden
          <button onClick={() => toggle(false)} className="ml-1 flex items-center gap-1 text-accent-300 underline">
            <Eye size={11} /> Show
          </button>
        </>
      ) : (
        <>
          <Heart size={12} weight="fill" className="shrink-0 text-accent-300" />
          <span className="min-w-0 truncate">{item.dedication}</span>
          <button onClick={() => toggle(true)} className="ml-1 flex shrink-0 items-center gap-1 text-accent-300 underline">
            <EyeSlash size={11} /> Hide
          </button>
        </>
      )}
    </p>
  );
}
