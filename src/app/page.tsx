import { BlindTest, CtaBand, Features, Hero, HowItWorks, HowThisDiffers, PainPoints, SiteFooter, SiteHeader } from "@/components/marketing/landing";

export default function LandingPage() {
  return (
    <>
      <SiteHeader />
      <main>
        <Hero />
        <PainPoints />
        <HowItWorks />
        <BlindTest />
        <HowThisDiffers />
        <Features />
        <CtaBand />
      </main>
      <SiteFooter />
    </>
  );
}
