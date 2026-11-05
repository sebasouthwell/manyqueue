import { Fragment, useEffect, useState } from "react";
import { Emoji, EmojiText } from "./Emoji";
import { ContestWinner } from "./ContestWinner";
import { banBarLayout, type Moment, type TakeoverPayload } from "@manyqueue/shared";

const ENTER_MS = 400;

function countdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * The one full-stage takeover layout (UI-GUIDE §6.3): question on top, choices
 * in the middle, a live bar, the countdown top right and one instruction line
 * at the bottom. It sits under the header and the QR corner, which are their
 * own layers in TvPage, so neither can ever be covered.
 */
export function Takeover({
  moment,
  serverNow,
  counts,
  meta,
}: {
  moment: Moment;
  serverNow: () => number;
  /** Live ballots per choice id for a vote takeover; turned into percentages here. */
  counts?: Record<string, number>;
  /** Ban votes: the live yes-votes-needed and electorate size from the tally. */
  meta?: { threshold?: number; active?: number };
}) {
  const p = moment.payload as TakeoverPayload;
  const [entered, setEntered] = useState(false);
  const [now, setNow] = useState(serverNow());

  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (p.deadlineAt === undefined) return;
    const timer = setInterval(() => setNow(serverNow()), 250);
    return () => clearInterval(timer);
  }, [p.deadlineAt, serverNow]);

  const showingResult = p.winnerChoiceId !== undefined;
  // A live vote fills in percentages from the tally; a result payload already carries its own.
  const total = p.choices?.reduce((sum, c) => sum + (counts?.[c.id] ?? 0), 0) ?? 0;
  const choices = p.choices?.map((c) =>
    c.percent !== undefined || !p.voteId ? c : { ...c, percent: total > 0 ? ((counts?.[c.id] ?? 0) / total) * 100 : 0 },
  );
  const bar = p.ban ? null : choices?.some((c) => c.percent !== undefined) ? choices : null;
  const banBar = p.ban
    ? (() => {
        const yes = counts?.yes ?? 0;
        const no = counts?.no ?? 0;
        const threshold = meta?.threshold ?? p.ban.threshold;
        const active = meta?.active ?? p.ban.active;
        return { yes, no, threshold, ...banBarLayout(yes, no, active, threshold) };
      })()
    : null;

  return (
    <div
      className="absolute inset-0 bg-gradient-to-br from-section to-bg"
      style={{
        zIndex: 30,
        opacity: entered ? 1 : 0,
        transform: `scale(${entered ? 1 : 0.98})`,
        transition: `opacity ${ENTER_MS}ms ease, transform ${ENTER_MS}ms ease`,
      }}
    >
      {p.reveal && <RevealBody reveal={p.reveal} entered={entered} />}
      {p.nickname && <NicknameBody nickname={p.nickname} entered={entered} />}
      {showingResult && p.vs && choices && (
        <ContestWinner
          winner={choices.find((c) => c.id === p.winnerChoiceId) ?? choices[0]}
          loser={choices.find((c) => c.id !== p.winnerChoiceId)}
          resultText={p.resultText}
        />
      )}
      {!p.reveal && !p.nickname && (
      <p
        className="absolute font-medium leading-tight text-accent-100"
        style={{ top: 132, left: 96, width: 1250, fontSize: 68, letterSpacing: "-0.02em" }}
      >
        {p.question}
      </p>
      )}

      {!p.reveal && !p.nickname && p.deadlineAt !== undefined && !showingResult && (
        <p
          className="absolute font-medium tabular-nums text-accent-100"
          style={{ top: 118, right: 96, fontSize: 84 }}
        >
          {countdown(p.deadlineAt - now)}
        </p>
      )}

      {!p.reveal && !p.nickname && choices && (
        <div
          className="absolute flex items-start justify-center"
          style={{ top: 300, left: 96, right: 96, gap: p.vs ? 36 : 72 }}
        >
          {choices.map((c, i) => {
            const isWinner = p.winnerChoiceId === c.id;
            const faded = showingResult && !isWinner;
            return (
              <Fragment key={c.id}>
              {p.vs && i === 1 && (
                <div
                  className="self-center font-bold text-accent-300"
                  style={{ fontSize: 64, marginTop: -90, opacity: showingResult ? 0.3 : 1, transition: "opacity 400ms ease" }}
                >
                  VS
                </div>
              )}
              <div
                className="flex flex-col items-center gap-3 text-center"
                style={{
                  width: 330,
                  opacity: faded ? 0.4 : 1,
                  transform: `scale(${isWinner ? 1.08 : 1})`,
                  transition: "opacity 400ms ease, transform 400ms ease",
                }}
              >
                {c.artUrl !== undefined && (
                  c.artUrl ? (
                    <img src={c.artUrl} alt="" style={{ width: 330, height: 330, borderRadius: 14 }} />
                  ) : (
                    <div className="bg-accent-800" style={{ width: 330, height: 330, borderRadius: 14 }} />
                  )
                )}
                <p className="w-full truncate font-medium text-accent-100" style={{ fontSize: 34 }}>
                  {c.label}
                </p>
                {c.sublabel && (
                  <p className="w-full truncate text-accent-200" style={{ fontSize: 26 }}>
                    {c.sublabel}
                  </p>
                )}
                {c.byline && (
                  <p className="w-full truncate text-accent-300" style={{ fontSize: 24 }}>
                    {c.byline}
                  </p>
                )}
              </div>
              </Fragment>
            );
          })}
        </div>
      )}

      {bar && (
        <div className="absolute" style={{ left: 96, right: 96, top: 812 }}>
          <div className="flex overflow-hidden bg-accent-900" style={{ height: 28, borderRadius: 14 }}>
            {bar.map((c, i) => (
              <div
                key={c.id}
                style={{
                  width: `${c.percent ?? 0}%`,
                  background: i === 0 ? "rgb(var(--color-accent))" : "rgb(var(--color-accent-300))",
                  transition: "width 300ms ease",
                }}
              />
            ))}
          </div>
          <div className="mt-3 flex justify-between text-accent-200 tabular-nums" style={{ fontSize: 28 }}>
            {bar.map((c) => (
              <span key={c.id}>{Math.round(c.percent ?? 0)}%</span>
            ))}
          </div>
        </div>
      )}

      {banBar && (
        <div className="absolute" style={{ left: 96, right: 96, top: 812 }}>
          <div className="relative">
            <div className="flex overflow-hidden bg-accent-900" style={{ height: 28, borderRadius: 14 }}>
              <div style={{ width: `${banBar.yesPct}%`, background: "rgb(var(--color-danger))", transition: "width 300ms ease" }} />
              <div style={{ flex: 1 }} />
              <div style={{ width: `${banBar.noPct}%`, background: "rgb(var(--color-accent-300))", transition: "width 300ms ease" }} />
            </div>
            <div
              className="absolute bg-accent-100"
              style={{ left: `${banBar.thresholdPct}%`, top: -10, width: 4, height: 48, borderRadius: 2, transform: "translateX(-2px)" }}
            />
            <p
              className="absolute whitespace-nowrap text-accent-100"
              style={{ left: `${banBar.thresholdPct}%`, top: -52, fontSize: 24, transform: "translateX(-50%)" }}
            >
              Needs {banBar.threshold}
            </p>
          </div>
          <div className="mt-3 flex justify-between tabular-nums text-accent-200" style={{ fontSize: 28 }}>
            <span>Ban · {banBar.yes}</span>
            <span>Keep · {banBar.no}</span>
          </div>
        </div>
      )}

      {p.reveal || p.nickname ? null : showingResult && p.resultText ? (
        <p
          className="absolute font-medium text-accent-100"
          style={{ left: 96, bottom: 72, width: 1200, fontSize: 40 }}
        >
          {p.resultText}
        </p>
      ) : (
        p.instruction && (
          <p className="absolute text-accent-200" style={{ left: 96, bottom: 72, width: 1200, fontSize: 30 }}>
            {p.instruction}
          </p>
        )
      )}
    </div>
  );
}

