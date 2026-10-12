import { Suspense } from "react";
import { ReportView } from "@/components/report/report-view";

// The id is a query parameter (/report/?id=3) so the app can be exported as static files.
export default function Page() {
  return <Suspense><ReportView /></Suspense>;
}
