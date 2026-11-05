import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import type { RecapData } from "@manyqueue/shared";
import { RecapView } from "../components/RecapView";

/** /rooms/:code/recap?key=... — the night's recap, for anyone who has the link. */
export default function RecapPage() {
  const { code } = useParams();
  const [params] = useSearchParams();
  const [recap, setRecap] = useState<RecapData | null>(null);
  const [state, setState] = useState<"loading" | "missing" | "ready">("loading");

  useEffect(() => {
    const key = params.get("key");
    fetch(`/rooms/${code}/recap.json${key ? `?key=${encodeURIComponent(key)}` : ""}`)
      .then(async (res) => {
        if (!res.ok) return setState("missing");
        const data = await res.json();
        setRecap(data.recap);
        setState("ready");
      })
      .catch(() => setState("missing"));
  }, [code, params]);

  return (
    <div className="min-h-screen py-6">
      {state === "loading" && <p className="mt-24 text-center text-accent-200">Loading…</p>}
      {state === "missing" && (
        <div className="mx-auto mt-24 max-w-sm px-6 text-center">
          <img src="/logo-mark.png" alt="" className="mx-auto h-12 w-auto" />
          <p className="mt-4 text-lg font-semibold text-accent-100">This recap isn't available</p>
          <p className="mt-1 text-sm text-accent-300">The link may be incomplete, or the night hasn't ended yet.</p>
        </div>
      )}
      {state === "ready" && recap && <RecapView recap={recap} />}
    </div>
  );
}