/** Guess Who reveal: the avatar comes into focus (0.6s blur to sharp) with a glow,
 * "It was Maya", the song, then a bar per guess filling one after another, 150ms apart. */
function RevealBody({ reveal, entered }: { reveal: NonNullable<TakeoverPayload["reveal"]>; entered: boolean }) {
  const [sharp, setSharp] = useState(false);
  const [barsOn, setBarsOn] = useState(false);
  useEffect(() => {
    const a = setTimeout(() => setSharp(true), 60);
    const b = setTimeout(() => setBarsOn(true), 700);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, []);

  return (
    <>
      <div className="absolute" style={{ left: 150, top: 220, width: 420, height: 420 }}>
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: "radial-gradient(closest-side, rgb(var(--color-accent) / 0.55), transparent)",
            opacity: sharp ? 1 : 0,
            transition: "opacity 600ms ease",
          }}
        />
        <div
          className="absolute inset-0 grid place-items-center"
          style={{ filter: sharp ? "blur(0px)" : "blur(28px)", transition: "filter 600ms ease" }}
        >
          <Emoji value={reveal.emoji} size={260} />
        </div>
      </div>

      <div className="absolute" style={{ left: 640, top: 210, width: 1180 }}>
        <p className="text-accent-300 uppercase" style={{ fontSize: 30, letterSpacing: "0.4em" }}>
          The mystery pick
        </p>
        <p
          className="font-bold leading-none text-accent-100"
          style={{ marginTop: 18, fontSize: 120, opacity: entered ? 1 : 0, transition: "opacity 600ms ease 300ms" }}
        >
          It was {reveal.name}
        </p>
        <p className="text-accent-200" style={{ marginTop: 22, fontSize: 38 }}>
          {reveal.trackName} · {reveal.artistName}
        </p>
        {reveal.nobodyGuessed && (
          <p className="text-accent-300" style={{ marginTop: 14, fontSize: 30 }}>
            Nobody guessed. +1 🪙 for staying hidden.
          </p>
        )}
      </div>

      <div className="absolute flex flex-col" style={{ left: 640, top: 560, width: 1000, gap: 22 }}>
        {reveal.guesses.map((g, i) => (
          <div key={g.id} className="flex items-center gap-5">
            <Emoji value={g.emoji} size={44} />
            <p className="truncate text-accent-100" style={{ width: 210, fontSize: 32 }}>
              {g.name}
            </p>
            <div className="flex-1 overflow-hidden bg-accent-900" style={{ height: 26, borderRadius: 13 }}>
              <div
                style={{
                  height: "100%",
                  width: barsOn ? `${g.percent}%` : "0%",
                  background: g.name === reveal.name ? "rgb(var(--color-accent))" : "rgb(var(--color-accent-300))",
                  transition: `width 500ms ease ${i * 150}ms`,
                }}
              />
            </div>
            <p className="tabular-nums text-accent-200" style={{ width: 90, textAlign: "right", fontSize: 30 }}>
              {g.percent}%
            </p>
          </div>
        ))}
      </div>
    </>
  );
}

