/**
 * Serves the built client under the base path.
 *
 * `/assets/*` are content-hashed files: served immutable when they exist, a 404 when they do not.
 * Answering a missing one with the page (a 200) makes a stale page load HTML as a script and hides
 * the real error. Every other path is the single-page app's entry, never cached, framed by nothing.
 */
import { existsSync, statSync } from "node:fs";
import { join, normalize, sep } from "node:path";

/** Framing is for this origin's own pages only; nothing is cached that names a person. */
export const PAGE_HEADERS = {
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
};

export function createClientServer(clientDir: string) {
  const assetsRoot = join(normalize(clientDir), "assets") + sep;
  return function serveClient(_request: Request, path: string): Response {
    if (path === "/assets" || path.startsWith("/assets/")) {
      const file = normalize(join(clientDir, path));
      if (!file.startsWith(assetsRoot) || !existsSync(file) || !statSync(file).isFile()) {
        return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
      }
      return new Response(Bun.file(file), {
        headers: { "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" },
      });
    }
    const index = join(clientDir, "index.html");
    if (!existsSync(index)) return new Response("The client has not been built.", { status: 503 });
    return new Response(Bun.file(index), {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...PAGE_HEADERS },
    });
  };
}
