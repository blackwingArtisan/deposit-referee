/**
 * PayPal's public sandbox test card (Visa). It stands in for a buyer, so sandbox orders can
 * complete with no buyer login. It is not a real card and only works on the sandbox.
 */
export const SANDBOX_TEST_CARD = {
  number: "4111111111111111",
  expiry: "2030-12",
  security_code: "123",
  billing_address: { address_line_1: "1 Main St", admin_area_2: "San Jose", admin_area_1: "CA", postal_code: "95131", country_code: "US" },
};
