"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { ProblemWorkspace } from "@/components/code/problem-workspace";

function Inner() {
  const sp = useSearchParams();
  const slug = sp.get("slug");
  const attempt = Number(sp.get("attempt")) || null;
  if (!slug) return <p className="p-6 text-sm text-muted-foreground">No problem selected.</p>;
  return <ProblemWorkspace key={slug} slug={slug} attemptParam={attempt} />;
}

export default function ProblemPage() {
  return <Suspense fallback={<div className="p-6"><Skeleton className="h-96 w-full" /></div>}><Inner /></Suspense>;
}
