"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "./cn";

/** Accessible modal on the native <dialog> element (focus trap + Escape handled by the browser). */
export function Modal({ open, onClose, title, description, children, footer, className }: { open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; children?: ReactNode; footer?: ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        "m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-zinc-200 bg-white p-0 text-zinc-900 shadow-2xl backdrop:bg-zinc-950/40 backdrop:backdrop-blur-[2px] open:animate-slide-up",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4 px-6 pt-5">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          {description ? <p className="mt-1 text-sm text-zinc-500">{description}</p> : null}
        </div>
        <button onClick={onClose} className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600" aria-label="Close">
          <X className="size-5" />
        </button>
      </div>
      <div className="px-6 py-4">{children}</div>
      {footer ? <div className="flex justify-end gap-2 border-t border-zinc-100 bg-zinc-50/60 px-6 py-3">{footer}</div> : null}
    </dialog>
  );
}
