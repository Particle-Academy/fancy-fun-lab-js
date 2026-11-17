/**
 * The two string transforms laravel-fun-lab borrows from Laravel's `Str`, as
 * the shared `fun-lab/strings` table pins them.
 *
 * An entity set up under "First Login" in one runtime must be found under the
 * same slug in another, or a shared catalog splits in two. So these reproduce
 * Laravel's output, including the parts that surprise: `headline("Combat XP")`
 * is "Combat Xp", and a value in a non-Latin script slugs to "" (Laravel's
 * default "en" transliteration drops it).
 */

/** Letters that NFKD does not decompose into ASCII, folded the way Laravel's ascii() does. */
const FOLD: Record<string, string> = {
  ß: "ss",
  ẞ: "SS",
  æ: "ae",
  Æ: "AE",
  ø: "o",
  Ø: "O",
  œ: "oe",
  Œ: "OE",
  đ: "d",
  Đ: "D",
  ð: "d",
  Ð: "D",
  ł: "l",
  Ł: "L",
  þ: "th",
  Þ: "TH",
  ı: "i",
};

/** Laravel `Str::ascii($value, 'en')`, for the Latin range: fold, strip marks, drop the rest. */
export function ascii(value: string): string {
  let out = "";
  for (const ch of value) out += FOLD[ch] ?? ch;
  return out
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^\x00-\x7F]/g, "");
}

/**
 * Laravel `Str::slug($value)`: ASCII-fold, turn underscores into the
 * separator, spell "@" as "at", drop everything that is not a letter, digit,
 * separator or whitespace, collapse runs and trim.
 */
export function slug(value: string, separator = "-"): string {
  let title = ascii(value);
  const flip = separator === "-" ? "_" : "-";
  title = title.split(flip).join(separator).replace(new RegExp(`${escape(separator)}+`, "g"), separator);
  // The flip above already collapsed runs of the flipped character; Laravel
  // replaces `[flip]+` with one separator, which this matches.
  title = title.split("@").join(`${separator}at${separator}`);
  title = title.toLowerCase().replace(new RegExp(`[^${escape(separator)}\\p{L}\\p{N}\\s]+`, "gu"), "");
  title = title.replace(new RegExp(`[${escape(separator)}\\s]+`, "gu"), separator);
  return trimChar(title, separator);
}

/**
 * Laravel `Str::headline($value)`: split a multi-word value on spaces, a single
 * word on its uppercase letters; title-case each piece; split again on "-",
 * "_" and " "; join the non-empty words with one space.
 */
export function headline(value: string): string {
  let parts = value.split(" ");
  parts =
    parts.length > 1
      ? parts.map(title)
      : ucsplit(parts.join("_")).map(title);
  const collapsed = parts.join("_").replace(/[-_ ]/g, "_");
  // PHP's array_filter drops "" and also "0".
  return collapsed
    .split("_")
    .filter((w) => w !== "" && w !== "0")
    .join(" ");
}

/** `mb_convert_case($v, MB_CASE_TITLE)`: upper after a non-cased character, lower inside a word. */
export function title(value: string): string {
  let out = "";
  let inWord = false;
  for (const ch of value) {
    if (/[\p{Lu}\p{Ll}\p{Lt}]/u.test(ch)) {
      out += inWord ? ch.toLowerCase() : ch.toUpperCase();
      inWord = true;
    } else {
      out += ch;
      inWord = inWord && /[\p{Mn}\p{Me}\p{Cf}\p{Lm}\p{Sk}'.:^`·’]/u.test(ch);
    }
  }
  return out;
}

/** Laravel `Str::ucsplit`: split before every uppercase letter, dropping empty pieces. */
function ucsplit(value: string): string[] {
  return value.split(/(?=\p{Lu})/u).filter((p) => p !== "");
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
}

function trimChar(s: string, ch: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && s.startsWith(ch, start)) start += ch.length;
  while (end > start && s.endsWith(ch, end)) end -= ch.length;
  return s.slice(start, end);
}
