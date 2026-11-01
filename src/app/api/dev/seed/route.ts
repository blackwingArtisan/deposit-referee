import { route } from "@/lib/http";
import { seedDemoData } from "@/lib/demo/seed";

/** Mock mode only: load realistic demo data (same as `npm run seed`). */
export const POST = route(async () => seedDemoData(), { mockOnly: true });
