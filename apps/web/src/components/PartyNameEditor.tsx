import { useEffect, useRef, useState } from "react";
import { PencilSimple, Check } from "@phosphor-icons/react";
import { PARTY_NAME_MAX_LENGTH, cleanPartyName } from "@manyqueue/shared";
import { useRoomStore } from "../store/roomStore";

/** The party's name, editable in place by the host. The live name comes from
 * the room snapshot, so it changes everywhere as soon as it's saved. */
export function PartyNameEditor({
  code,
  initialName,
  onRenamed,
}: {
  code: string;
  initialName: string;
  onRenamed?: (name: string) => void;
}) {
  const liveName = useRoomStore((s) => s.snapshot?.name);
  const name = liveName ?? initialName;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  function open() {
    setDraft(name);
    setError(null);
    setEditing(true);
  }

  async function save() {
    const checked = cleanPartyName(draft);
    if (!checked.ok) {
      setError(
        checked.error === "empty"
          ? "Give the party a name."
          : checked.error === "too_long"
            ? `Keep it under ${PARTY_NAME_MAX_LENGTH} characters.`
            : "Keep it party-friendly 💜",
      );
      return;
    }
    if (checked.name === name) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/rooms/${code}/name`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: checked.name }),
      });
      if (!res.ok) {
        setError("Couldn't save. Try again.");
        return;
      }
      onRenamed?.(checked.name);
      setEditing(false);
    } catch {
      setError("Couldn't save. Check your connection.");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <button
        onClick={open}
        aria-label={`Party name: ${name}. Tap to rename.`}
        className="group flex max-w-full items-center gap-1.5 text-left"
      >
        <span className="truncate text-sm font-semibold text-accent-100">{name}</span>
        <PencilSimple size={13} className="shrink-0 text-accent-300 group-hover:text-accent-100" />
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <input
          ref={input}
          value={draft}
          onChange={(e) => {
            setDraft(Array.from(e.target.value).slice(0, PARTY_NAME_MAX_LENGTH).join(""));
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") setEditing(false);
          }}
          aria-label="Party name"
          aria-invalid={!!error}
          className="min-w-0 flex-1 rounded-md bg-bg px-2 py-1 text-sm text-accent-100 outline-none"
        />
        <button
          onClick={save}
          disabled={saving}
          aria-label="Save party name"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent text-bg disabled:opacity-50"
        >
          <Check size={14} weight="bold" />
        </button>
      </div>
      {error && (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
