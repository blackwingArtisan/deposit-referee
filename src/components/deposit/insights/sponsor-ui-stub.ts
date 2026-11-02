/**
 * Stands in for the sponsor's packages when NEXT_PUBLIC_SPONSOR_UI isn't "1". A conditional alone
 * leaves their chunk in .next/static, so next.config.ts points the imports here and nothing of
 * theirs is built. The page never renders these: with the switch off it shows the plain grid.
 */
export const AgStudio = () => null;
export const AgStudioProvider = () => null;
