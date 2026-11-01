import { CtaBand, Features, Hero, HowItWorks, SiteFooter, SiteHeader } from "@/components/marketing/landing";

export default function LandingPage() {
  return (
    <>
      <SiteHeader />
      <main>
        <Hero />
        <HowItWorks />
        <Features />
        <CtaBand />
      </main>
      <SiteFooter />
    </>
  );
}
