/**
 * APP-OWNED: this app's own records. Called by `npm run seed`, `npm run seed:sandbox` and the
 * "Load demo data" button after the PayPal demo data.
 */
import { seedSampleBookings } from "@/lib/deposit/sample-bookings";
import { getPayPal } from "../paypal";

export async function seedAppData(manifest: Record<string, string> = {}, save?: () => void): Promise<void> {
  await seedSampleBookings(getPayPal(), manifest, save);
}
