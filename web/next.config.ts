import type { NextConfig } from "next";

// The FastAPI backend (grading, Whisper, SQLite) stays as-is; the browser only talks to Next in dev.
const API_ORIGIN = process.env.API_ORIGIN ?? "http://127.0.0.1:8765";
// STATIC_EXPORT=1 builds plain files into out/, which the Python API serves itself (the desktop app).
const EXPORT = process.env.STATIC_EXPORT === "1";

// NEXT_DIST_DIR lets a second instance (tests) build somewhere else without clobbering the live build.
const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  ...(EXPORT
    ? { output: "export", trailingSlash: true, images: { unoptimized: true } }
    : { async rewrites() { return [{ source: "/api/:path*", destination: `${API_ORIGIN}/api/:path*` }]; } }),
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
