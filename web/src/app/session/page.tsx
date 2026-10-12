import { Suspense } from "react";
import { SessionRunner } from "@/components/session/session-runner";

export default function Page() {
  return <Suspense><SessionRunner /></Suspense>;
}
