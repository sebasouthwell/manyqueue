import { useEffect, useState } from "react";
import { useRoomStore } from "../store/roomStore";
import { SheetManagerProvider } from "../components/sheets/SheetManager";
import { Sheet } from "../components/Sheet";
import { Dialog } from "../components/Dialog";
import { TokenPill } from "../components/TokenPill";
import { AddSheet } from "../components/AddSheet";
import { BanPicker } from "../components/BanPicker";
import { DEFAULT_ROOM_SETTINGS, type PricedTrackResult } from "@manyqueue/shared";

let counter = 0;

/** /demo/sheets — exercises the phone layer rules without a live room: open
 * the sheet, type something, start a vote, and check the pill, the swap and
 * that the sheet comes back with its text. */
export default function SheetDemoPage() {
  const [sheet, setSheet] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [text, setText] = useState("");
  const openVote = useRoomStore((s) => s.openVote);
  const closeVote = useRoomStore((s) => s.closeVote);
  const setMyBallot = useRoomStore((s) => s.setMyBallot);
  const setVoteCounts = useRoomStore((s) => s.setVoteCounts);
  const setTokenBalance = useRoomStore((s) => s.setTokenBalance);
  const myBallots = useRoomStore((s) => s.myBallots);

  const setSettings = useRoomStore((s) => s.setSettings);
  const [addFor, setAddFor] = useState<PricedTrackResult | null>(null);
  const [banPicking, setBanPicking] = useState(false);
  useEffect(() => {
    setTokenBalance(3);
    setSettings({ ...DEFAULT_ROOM_SETTINGS, tokenMode: true });
  }, [setTokenBalance, setSettings]);

  function startVote(seconds: number) {
    counter += 1;
    const id = `demo-vote-${counter}`;
    const deadlineAt = Date.now() + useRoomStore.getState().clockOffsetMs + seconds * 1000;
    openVote({
      id,
      type: "contest",
      title: "Which plays next?",
      instruction: "Tap the song you want",
      deadlineAt,
      options: [
        { id: "a", label: "Levitating", sublabel: "Dua Lipa" },
        { id: "b", label: "Blinding Lights", sublabel: "The Weeknd", disabledReason: "Your song" },
      ],
    });
    setVoteCounts(id, { a: 3, b: 2 });
    setTimeout(
      () => closeVote({ id, winnerOptionId: "a", summary: "Levitating wins", closedAt: deadlineAt }),
      seconds * 1000,
    );
  }

  return (
    <SheetManagerProvider onPick={(voteId, optionId) => setMyBallot(voteId, optionId)}>
      <TokenPill />
      <div className="flex min-h-screen flex-col gap-3 px-6 pt-20">
        <p className="text-accent-200 text-sm">Sheet manager demo. Ballots: {JSON.stringify(myBallots)}</p>
        <button id="open-sheet" onClick={() => setSheet(true)} className="rounded-md bg-accent px-4 py-3 font-semibold text-bg">
          Open add sheet
        </button>
        <button id="start-vote" onClick={() => startVote(25)} className="rounded-md border border-accent px-4 py-3 text-accent-100">
          Start 25s vote
        </button>
        <button id="start-short" onClick={() => startVote(4)} className="rounded-md border border-accent px-4 py-3 text-accent-100">
          Start 4s vote
        </button>
        <button
          id="open-add"
          onClick={() =>
            setAddFor({ uri: "spotify:track:x", name: "Levitating", artistName: "Dua Lipa", albumArtUrl: null, durationMs: 200000, explicit: false, price: 1, playsTonight: 0 } as PricedTrackResult)
          }
          className="rounded-md border border-accent px-4 py-3 text-accent-100"
        >
          Open add options
        </button>
        <button id="open-dialog" onClick={() => setDialog(true)} className="rounded-md border border-accent px-4 py-3 text-accent-100">
          Open dialog
        </button>
      </div>

      {sheet && (
        <Sheet label="Add a song" onClose={() => setSheet(false)}>
          <p className="mb-3 text-lg font-semibold text-accent-100">Add a song</p>
          <input
            id="sheet-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type something…"
            className="mb-3 w-full rounded-md bg-bg px-4 py-3 text-accent-100 outline-none"
          />
          <button id="sheet-dialog" onClick={() => setDialog(true)} className="w-full rounded-md bg-accent px-4 py-3 font-semibold text-bg">
            Add
          </button>
        </Sheet>
      )}
      {addFor && <AddSheet code="DEMO" track={addFor} onCallBan={() => {
              setAddFor(null);
              setBanPicking(true);
            }} onClose={() => setAddFor(null)} onConfirm={async () => { await new Promise((r) => setTimeout(r, 300)); setAddFor(null); return null; }} />}
      {banPicking && <BanPicker code="DEMO" onClose={() => setBanPicking(false)} />}
      {dialog && (
        <Dialog
          title="The price went up"
          body="It's now 2 tokens."
          primaryLabel="Add for 2"
          onPrimary={() => setDialog(false)}
          secondaryLabel="Keep my tokens"
          onSecondary={() => setDialog(false)}
        />
      )}
    </SheetManagerProvider>
  );
}
