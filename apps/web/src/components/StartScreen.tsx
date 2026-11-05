import { useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Broadcast, Lightning, MusicNotes, UsersThree, WarningCircle } from "@phosphor-icons/react";

const CODE_LENGTH = 4;

/** The front door: log in with Spotify to host, or type a room code to join as a guest. */
export function StartScreen({ notice }: { notice?: ReactNode }) {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join(e: FormEvent) {
    e.preventDefault();
    if (code.length !== CODE_LENGTH || checking) return;
    setChecking(true);
    setError(null);
    try {
      const res = await fetch(`/rooms/${code}`);
      if (res.ok) {
        navigate(`/r/${code}`);
        return;
      }
      setError(res.status === 404 ? "No party with that code. Check the TV." : "Couldn't check that code. Try again.");
    } catch {
      setError("Couldn't reach the party. Check your connection.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="relative flex min-h-screen w-full flex-col items-center justify-center overflow-hidden px-5 py-12">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full"
        style={{ background: "radial-gradient(closest-side, rgb(var(--color-accent) / 0.28), transparent)" }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-52 right-[-120px] h-[460px] w-[460px] rounded-full"
        style={{ background: "radial-gradient(closest-side, rgb(var(--color-accent-300) / 0.16), transparent)" }}
      />

      <header className="relative mb-9 flex flex-col items-center gap-4 text-center">
        <img src="/logo-mark.png" alt="" className="h-16 w-auto drop-shadow-[0_0_28px_rgba(139,124,240,0.45)]" />
        <h1 className="sr-only">ManyQueue</h1>
        <img src="/logo-text.png" alt="ManyQueue" className="h-10 w-auto" />
        <p className="max-w-sm text-base text-accent-200">The party queue everyone can add to. Songs, votes and games, on one speaker.</p>
      </header>

      {notice && <div className="relative mb-4 w-full max-w-3xl">{notice}</div>}

      <main className="relative grid w-full max-w-3xl gap-4 md:grid-cols-2">
        <section className="flex flex-col gap-4 rounded-2xl bg-section p-6 shadow-[0_0_0_1px_rgb(var(--color-accent-700))]">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent/20 text-accent-100">
              <Broadcast size={24} weight="fill" />
            </span>
            <h2 className="text-xl font-semibold text-accent-100">Host a party</h2>
          </div>
          <p className="text-sm text-accent-200">Put your Spotify on a speaker and let the room run the queue.</p>
          <ul className="flex flex-col gap-2 text-sm text-accent-200">
            <li className="flex items-center gap-2">
              <MusicNotes size={16} className="text-accent-300" /> Guests add songs from their phones
            </li>
            <li className="flex items-center gap-2">
              <Lightning size={16} className="text-accent-300" /> Contests, ban votes and Guess Who
            </li>
            <li className="flex items-center gap-2">
              <UsersThree size={16} className="text-accent-300" /> A TV screen everyone can see
            </li>
          </ul>
          <a
            href="/auth/login"
            className="mt-auto flex items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3 font-semibold text-bg"
          >
            Log in with Spotify <ArrowRight size={18} weight="bold" />
          </a>
          <p className="text-center text-xs text-accent-300">Needs Spotify Premium.</p>
        </section>

        <section className="flex flex-col gap-4 rounded-2xl bg-section p-6 shadow-[0_0_0_1px_rgb(var(--color-accent-700))]">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent-300/20 text-accent-100">
              <UsersThree size={24} weight="fill" />
            </span>
            <h2 className="text-xl font-semibold text-accent-100">Join a party</h2>
          </div>
          <p className="text-sm text-accent-200">Got a code from the TV? Type it in. Scanning the QR code works too.</p>
          <form onSubmit={join} className="mt-auto flex flex-col gap-3" noValidate>
            <label htmlFor="room-code" className="sr-only">
              Room code
            </label>
            <input
              id="room-code"
              value={code}
              onChange={(e) => {
                setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, CODE_LENGTH));
                setError(null);
              }}
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              placeholder="ABCD"
              aria-invalid={!!error}
              aria-describedby={error ? "room-code-error" : undefined}
              className="w-full rounded-xl bg-bg px-4 py-3 text-center text-3xl font-extrabold tracking-[0.4em] text-accent-100 outline-none placeholder:text-accent-800 focus:shadow-[0_0_0_2px_rgb(var(--color-accent))]"
            />
            {error && (
              <p id="room-code-error" className="flex items-center gap-1.5 text-sm text-danger" role="alert">
                <WarningCircle size={16} weight="fill" /> {error}
              </p>
            )}
            <button
              type="submit"
              disabled={code.length !== CODE_LENGTH || checking}
              className="flex items-center justify-center gap-2 rounded-xl border border-accent px-5 py-3 font-semibold text-accent-100 disabled:opacity-40"
            >
              {checking ? "Checking…" : "Join"} {!checking && <ArrowRight size={18} weight="bold" />}
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
