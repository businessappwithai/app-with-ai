/**
 * The joints every spec shares: the model's facts, signing in, an API client
 * with its own session, and an error watcher.
 *
 * The API client is how a spec finds its subject (a record with lines, a record
 * in a state with a way out) and how it reads back what a click did. It never
 * stands in for the screen: what a person sees is always read from the page.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type APIRequestContext, expect, type Page, request } from "@playwright/test";
import type { FactEntity, Facts } from "../facts";

export const APP_URL = process.env.E2E_APP_URL ?? "http://127.0.0.1:4000";
export const API_URL = process.env.E2E_API_URL ?? "http://127.0.0.1:4001";
export const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@admin.com";
export const PASSWORD = process.env.E2E_APP_PASSWORD ?? "admin123";

export const facts: Facts = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", ".facts", "facts.json"), "utf8")
);

export const topLevel = facts.entities.filter((e) => !e.parent);
export const entityByName = new Map(facts.entities.map((e) => [e.name, e]));

/** The front end's route for an entity: `INVOICE_LINE` → `/invoice-line`. */
export function routeOf(entity: FactEntity): string {
  return `/${entity.apiSegment.replace(/_/g, "-")}`;
}

/** Sign in through the form and wait until the application is past it. */
export async function signIn(page: Page, email = ADMIN_EMAIL, password = PASSWORD): Promise<void> {
  // The application limits sign-ins per client (30 a minute by default) and
  // every test shares one address: a 429 is waited out, not reported.
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto(`${APP_URL}/auth/login`);
    // The form must be hydrated before it is submitted: pressing Enter on the
    // server-rendered markup sends nothing, and the wait below never ends.
    await page.waitForLoadState("networkidle");
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    const answer = page.waitForResponse((r) => r.url().includes("/sign-in/email"), { timeout: 60_000 });
    await page.locator('button[type="submit"]').first().click();
    if ((await answer).status() === 429) {
      await page.waitForTimeout(61_000);
      continue;
    }
    await page.waitForURL((url) => !url.pathname.includes("login"), { timeout: 60_000 });
    return;
  }
  throw new Error(`could not sign in as ${email}: rate limited three times`);
}

export interface Api {
  get<T = any>(path: string): Promise<{ status: number; data: T }>;
  patch<T = any>(path: string, body: unknown, headers?: Record<string, string>): Promise<{ status: number; data: T }>;
  post<T = any>(path: string, body: unknown, headers?: Record<string, string>): Promise<{ status: number; data: T }>;
  context: APIRequestContext;
}

/** An API client signed in as `email`, on its own cookie jar. */
export async function apiAs(email = ADMIN_EMAIL, password = PASSWORD): Promise<Api> {
  const context = await request.newContext({
    baseURL: API_URL,
    extraHTTPHeaders: { Origin: APP_URL.replace("127.0.0.1", "localhost") },
  });
  let signed = await context.post("/api/auth/sign-in/email", { data: { email, password } });
  if (signed.status() === 429) {
    await new Promise((resolve) => setTimeout(resolve, 61_000));
    signed = await context.post("/api/auth/sign-in/email", { data: { email, password } });
  }
  expect(signed.status(), `sign-in as ${email}`).toBe(200);
  const wrap = async (response: Awaited<ReturnType<APIRequestContext["get"]>>) => {
    const text = await response.text();
    let data: any = text;
    try {
      data = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: response.status(), data };
  };
  return {
    context,
    get: async (path) => wrap(await context.get(`/api${path}`)),
    patch: async (path, body, headers) =>
      wrap(await context.patch(`/api${path}`, { data: body, headers })),
    post: async (path, body, headers) =>
      wrap(await context.post(`/api${path}`, { data: body, headers })),
  };
}

/** Rows of a list answer, whatever its envelope. */
export function rowsOf(data: any): Array<Record<string, any>> {
  return Array.isArray(data) ? data : (data?.data ?? []);
}

/**
 * Collect what must never happen while a person uses the application: an
 * uncaught error in the page, and a 5xx from the API. A 4xx is the application
 * answering — a session probe, a refusal a spec asked for — and is not counted.
 */
export function watchErrors(page: Page): () => string[] {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
  page.on("response", (response) => {
    // The live-sync endpoint answers 503 by design when no Electric service is
    // configured (ELECTRIC_URL — it runs under docker compose, not locally), and
    // the client falls back to the HTTP API. Every other 5xx is a failure.
    if (response.status() === 503 && new URL(response.url()).pathname === "/api/v1/shape") return;
    if (response.url().includes("/api/") && response.status() >= 500) {
      problems.push(`${response.status()} ${response.request().method()} ${new URL(response.url()).pathname}`);
    }
  });
  return () => problems;
}

/** The value a field shows, as the form draws it (view mode). */
export async function shownValue(page: Page, column: string): Promise<string | null> {
  const node = page.locator(`[data-testid="field-value-${column}"]`).first();
  if (!(await node.count())) return null;
  return (await node.textContent())?.trim() ?? null;
}

/** "12,345.50" → 12345.5; "—" and "" → null. */
export function numberShown(text: string | null): number | null {
  if (text == null) return null;
  const t = text.trim();
  if (t === "" || t === "—" || t === "-") return null;
  const n = Number(t.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}
