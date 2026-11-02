import { Suspense } from "react";
import { RenterScreen } from "@/components/deposit/renter-screen";
import { SkeletonCard } from "@/components/ui";

/** The token is only known at request time, so useParams needs this Suspense boundary. */
export default function RenterPage() {
  return (
    <Suspense fallback={<SkeletonCard />}>
      <RenterScreen />
    </Suspense>
  );
}
