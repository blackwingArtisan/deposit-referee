"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useState, type ReactNode } from "react";
import { Activity, ClipboardCheck, FlaskConical, LayoutDashboard, Menu, X, type LucideIcon } from "lucide-react";
import { appConfig } from "@/app.config";
import { cn } from "../ui/cn";
import { AppLogo } from "./app-logo";
import { ModeBadges } from "./mode-badges";

const ICONS: Record<string, LucideIcon> = { "/dashboard": LayoutDashboard, "/bookings": ClipboardCheck, "/example": FlaskConical, "/activity": Activity };

/** usePathname() suspends on dynamic routes, so callers wrap this in <Suspense>. */
function Nav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5">
      {appConfig.nav.map((item) => {
        const Icon = ICONS[item.href] ?? LayoutDashboard;
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition",
              active ? "bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-200" : "text-zinc-600 hover:bg-white/70 hover:text-zinc-900",
            )}
          >
            <Icon className={cn("size-4", active ? "text-brand" : "text-zinc-400")} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** App layout: sidebar on desktop, top bar + drawer on mobile. */
export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-dvh bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-zinc-200/80 bg-zinc-50/80 px-4 py-5 backdrop-blur lg:flex">
        <AppLogo href="/" className="px-2" />
        <div className="mt-8 flex-1">
          <Suspense>
            <Nav />
          </Suspense>
        </div>
        <ModeBadges vertical className="px-1" />
      </aside>

      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-zinc-200 bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
        <AppLogo href="/" />
        <button onClick={() => setOpen((o) => !o)} className="rounded-md p-2 text-zinc-600 hover:bg-zinc-100" aria-label="Menu">
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </header>
      {open ? (
        <div className="border-b border-zinc-200 bg-zinc-50 px-4 py-3 lg:hidden">
          <Suspense>
            <Nav onNavigate={() => setOpen(false)} />
          </Suspense>
          <ModeBadges className="mt-3" />
        </div>
      ) : null}

      <main className="lg:pl-64">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-10 lg:py-10">{children}</div>
      </main>
    </div>
  );
}

export function PageHeader({ title, description, actions, eyebrow }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow ? <p className="mb-1 text-sm font-medium text-brand">{eyebrow}</p> : null}
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl">{title}</h1>
        {description ? <p className="mt-2 max-w-2xl text-[15px] text-zinc-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
