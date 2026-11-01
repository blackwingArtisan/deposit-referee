import { Suspense } from "react";
import { BookingScreen } from "@/components/deposit/booking-screen";
import { SkeletonCard } from "@/components/ui";

/** Booking ids are only known at request time, so useParams needs this Suspense boundary. */
export default function BookingPage() {
  return (
    <Suspense fallback={<SkeletonCard />}>
      <BookingScreen />
    </Suspense>
  );
}
