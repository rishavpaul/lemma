"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Renders model-written markdown. Raw HTML is not enabled, and links open in a new tab. */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: (p) => <a {...p} target="_blank" rel="noopener noreferrer" /> }}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
