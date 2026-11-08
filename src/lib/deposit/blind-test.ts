/**
 * The blind test of the photo comparison, on the real API, before this build was frozen: 10 new
 * pairs made from CC0 photos of real rooms with digitally added marks, plus the 3 obvious-damage
 * pairs and the demo pair. Its 14 saved answers are replayed through today's code in
 * tests/unit/fair-charge.test.ts. Safe to show in the browser.
 */
export const BLIND_TEST = {
  pairs: 10,
  falseCharges: 0,
  rows: [
    { group: "No new damage", pairs: 5, outcome: "0 charged, 0 flagged" },
    { group: "One new mark", pairs: 5, outcome: "3 charged, 1 Worth a look, 1 missed (a crack across a floor tile)" },
    { group: "Obvious damage, and the demo pair", pairs: 4, outcome: "4 charged" },
  ],
  caveat: "A small sample, and both photos in each test pair come from one capture, so real photos may do worse. Check the photos yourself, and add anything the AI missed.",
} as const;
