/* eslint-disable @next/next/no-img-element -- photos come from an API route and have no known size */
import type { HTMLAttributes, ReactNode } from "react";
import type { BookingPhoto, DamageBox } from "@/lib/deposit/types";

/**
 * The square of a photo around one mark, as fractions of the photo: zoomed so the mark fills about
 * 40% of the tile, kept inside the photo. Same fraction both ways, so a 4:3 photo stays 4:3.
 */
export function cropAround(box: DamageBox): {
  x: number;
  y: number;
  size: number;
} {
  const size = Math.min(1, Math.max(0.28, Math.max(box.w, box.h) * 2.4));
  const clamp = (v: number) => Math.min(1 - size, Math.max(0, v));
  return {
    x: clamp(box.x + box.w / 2 - size / 2),
    y: clamp(box.y + box.h / 2 - size / 2),
    size,
  };
}

/**
 * A cropped thumbnail of one mark: the part of the check-out photo around it, with its box drawn
 * on. A dropped line's box is grey with a short tag. The box is the same `damage-box` the full
 * photo draws, so it is found the same way.
 */
export function MarkThumb({
  photo,
  box,
  number,
  description,
  dropped,
  label = "Host's check-out",
  caption,
}: {
  photo: BookingPhoto;
  box: DamageBox;
  number: number;
  description: string;
  dropped?: string;
  label?: string;
  caption?: string;
}) {
  const crop = cropAround(box);
  return (
    <figure className="min-w-0">
      <div
        className="relative aspect-[4/3] w-full overflow-hidden rounded-lg bg-zinc-100"
        data-testid="mark-thumb"
      >
        {/* The photo at 1/size of the tile, moved so the crop's corner sits at the tile's corner. */}
        <div
          className="absolute left-0 top-0"
          style={{
            width: `${100 / crop.size}%`,
            transform: `translate(${-crop.x * 100}%, ${-crop.y * 100}%)`,
          }}
        >
          <img src={photo.src} alt={label} className="block h-auto w-full" />
          <div
            data-testid="damage-box"
            data-state={dropped ? "dropped" : "charged"}
            role="img"
            aria-label={`Damage ${number}: ${description}${dropped ? `. Not charged: ${dropped}` : ""}`}
            className={`absolute rounded-[3px] border-[3px] shadow-[0_0_0_1.5px_rgba(255,255,255,0.85)] transition-colors duration-700 ${dropped ? "border-zinc-400 bg-zinc-200/30" : "border-red-600"}`}
            style={{
              left: `${box.x * 100}%`,
              top: `${box.y * 100}%`,
              width: `${box.w * 100}%`,
              height: `${box.h * 100}%`,
            }}
          />
        </div>
        <span
          className={`absolute left-1.5 top-1.5 flex h-6 min-w-6 items-center justify-center rounded px-1.5 text-sm font-semibold text-white transition-colors duration-700 ${dropped ? "bg-zinc-500" : "bg-red-600"}`}
        >
          {number}
        </span>
      </div>
      {dropped ? (
        <figcaption
          className="mt-1 text-sm font-medium text-zinc-600"
          data-testid="damage-box-dropped"
        >
          {dropped}
        </figcaption>
      ) : caption ? (
        <figcaption className="mt-1 text-sm text-zinc-600">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

/** A whole photo as a tile, for the renter's evidence beside the mark. Opens full size. */
export function PhotoTile({
  photo,
  label,
}: {
  photo: BookingPhoto;
  label: string;
}) {
  return (
    <figure className="min-w-0">
      <a
        href={photo.src}
        target="_blank"
        rel="noreferrer"
        className="block aspect-[4/3] w-full overflow-hidden rounded-lg bg-zinc-100"
        data-testid="photo-tile"
      >
        <img
          src={photo.src}
          alt={label}
          className="h-full w-full object-contain"
        />
      </a>
      <figcaption className="mt-1 text-sm text-zinc-600">{label}</figcaption>
    </figure>
  );
}

/** A tile for a line with no box: one the host added by hand. */
export function NoMarkTile({ number }: { number: number }) {
  return (
    <div
      className="flex aspect-[4/3] w-full items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-zinc-50 text-sm text-zinc-500"
      data-testid="mark-thumb-none"
    >
      <span className="mr-1.5 flex h-6 min-w-6 items-center justify-center rounded bg-zinc-500 px-1.5 font-semibold text-white">
        {number}
      </span>
      No photo box
    </div>
  );
}

const RING = {
  plain: "border-zinc-200/80 bg-white",
  flagged: "border-amber-300 bg-amber-50/60",
  dropped: "border-zinc-200/80 bg-zinc-50/60",
  lowered: "border-sky-200 bg-sky-50/30",
} as const;

/**
 * One money line as a card, the same on the host's proposal, the second look and the renter's page:
 * the mark, a title, one line of reason, chips (price row, verdict), the amount on the right, and
 * anything else (an input, the host's choice) underneath. `wide` gives the picture column room for
 * two tiles.
 */
export function LineCard({
  thumb,
  title,
  reason,
  chips,
  aside,
  tone = "plain",
  wide = false,
  children,
  ...rest
}: {
  thumb: ReactNode;
  title: ReactNode;
  reason?: ReactNode;
  chips?: ReactNode;
  aside?: ReactNode;
  tone?: keyof typeof RING;
  wide?: boolean;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, "title">) {
  return (
    <div
      className={`overflow-hidden rounded-xl border ${RING[tone]}`}
      {...rest}
    >
      {/* Phone: the picture beside the title, then chips and amount full width. Wider: picture | words and chips | amount. */}
      <div
        className={`grid gap-x-3 gap-y-2 p-3 sm:gap-x-4 sm:p-4 ${wide ? "grid-cols-1 sm:grid-cols-[16rem_minmax(0,1fr)_auto]" : "grid-cols-[6rem_minmax(0,1fr)] sm:grid-cols-[9rem_minmax(0,1fr)_auto]"}`}
      >
        <div className="min-w-0 sm:row-span-2">{thumb}</div>
        <div
          className={`min-w-0 space-y-1 ${wide ? "" : "self-center sm:self-start"}`}
        >
          <p className="line-clamp-2 text-[15px] font-medium leading-snug text-zinc-900">
            {title}
          </p>
          {reason ? (
            <p
              className="line-clamp-1 text-sm text-zinc-600"
              data-testid="line-reason"
            >
              {reason}
            </p>
          ) : null}
        </div>
        {chips ? (
          <div
            className={`flex min-w-0 flex-wrap items-center gap-1.5 ${wide ? "" : "col-span-2"} sm:col-span-1 sm:col-start-2`}
          >
            {chips}
          </div>
        ) : null}
        {aside ? (
          <div
            className={`${wide ? "" : "col-span-2"} sm:col-span-1 sm:col-start-3 sm:row-span-2 sm:row-start-1 sm:text-right`}
          >
            {aside}
          </div>
        ) : null}
      </div>
      {children ? (
        <div className="border-t border-zinc-200/70 px-3 py-3 sm:px-4">
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** The first sentence of a description, for a card's title; the rest, for its one line of reason. */
export function splitDescription(description: string): {
  title: string;
  rest?: string;
} {
  const [title, ...rest] = description.split(/(?<=\.)\s/);
  return { title: title.trim(), rest: rest.join(" ").trim() || undefined };
}
