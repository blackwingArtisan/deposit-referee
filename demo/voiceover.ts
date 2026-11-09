/**
 * The voiceover script the demo writes beside its take (videos/voiceover.json). Each shot offers
 * its line long first, then shorter; the first one that can be said before the next shot's line
 * starts is kept. A line that doesn't fit is trimmed, never the shot. Shared by the demo and its
 * unit test.
 */

/** Pace the narration and the captions are laid at: 15 characters a second, a subtitle's reading speed. */
export const CHARS_PER_SECOND = 15;
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
  chars: number;
  /** Seconds until the next line (or the end). */
  room: number;
  fits: boolean;
}

/**
 * Characters as spoken: an amount like "$300" is said as about 20 characters ("three hundred
 * dollars"), its cents 10 more.
 */
export function spokenChars(text: string): number {
  return text.replace(/\$[\d,]+(?:\.(\d\d))?/g, (_, cents?: string) => "x".repeat(20 + (cents && cents !== "00" ? 10 : 0))).length;
}

/** Seconds a line needs at 15 characters a second. */
export const secondsFor = (text: string) => spokenChars(text) / CHARS_PER_SECOND;

export function fitVoiceover(voice: VoiceLine[], endAt: number): FittedLine[] {
  const sorted = [...voice].sort((a, b) => a.at - b.at);
  return sorted.map((line, i) => {
    const room = (sorted[i + 1]?.at ?? endAt) - line.at - GAP_S;
    const fitting = line.lines.find((text) => secondsFor(text) <= room);
    const text = fitting ?? line.lines.at(-1)!;
    return { shot: line.shot, at: line.at, text, chars: spokenChars(text), room, fits: !!fitting };
  });
}
