import Link from "next/link";
import { appConfig } from "@/app.config";
import { cn } from "../ui/cn";

export function AppLogo({ className, href = "/" }: { className?: string; href?: string }) {
  return (
    <Link href={href} className={cn("flex items-center gap-2.5 font-semibold tracking-tight text-zinc-900", className)}>
      <span className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-700 text-sm font-bold text-brand-foreground shadow-sm ring-1 ring-black/5">
        {appConfig.name.charAt(0)}
      </span>
      <span className="text-[15px]">{appConfig.name}</span>
    </Link>
  );
}