/** A new AI party nickname (5s): the guest's avatar and real name first, then the nickname they were given
 * and why. The real name always leads; the nickname never replaces it. */
function NicknameBody({ nickname, entered }: { nickname: NonNullable<TakeoverPayload["nickname"]>; entered: boolean }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center text-center" style={{ paddingBottom: 60 }}>
      <div
        className="absolute"
        style={{
          width: 640,
          height: 640,
          top: 150,
          background: "radial-gradient(closest-side, rgb(var(--color-accent) / 0.45), transparent)",
          opacity: entered ? 1 : 0,
          transition: "opacity 600ms ease",
        }}
      />
      <div style={{ transform: `scale(${entered ? 1 : 0.5})`, transition: "transform 500ms cubic-bezier(.2,.9,.3,1.2)" }}>
        <Emoji value={nickname.emoji} size={240} />
      </div>
      <p className="text-accent-200" style={{ marginTop: 18, fontSize: 44 }}>
        {nickname.name}
      </p>
      <p className="text-accent-300 uppercase" style={{ marginTop: 10, fontSize: 26, letterSpacing: "0.4em", paddingLeft: "0.4em" }}>
        <Emoji value="✨" size={26} /> is now known as
      </p>
      <p
        className="font-bold leading-none text-accent-100"
        style={{ marginTop: 22, fontSize: 104, opacity: entered ? 1 : 0, transition: "opacity 500ms ease 350ms" }}
      >
        <EmojiText text={nickname.nickname} size={96} />
      </p>
      <p className="text-accent-200" style={{ marginTop: 26, maxWidth: 1400, fontSize: 38, opacity: entered ? 1 : 0, transition: "opacity 500ms ease 700ms" }}>
        {nickname.why}
      </p>
    </div>
  );
}
