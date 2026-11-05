import { useRoomStore } from "../../store/roomStore";
import { PendingApprovalsCard } from "../PendingApprovalsCard";

export function ApproveTab({ code }: { code: string }) {
  const queue = useRoomStore((s) => s.queue);
  const pendingCount = queue.filter((i) => i.status === "pending").length;

  return (
    <div className="flex flex-col items-center gap-3 px-4 py-4">
      {pendingCount === 0 ? (
        <p className="mt-8 text-accent-300 text-center text-sm">
          Nothing waiting for approval right now.
        </p>
      ) : (
        <PendingApprovalsCard code={code} />
      )}
    </div>
  );
}
