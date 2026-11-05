import { useEffect, useState } from "react";
import { ArrowSquareOut } from "@phosphor-icons/react";
import type { RecapData } from "@manyqueue/shared";
import { RecapView } from "./RecapView";

/** The host desk's Recap section: the recap as it stands right now (it fills up as the night goes), and the link
 * to share once the night has ended. */
export function RecapPreview({ code }: { code: string }) {
  const [recap, setRecap] = useState<RecapData | null>(null);
  const [key, setKey] = useState<string | null>(null);

  useEffect(() => {
    const load = () =>
      fetch(`/rooms/${code}/recap.json`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!d) return;
          setRecap(d.recap);
          setKey(d.key ?? null);
        })
        .catch(() => {});
    void load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [code]);

  const link = key ? `/rooms/${code}/recap?key=${key}` : null;
  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 rounded-lg bg-panel ring-1 ring-panel-line p-4">
        <p className="min-w-0 flex-1 text-sm text-accent-200">
          This is how tonight's recap looks so far. When you end the night, phones get a link to it and the TV plays it as a slideshow.
        </p>
        {link && (
          <a href={link} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-bg">
            <ArrowSquareOut size={16} /> Open the page
          </a>
        )}
      </div>
      {recap ? <RecapView recap={recap} /> : <p className="text-sm text-accent-300">Loading…</p>}
    </div>
  );
}
