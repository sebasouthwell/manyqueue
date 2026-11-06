/** Holiday modes: decorations on the phones and the TV, by date ("auto") or forced by the host. */
export type Holiday = "halloween" | "christmas";
export type HolidayMode = "auto" | "off" | Holiday;

/** Which holiday is on: the host's pick, or by the date for "auto" (Halloween from 15 Oct to 1 Nov,
 * Christmas from 1 to 26 Dec). */
export function activeHoliday(mode: HolidayMode, date: Date): Holiday | null {
  if (mode === "off") return null;
  if (mode !== "auto") return mode;
  const m = date.getMonth();
  const d = date.getDate();
  if ((m === 9 && d >= 15) || (m === 10 && d === 1)) return "halloween";
  if (m === 11 && d <= 26) return "christmas";
  return null;
}

const CHRISTMAS_WORDS =
  /\b(christmas|xmas|x-mas|santa|sleigh|jingle|noel|nowell|navidad|mistletoe|reindeer|rudolph|frosty|snowman|winter wonderland|let it snow|silent night|holy night|deck the halls|joy to the world|little drummer|feliz navidad|merry|yule|carol|o come all ye|hark the herald|white christmas|blue christmas|last christmas|happy xmas|silver bells|jingle bell)\b/i;

/** A Christmas song, by its title (and album name when there is one). */
export function isChristmasSong(trackName: string, albumName?: string | null): boolean {
  return CHRISTMAS_WORDS.test(trackName) || (!!albumName && /\b(christmas|xmas|holiday)\b/i.test(albumName));
}

const SPOOKY_WORDS =
  /\b(halloween|spooky|spook|ghosts?|ghostbusters|ghouls?|monsters?|monster mash|zombies?|thriller|witch(es|y)?|vampires?|werewolf|haunted|haunting|scream|skeletons?|devil|demons?|creep(y|ing)?|nightmares?|graveyard|graves?|coffin|pumpkin|boo|evil|horror|fright|bloody|black magic|spellbound|put a spell|hocus pocus|superstition|highway to hell|bark at the moon|somebody's watching me|this is halloween|disturbia|psycho|killer|murder|undead|bats?|full moon|moonlight shadow)\b/i;
const LOVE_WORDS =
  /\b(love|lovers?|loving|lovely|valentine|hearts?|kiss(es|ing)?|crush|darling|sweetheart|romance|romantic|amor|amour|te amo|te quiero|be mine|i will always|my girl|cupid|lovesong|love song)\b/i;

export function isSpookySong(trackName: string): boolean {
  return SPOOKY_WORDS.test(trackName);
}

export function isLoveSong(trackName: string): boolean {
  return LOVE_WORDS.test(trackName);
}

/** What a song's album cover wears, if anything: October's spooky songs a witch's hat or devil horns
 * (the same pick for a song every time), Christmas songs in November and December the Santa hat,
 * February's love songs Cupid's bow. A forced holiday mode applies all year; "off" never decorates. */
export type CoverDecor = "santa" | "witch" | "horns" | "cupid";
export function coverDecorFor(mode: HolidayMode, date: Date, trackName: string | null | undefined, albumName?: string | null): CoverDecor | null {
  if (!trackName || mode === "off") return null;
  const m = date.getMonth();
  const spooky = () => {
    if (!isSpookySong(trackName)) return null;
    let h = 0;
    for (const c of trackName) h = (h * 31 + c.charCodeAt(0)) | 0;
    return (h & 1) === 0 ? "witch" : "horns";
  };
  if (mode === "halloween") return spooky();
  if (mode === "christmas") return isChristmasSong(trackName, albumName) ? "santa" : null;
  if (m === 9) return spooky();
  if (m === 10 || m === 11) return isChristmasSong(trackName, albumName) ? "santa" : null;
  if (m === 1) return isLoveSong(trackName) ? "cupid" : null;
  return null;
}

/** The one. */
export function isAllIWantForChristmas(trackName: string, artistName: string): boolean {
  return /all i want for christmas is you/i.test(trackName) && /mariah/i.test(artistName);
}

/** November: she's defrosting, but it's not December yet. */
export function isDefrostSeason(date: Date): boolean {
  return date.getMonth() === 10;
}
