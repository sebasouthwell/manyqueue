#!/usr/bin/env node
// Operator CLI for ManyQueue rooms and guests, for scripts or by hand.
//
//   node scripts/rooms.mjs                    active rooms as JSON [{id,label,sub}] (the group's list)
//   node scripts/rooms.mjs status  <CODE>     mode, speaker, now playing, on deck, rotation order, guests
//   node scripts/rooms.mjs skip    <CODE>     skip the current song
//   node scripts/rooms.mjs pause   <CODE> | resume <CODE>
//   node scripts/rooms.mjs mode    <CODE> shared|rotation
//   node scripts/rooms.mjs end     <CODE>     end the party (same as the host's End button)
//   node scripts/rooms.mjs guests             everyone in an active party as JSON [{id:"CODE:guestId",label,sub}]
//   node scripts/rooms.mjs note    <CODE:guestId> "<message>"   leave a secret host note ("" clears it)
//   node scripts/rooms.mjs glitch  <CODE:guestId> <0-100>       glitch mode easter egg (0 = off)
//
// Reads go straight to the SQLite file, read-only. Anything that changes a room goes through the running
// server's own API as that room's host (a host_session cookie signed with COOKIE_SECRET), so the player
// loop, sockets and phones all see it at once. Never touches volume.
import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = process.env.MQ_DB ?? path.join(ROOT, "data", "manyqueue.db");
const BASE = `http://127.0.0.1:${process.env.PORT ?? 3002}`;

const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

const db = new DatabaseSync(DB_PATH, { readOnly: true });
const all = (sql, ...p) => db.prepare(sql).all(...p);
const one = (sql, ...p) => db.prepare(sql).get(...p);

function roomOrFail(code) {
  if (!/^[A-Z0-9]{3,8}$/.test(code ?? "")) fail("usage: rooms.mjs <command> <ROOM CODE>");
  const room = one("select * from rooms where code = ?", code);
  if (!room) fail(`no room ${code}`);
  return room;
}

function settingsOf(room) {
  const row = one("select json from room_settings where room_id = ?", room.id);
  return { mode: "shared", tokenMode: false, ...(row ? JSON.parse(row.json) : {}) };
}

const guestNames = (room) =>
  new Map(all("select id, nickname, emoji from guests where room_id = ?", room.id).map((g) => [g.id, `${g.emoji} ${g.nickname}`]));

function list() {
  const rooms = all("select * from rooms where status = 'active' order by created_at desc");
  const out = rooms.map((room) => {
    const s = settingsOf(room);
    const guests = one("select count(*) n from guests where room_id = ? and kicked_at is null", room.id).n;
    const playing = one("select track_name from queue_items where room_id = ? and status = 'playing'", room.id);
    const bits = [s.mode, `${guests} guest${guests === 1 ? "" : "s"}`, room.device_name ?? "no speaker"];
    if (playing) bits.push(`▶ ${playing.track_name}`);
    return { id: room.code, label: `${room.code} · ${room.name}`, sub: bits.join(" · ") };
  });
  console.log(JSON.stringify(out));
}

/** Everyone in an active party, one item per guest, id "CODE:guestId" (for picking a guest in operator tools). */
function guestList() {
  const rows = all(
    `select r.code, g.id, g.nickname, g.emoji, g.role, g.host_note note from guests g join rooms r on r.id = g.room_id
      where r.status = 'active' and g.kicked_at is null order by r.created_at desc, g.created_at`,
  );
  console.log(
    JSON.stringify(
      rows.map((g) => ({
        id: `${g.code}:${g.id}`,
        label: `${g.emoji} ${g.nickname}${g.role === "cohost" ? " ★" : ""}`,
        sub: [g.code, g.note ? "💌 note waiting" : null].filter(Boolean).join(" · "),
      })),
    ),
  );
}

function guestOrFail(item) {
  const [code, guestId] = (item ?? "").split(":");
  const room = roomOrFail(code);
  const guest = one("select id, nickname, emoji from guests where id = ? and room_id = ? and kicked_at is null", guestId ?? "", room.id);
  if (!guest) fail(`no guest ${guestId} in ${code}`);
  return { room, guest };
}

