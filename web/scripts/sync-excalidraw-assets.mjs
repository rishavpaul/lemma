// Excalidraw fetches its fonts from a CDN unless told otherwise. The desktop app runs offline, so copy them
// next to the UI and point EXCALIDRAW_ASSET_PATH at them. Xiaolai (CJK, 12MB) is skipped; it is only a fallback.
import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const src = join("node_modules", "@excalidraw", "excalidraw", "dist", "prod", "fonts");
const dst = join("public", "excalidraw-assets", "fonts");
rmSync(dst, { recursive: true, force: true });
mkdirSync(dst, { recursive: true });
for (const d of readdirSync(src)) if (d !== "Xiaolai") cpSync(join(src, d), join(dst, d), { recursive: true });
