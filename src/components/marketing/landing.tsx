/* eslint-disable @next/next/no-img-element -- the demo photos are small local files shown as they are */
import { ArrowRight, Bot, Check, Lock, ScanSearch, ShieldCheck, Sparkles } from "lucide-react";
import { appConfig } from "@/app.config";
import { MoneyBadge } from "../money-badge";
import { ButtonLink } from "../ui/button";
import { AppLogo } from "../shell/app-logo";

/**
 * Landing page sections. Content comes from appConfig.landing; reorder or replace freely.
 *   <SiteHeader /> <Hero /> <PainPoints /> <HowItWorks /> <Features /> <CtaBand /> <SiteFooter />
 */

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-zinc-200/70 bg-white/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <AppLogo />
        <nav className="flex items-center gap-2">
          <a href="#how" className="hidden rounded-md px-3 py-2 text-sm text-zinc-600 hover:text-zinc-900 sm:block">
            How it works
          </a>
          <ButtonLink href={appConfig.landing.primaryCta.href} size="sm">
            {appConfig.landing.primaryCta.label}
          </ButtonLink>
        </nav>
      </div>
    </header>
  );
}

/** The demo booking's real numbers: the photo pair, its red box, and who did each step. */
function DepositPreview() {
  const rows = [
    { icon: ScanSearch, title: "New damage found", sub: "Claude Sonnet 5.5 compared the photos", tone: "bg-brand-50 text-brand-600 ring-brand-200" },
    { icon: Bot, title: "Proposed $150.00 of the $300.00 hold", sub: "Claude Haiku 5.5, then it stops", tone: "bg-brand-50 text-brand-600 ring-brand-200" },
    { icon: ShieldCheck, title: "You approved the charge", sub: "Nothing moves until you do", tone: "bg-amber-50 text-amber-600 ring-amber-300", money: { v: "150.00", d: "in" as const } },
    { icon: Lock, title: "The rest went back", sub: "PayPal released the hold", tone: "bg-emerald-50 text-emerald-600 ring-emerald-200", money: { v: "150.00", d: "neutral" as const } },
  ];
  return (
    <div data-testid="deposit-preview" className="relative min-w-0 rounded-2xl border border-zinc-200 bg-white/90 p-5 shadow-2xl shadow-brand-900/10 ring-1 ring-black/5 backdrop-blur">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold text-zinc-900">Lakeside cabin</span>
        <span className="text-xs text-zinc-500">Example booking</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <figure className="min-w-0">
          <img src="/demo-photos/cabin-check-in.jpg" alt="The cabin floor at check-in, with no scratch" className="block h-auto w-full rounded-lg" />
          <figcaption className="mt-1 text-xs text-zinc-500">Check-in</figcaption>
        </figure>
        <figure className="min-w-0">
          <div className="relative overflow-hidden rounded-lg">
            <img src="/demo-photos/cabin-check-out.jpg" alt="The same floor at check-out, with a red box around a new scratch" className="block h-auto w-full" />
            <div className="absolute rounded-[3px] border-2 border-red-600 shadow-[0_0_0_1px_rgba(255,255,255,0.85)]" style={{ left: "44%", top: "59%", width: "9%", height: "29%" }} aria-hidden />
          </div>
          <figcaption className="mt-1 text-xs text-zinc-500">Check-out</figcaption>
        </figure>
      </div>
      <ol className="relative mt-4 space-y-2 before:absolute before:bottom-3 before:left-[15px] before:top-3 before:w-px before:bg-zinc-200">
        {rows.map((r) => (
          <li key={r.title} className="relative flex items-center gap-3">
            <span className={`z-10 flex size-8 shrink-0 items-center justify-center rounded-full ring-1 ${r.tone}`}>
              <r.icon className="size-4" />
            </span>
            <div className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-xl border border-zinc-100 bg-zinc-50/60 px-3 py-1.5">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-zinc-900">{r.title}</p>
                <p className="text-xs text-zinc-500">{r.sub}</p>
              </div>
              {r.money ? <MoneyBadge amount={{ currency_code: "USD", value: r.money.v }} direction={r.money.d} size="sm" /> : null}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function Hero() {
  const l = appConfig.landing;
  return (
    <section className="relative overflow-hidden">
      <div className="bg-grid absolute inset-0 [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" aria-hidden />
      <div className="absolute -top-40 left-1/2 h-[480px] w-[900px] -translate-x-1/2 rounded-full bg-brand-200/40 blur-3xl" aria-hidden />
      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-16 sm:px-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:pt-24">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-white/80 px-3 py-1 text-sm font-medium text-brand-700 shadow-sm">
            <Sparkles className="size-4" /> {l.eyebrow}
          </span>
          <h1 className="mt-6 text-4xl font-semibold leading-[1.08] tracking-tight text-zinc-950 sm:text-5xl lg:text-[56px]" data-testid="landing-headline">
            {l.headline}
          </h1>
          <p className="mt-3 text-sm text-zinc-500" data-testid="headline-sources">
            Sources:{" "}
            {l.headlineSources.map((s, i) => (
              <span key={s.href}>
                {i ? " · " : ""}
                <a href={s.href} target="_blank" rel="noreferrer" className="underline decoration-zinc-300 underline-offset-2 hover:text-zinc-800">
                  {s.label}
                </a>
              </span>
            ))}
          </p>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-zinc-600">{l.subheadline}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href={l.primaryCta.href} size="lg">
              {l.primaryCta.label} <ArrowRight className="size-4" />
            </ButtonLink>
            <ButtonLink href={l.secondaryCta.href} size="lg" variant="secondary">
              {l.secondaryCta.label}
            </ButtonLink>
          </div>
          <p className="mt-6 flex items-start gap-2 text-sm text-zinc-500" data-testid="hold-note">
            <Lock className="mt-0.5 size-4 shrink-0 text-emerald-600" /> {l.holdNote}
          </p>
        </div>
        <DepositPreview />
      </div>
    </section>
  );
}

export function HowItWorks() {
  return (
    <section id="how" className="border-y border-zinc-200/70 bg-white py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <p className="text-sm font-semibold uppercase tracking-wider text-brand">How it works</p>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950">Three steps, fully visible</h2>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {appConfig.landing.steps.map((s, i) => (
            <div key={s.title} className="relative rounded-2xl border border-zinc-200 bg-zinc-50/50 p-6">
              <span className="flex size-9 items-center justify-center rounded-full bg-brand text-sm font-semibold text-brand-foreground">{i + 1}</span>
              <h3 className="mt-4 text-lg font-semibold text-zinc-900">{s.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-zinc-600">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** The problem, from the research, each with what the app does about it and where the figure came from. */
export function PainPoints() {
  return (
    <section id="why" className="py-20" data-testid="pain-points">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <p className="text-sm font-semibold uppercase tracking-wider text-brand">Why hosts need this</p>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950">What goes wrong with a damage deposit today</h2>
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          {appConfig.landing.painPoints.map((p) => (
            <div key={p.title} className="min-w-0 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm" data-testid="pain-point">
              <h3 className="font-semibold text-zinc-900">{p.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-zinc-600">{p.body}</p>
              <p className="mt-3 flex gap-2 text-[15px] leading-relaxed text-zinc-800">
                <Check className="mt-1 size-4 shrink-0 text-brand" aria-hidden /> {p.answer}
              </p>
              <p className="mt-3 text-xs text-zinc-500">
                {p.sources.map((s, i) => (
                  <span key={s.href + s.label}>
                    {i ? " · " : ""}
                    <a href={s.href} target="_blank" rel="noreferrer" className="underline decoration-zinc-300 underline-offset-2 hover:text-zinc-800">
                      {s.label}
                    </a>
                  </span>
                ))}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Features() {
  return (
    <section className="py-20">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 sm:px-6 md:grid-cols-3">
        {appConfig.landing.features.map((f) => (
          <div key={f.title} className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <Check className="size-5 text-brand" />
            <h3 className="mt-3 font-semibold text-zinc-900">{f.title}</h3>
            <p className="mt-1.5 text-[15px] leading-relaxed text-zinc-600">{f.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function CtaBand() {
  return (
    <section className="px-4 pb-20 sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 rounded-3xl bg-gradient-to-br from-brand-700 to-brand-900 px-8 py-12 text-white shadow-xl md:flex-row md:items-center">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{appConfig.tagline}</h2>
          <p className="mt-2 text-white/75">PayPal sandbox only, so no real money moves. Try the whole thing with a test card.</p>
        </div>
        <ButtonLink href={appConfig.landing.primaryCta.href} size="lg" variant="secondary" className="border-transparent">
          {appConfig.landing.primaryCta.label} <ArrowRight className="size-4" />
        </ButtonLink>
      </div>
    </section>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-zinc-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-zinc-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <span>
          {appConfig.name} · PayPal sandbox only · MIT licensed
        </span>
        <span>Built with PayPal, Claude and Claude Code</span>
      </div>
    </footer>
  );
}
