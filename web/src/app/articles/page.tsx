import { Suspense } from "react";
import { ArticlesView } from "@/components/articles/articles-view";

// The article id is a query parameter (/articles/?id=3) so the app can be exported as static files.
export default function Page() {
  return <Suspense><ArticlesView /></Suspense>;
}
