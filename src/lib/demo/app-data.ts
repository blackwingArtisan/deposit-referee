/**
 * APP-OWNED: seed your app's own records (customers, listings, jobs...) here.
 * Called by `npm run seed` and the "Load demo data" button after the PayPal demo data.
 *
 *   import { collection } from "@/lib/store/collection";
 *   export async function seedAppData() {
 *     collection<Customer>("customers").replaceAll([{ id: "c_1", name: "Maya Chen", email: "maya.chen@example.com" }]);
 *   }
 */
export async function seedAppData(): Promise<void> {
  // The kit itself has no app records.
}
