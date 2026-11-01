import type { Metadata } from "next";
import type { CSSProperties } from "react";
import localFont from "next/font/local";
import { appConfig } from "@/app.config";
import { Providers } from "@/components/kit/providers";
import "./globals.css";

// Local font files: builds work offline and never wait on Google Fonts.
const geistSans = localFont({ src: "./fonts/geist-latin.woff2", variable: "--font-geist-sans", weight: "100 900", display: "swap" });
const geistMono = localFont({ src: "./fonts/geist-mono-latin.woff2", variable: "--font-geist-mono", weight: "100 900", display: "swap" });

export const metadata: Metadata = {
  title: { default: appConfig.name, template: `%s · ${appConfig.name}` },
  description: appConfig.description,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  // The single brand colour (app.config.ts) drives every shade in globals.css.
  const brand = { "--brand": appConfig.brandColor, "--brand-foreground": appConfig.brandForeground } as CSSProperties;
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`} style={brand}>
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
