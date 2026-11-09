/* eslint-disable @next/next/no-img-element -- photos come from an API route and have no known size */
import { ExternalLink } from "lucide-react";
import type { BookingPhoto, DamageItem, FindingPhoto } from "@/lib/deposit/types";

/** The renter's own photos, as each screen labels them. */
export const RENTER_SLOTS = [
  { slot: "check_in", label: "Renter's check-in photo" },
  { slot: "check_out", label: "Renter's check-out photo" },
] as const;

/** Where a finding was seen, in words: every finding names its source photo. */
export const findingPhotoLabel = (photo?: FindingPhoto) => (photo === "renter_check_out" ? "the renter's own check-out photo" : "the host's check-out photo");

/** Worth-a-look items go by letter, so they can't be mistaken for numbered charges. */
export const lookLetter = (index: number) => String.fromCharCode(65 + index);

function PhotoSourceLine({ photo }: { photo: BookingPhoto }) {
  const source = photo.source;
  if (source.kind === "upload") {
    return <p className="mt-1.5 text-xs text-zinc-500" data-testid="photo-source">Uploaded by the {source.by ?? "host"} on {new Date(source.addedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}.</p>;
  }
  return (
    <p className="mt-1.5 text-xs leading-relaxed text-zinc-500" data-testid="photo-source">
      Demo photo: based on{" "}
      <a href={source.pageUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline underline-offset-2 hover:text-zinc-800">
        {source.title}
        <ExternalLink className="size-3" aria-hidden />
      </a>{" "}
      by {source.author}, {source.licence}. {source.note}
    </p>
  );
}

/** A photo, its source, the AI's red boxes and its amber worth-a-look boxes. Box positions are fractions, so they scale with the photo. */
/** `on` is which check-out photo this is; only boxes drawn on it show. Numbering stays the list's. */
/** An item with `dropped` set was taken off the charge by Claude's second look: its box shows grey, with why. */
type BoxItem = Pick<DamageItem, "description" | "box" | "photo"> & { dropped?: string; number?: number };

/** `credit` false leaves out the photo's source line, for a repeat of a photo whose source shows elsewhere on the page. */
export function PhotoFrame({ label, photo, items = [], looks = [], on = "check_out", credit = true }: { label: string; photo: BookingPhoto; items?: BoxItem[]; looks?: Pick<DamageItem, "description" | "box" | "photo">[]; on?: FindingPhoto; credit?: boolean }) {
  const here = (item: Pick<DamageItem, "photo">) => (item.photo ?? "check_out") === on;
  return (
    <figure className="min-w-0">
      <figcaption className="mb-1.5 text-sm font-medium text-zinc-800">{label}</figcaption>
      <div className="relative overflow-hidden rounded-lg bg-zinc-100">
        <img src={photo.src} alt={label} className="block h-auto w-full" />
        {items.map((item, i) =>
          item.box && here(item) ? (
            <div
              key={i}
              data-testid="damage-box"
              data-state={item.dropped ? "dropped" : "charged"}
              role="img"
              aria-label={`Damage ${item.number ?? i + 1}: ${item.description}${item.dropped ? `. Not charged: ${item.dropped}` : ""}`}
              className={`absolute rounded-[3px] border-[3px] shadow-[0_0_0_1.5px_rgba(255,255,255,0.85)] transition-colors duration-700 ${item.dropped ? "border-zinc-400 bg-zinc-200/30" : "border-red-600"}`}
              style={{ left: `${item.box.x * 100}%`, top: `${item.box.y * 100}%`, width: `${item.box.w * 100}%`, height: `${item.box.h * 100}%` }}
            >
              {/* Sits above the box so it doesn't cover the damage, unless the box is at the top of the photo. */}
              <span className={`absolute left-[-3px] flex h-5 min-w-5 items-center justify-center whitespace-nowrap px-1 text-xs font-semibold transition-colors duration-700 ${item.dropped ? "bg-zinc-500 text-white" : "bg-red-600 text-white"} ${item.box.y > 0.06 ? "bottom-full" : "top-0"}`}>
                {item.number ?? i + 1}
                {item.dropped ? <span className="ml-1 font-medium" data-testid="damage-box-dropped">{item.dropped}</span> : null}
              </span>
            </div>
          ) : null,
        )}
        {looks.map((look, i) =>
          look.box && here(look) ? (
            <div
              key={i}
              data-testid="look-box"
              role="img"
              aria-label={`Worth a look ${lookLetter(i)}: ${look.description}`}
              className="absolute rounded-[3px] border-[3px] border-dashed border-amber-400 shadow-[0_0_0_1.5px_rgba(0,0,0,0.45)]"
              style={{ left: `${look.box.x * 100}%`, top: `${look.box.y * 100}%`, width: `${look.box.w * 100}%`, height: `${look.box.h * 100}%` }}
            >
              <span className={`absolute left-[-3px] flex size-5 items-center justify-center bg-amber-400 text-xs font-semibold text-amber-950 ${look.box.y > 0.06 ? "bottom-full" : "top-0"}`}>{lookLetter(i)}</span>
            </div>
          ) : null,
        )}
      </div>
      {credit ? <PhotoSourceLine photo={photo} /> : null}
    </figure>
  );
}
