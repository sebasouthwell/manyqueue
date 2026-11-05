import { useState } from "react";
import { useGames } from "../hooks/useGames";
import { LiveGameCard } from "./LiveGameCard";
import { ContestPanel } from "./ContestPanel";
import { useRoomStore } from "../store/roomStore";
import { GamesSection } from "./GamesSection";

/** The live game card plus the games cards, for the narrow host layout and for
 * a co-host's phone. `canVeto` is true for the host only. */
export function GamesPanel({ code, canVeto }: { code: string; canVeto: boolean }) {
  const games = useGames(code);
  const settings = useRoomStore((s) => s.settings);
  const [pickingTwo, setPickingTwo] = useState(false);
  return (
    <div className="flex w-full max-w-md flex-col gap-3">
      <LiveGameCard code={code} state={games.state} canVeto={canVeto} onPickTwo={() => setPickingTwo(true)} />
      <GamesSection
        code={code}
        state={games.state}
        history={games.history}
        settings={settings}
        canVeto={canVeto}
        onPickTwo={() => setPickingTwo(true)}
        onChanged={games.refresh}
      />
      {pickingTwo && games.state && <ContestPanel code={code} pool={games.state.contest} onClose={() => setPickingTwo(false)} />}
    </div>
  );
}
