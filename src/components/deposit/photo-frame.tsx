/* eslint-disable @next/next/no-img-element -- photos come from an API route and have no known size */
import { ExternalLink } from "lucide-react";
import type { BookingPhoto, DamageItem } from "@/lib/deposit/types";

/** Worth-a-look items go by letter, so they can't be mistaken for numbered charges. */
export const lookLetter = (index: number) => String.fromCharCode(65 + index);

function PhotoSourceLine({ photo }: { photo: BookingPhoto }) {
  const source = photo.source;
  if (source.kind === "upload") {
    return <p className="mt-1.5 text-xs text-zinc-500" data-testid="photo-source">Uploaded by the host on {new Date(source.addedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}.</p>;
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
export function PhotoFrame({ label, photo, items = [], looks = [] }: { label: string; photo: BookingPhoto; items?: Pick<DamageItem, "description" | "box">[]; looks?: Pick<DamageItem, "description" | "box">[] }) {
  return (
    <figure className="min-w-0">
      <figcaption className="mb-1.5 text-sm font-medium text-zinc-800">{label}</figcaption>
      <div className="relative overflow-hidden rounded-lg bg-zinc-100">
        <img src={photo.src} alt={label} className="block h-auto w-full" />
        {items.map((item, i) =>
          item.box ? (
            <div
              key={i}
              data-testid="damage-box"
              role="img"
              aria-label={`Damage ${i + 1}: ${item.description}`}
              className="absolute rounded-[3px] border-[3px] border-red-600 shadow-[0_0_0_1.5px_rgba(255,255,255,0.85)]"
              style={{ left: `${item.box.x * 100}%`, top: `${item.box.y * 100}%`, width: `${item.box.w * 100}%`, height: `${item.box.h * 100}%` }}
            >
              {/* Sits above the box so it doesn't cover the damage, unless the box is at the top of the photo. */}
              <span className={`absolute left-[-3px] flex size-5 items-center justify-center bg-red-600 text-xs font-semibold text-white ${item.box.y > 0.06 ? "bottom-full" : "top-0"}`}>{i + 1}</span>
            </div>
          ) : null,
        )}
        {looks.map((look, i) =>
          look.box ? (
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
      <PhotoSourceLine photo={photo} />
    </figure>
  );
}
