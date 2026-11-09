/**
 * The voiceover script the demo writes beside its take (videos/voiceover.json). Each shot offers
 * its line long first, then shorter; the first one that can be said before the next shot's line
 * starts is kept. A line that doesn't fit is trimmed, never the shot. Shared by the demo and its
 * unit test.
 */

/** Speaking pace the narration is laid at. */
export const WORDS_PER_SECOND = 2.6;
/** A breath between one line and the next. */
const GAP_S = 0.3;

export interface VoiceLine {
  shot: number;
  /** Seconds into the edited video, by the demo's clock. */
  at: number;
  /** The line, longest first. */
  lines: string[];
}

export interface FittedLine {
  shot: number;
  at: number;
  text: string;
  words: number;
  /** Seconds until the next line (or the end). */
  room: number;
  fits: boolean;
}

/** Words as spoken: an amount like "$300" or "$150" takes about three words, cents two more. */
export function spokenWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).reduce((sum, word) => {
    const amount = word.match(/^\$[\d,]+(?:\.(\d\d))?/);
    if (!amount) return sum + 1;
    return sum + 3 + (amount[1] && amount[1] !== "00" ? 2 : 0);
  }, 0);
}

export function fitVoiceover(voice: VoiceLine[], endAt: number): FittedLine[] {
  const sorted = [...voice].sort((a, b) => a.at - b.at);
  return sorted.map((line, i) => {
    const room = (sorted[i + 1]?.at ?? endAt) - line.at - GAP_S;
    const fitting = line.lines.find((text) => spokenWords(text) / WORDS_PER_SECOND <= room);
    const text = fitting ?? line.lines.at(-1)!;
    return { shot: line.shot, at: line.at, text, words: spokenWords(text), room, fits: !!fitting };
  });
}