function status(code) {
  const room = roomOrFail(code);
  const s = settingsOf(room);
  const names = guestNames(room);
  const who = (id, source) => (id ? names.get(id) ?? "?" : source === "fallback" ? "🏠 house" : "?");
  const lines = [
    `${room.code} · ${room.name} · ${room.status}`,
    `mode ${s.mode}${s.tokenMode ? " · tokens on" : ""} · speaker ${room.device_name ?? "none"} · fallback ${room.fallback_playlist_uri ? "set" : "NONE"}`,
  ];
  const playing = one("select * from queue_items where room_id = ? and status = 'playing'", room.id);
  lines.push(playing ? `▶ ${playing.track_name} — ${playing.artist_name} (${who(playing.added_by, playing.source)})` : "▶ nothing of ours playing");

  const upNext = all(
    s.mode === "rotation"
      ? "select * from queue_items where room_id = ? and status in ('on_deck','locked') order by position"
      : "select * from queue_items where room_id = ? and status in ('queued','pending','locked') order by position",
    room.id,
  );
  lines.push(`${s.mode === "rotation" ? "on deck" : "queue"} (${upNext.length}):`);
  for (const [i, q] of upNext.slice(0, 10).entries()) {
    lines.push(`  ${i + 1}. ${q.track_name.slice(0, 32)} (${who(q.added_by, q.source)})${q.status === "locked" ? " 🔒" : ""}`);
  }

  if (s.mode === "rotation") {
    const roster = all("select * from rotation_state where room_id = ?", room.id);
    const mine = new Map(
      all("select added_by, count(*) n from queue_items where room_id = ? and status = 'mine' group by added_by", room.id).map((r) => [r.added_by, r.n]),
    );
    roster.sort((a, b) => b.credit - a.credit || (a.last_turn_at ?? -1) - (b.last_turn_at ?? -1) || a.joined_at - b.joined_at);
    lines.push("rotation (next first):");
    for (const r of roster) {
      const n = mine.get(r.guest_id) ?? 0;
      lines.push(`  ${names.get(r.guest_id) ?? "?"} · ${n} song${n === 1 ? "" : "s"}${r.weight !== 1 ? ` · ×${r.weight}` : ""}${r.active ? "" : " · away"}`);
    }
  }

  const guests = all(
    `select g.id, g.role, g.muted, coalesce(sum(t.delta), 0) tokens from guests g
       left join token_events t on t.guest_id = g.id
      where g.room_id = ? and g.kicked_at is null group by g.id`,
    room.id,
  );
  lines.push(
    `guests (${guests.length}): ` +
      guests.map((g) => `${names.get(g.id)}${s.tokenMode ? ` ${g.tokens}🪙` : ""}${g.role === "cohost" ? " ★" : ""}${g.muted ? " 🔇" : ""}`).join(", "),
  );
  console.log(lines.join("\n"));
}

function hostCookie(room) {
  const secret = process.env.COOKIE_SECRET;
  if (!secret) fail("COOKIE_SECRET is not set: run this with the server's environment (.env)");
  const sig = crypto.createHmac("sha256", secret).update(room.host_id).digest("base64").replace(/=+$/, "");
  return `host_session=${encodeURIComponent(`${room.host_id}.${sig}`)}`;
}

async function asHost(room, method, route, body) {
  const res = await fetch(BASE + route, {
    method,
    headers: { cookie: hostCookie(room), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }).catch((err) => fail(`server not reachable on ${BASE}: ${err.message}`));
  const text = await res.text();
  if (!res.ok) fail(`${method} ${route} → ${res.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

const [cmd, code, arg] = process.argv.slice(2);
switch (cmd ?? "list") {
  case "list":
    list();
    break;
  case "status":
    status(code);
    break;
  case "skip": {
    const r = await asHost(roomOrFail(code), "POST", `/rooms/${code}/playback/skip`);
    console.log(r.skipped ? "skipped" : "nothing of ours was playing, so nothing to skip");
    break;
  }
  case "pause":
  case "resume":
    await asHost(roomOrFail(code), "POST", `/rooms/${code}/playback/${cmd}`);
    console.log(cmd === "pause" ? "paused" : "resumed");
    break;
  case "mode": {
    if (arg !== "shared" && arg !== "rotation") fail("usage: rooms.mjs mode <CODE> shared|rotation");
    await asHost(roomOrFail(code), "PATCH", `/rooms/${code}/settings`, { mode: arg });
    console.log(`${code} is now in ${arg} mode`);
    break;
  }
  case "end":
    await asHost(roomOrFail(code), "POST", `/rooms/${code}/end`);
    console.log(`${code} ended`);
    break;
  case "guests":
    guestList();
    break;
  case "note": {
    const { room, guest } = guestOrFail(code);
    const r = await asHost(room, "PUT", `/rooms/${room.code}/guests/${guest.id}/note`, { message: arg ?? "" });
    console.log(
      r.hostNote
        ? `💌 Left for ${guest.emoji} ${guest.nickname}: they'll see it the next time they use the app.`
        : `Removed the note for ${guest.emoji} ${guest.nickname}.`,
    );
    break;
  }
  case "glitch": {
    const { room, guest } = guestOrFail(code);
    const level = Number(arg);
    if (!Number.isFinite(level) || level < 0 || level > 100) fail("usage: rooms.mjs glitch <CODE:guestId> <0-100>");
    const r = await asHost(room, "PUT", `/rooms/${room.code}/guests/${guest.id}/glitch`, { level });
    console.log(r.level ? `🌀 ${guest.emoji} ${guest.nickname} is glitching at ${r.level}. It starts faint and creeps up.` : `${guest.emoji} ${guest.nickname} is back to normal.`);
    break;
  }
  case "help":
    console.log(
      "list | status <CODE> | skip <CODE> | pause <CODE> | resume <CODE> | mode <CODE> shared|rotation | end <CODE> | guests | note <CODE:guestId> <message>",
    );
    break;
  default:
    fail(`unknown command ${cmd}: list | status | skip | pause | resume | mode | end | guests | note`);
}
