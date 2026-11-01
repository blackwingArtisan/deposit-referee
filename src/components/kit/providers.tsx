"use client";

import type { ReactNode } from "react";
import { CaptionProvider } from "../caption";
import { ToastProvider } from "../toast";
import { KitProvider } from "./kit-provider";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <KitProvider>
      <ToastProvider>
        <CaptionProvider>{children}</CaptionProvider>
      </ToastProvider>
    </KitProvider>
  );
}
