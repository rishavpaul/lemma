import { Suspense } from "react";
import { KnowledgeView } from "@/components/knowledge/knowledge-view";

// The article id is a query parameter (/knowledge/?id=3) so the app can be exported as static files.
export default function Page() {
  return <Suspense><KnowledgeView /></Suspense>;
}
