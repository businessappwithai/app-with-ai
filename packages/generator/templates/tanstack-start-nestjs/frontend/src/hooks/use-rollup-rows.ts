/**
 * The child rows each rollup on a record reads.
 *
 * A rollup (`%%field Order.subtotal rollup: sum(OrderItem.line_total)`) is drawn
 * by the browser and never stored, so nothing on the server computes it. What it
 * needs is the child rows of the open record, and the record screen already
 * loads those for its tab: this hook asks for them with the **same request and
 * the same query key** as `ChildPanel` (`["ad-child", endpoint, parentId, link]`),
 * so React Query answers both from one fetch. A child save or delete invalidates
 * that key, which is what makes the total follow the lines.
 *
 * Two more things a correct total needs:
 *
 * - **Every row.** The tab reads `CHILD_ROWS_LIMIT` rows; when the API reports
 *   more, the rest are read page by page. A rollup computed from the first page
 *   of a long list would be a wrong number that looks right.
 * - **The child's own calculated columns.** `sum(OrderItem.line_total)` over a
 *   calculated `line_total` sums what the screen would draw on each line, so the
 *   child's form fields are read (the key `use-bus-entity-level` already uses)
 *   and each row is computed first.
 *
 * A child list the user may not read (403) gives no rows, and the rollup draws
 * nothing rather than a total of what it could not see: it never shows more than
 * the API already returned to this person.
 */

import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import type { FieldMetadata } from "@/hooks/use-entities";
import { apiClient, type PaginatedResponse } from "@/lib/api-client";
import { computeValues, isComputed } from "@/lib/field-compute";

type AnyRecord = Record<string, unknown>;

/** The rows a child tab reads in one page — shared with `ChildPanel`. */
export const CHILD_ROWS_LIMIT = 100;

/** The endpoint a child tab lists from, for a table: `bus_order_item` → `/bus/order_item`. */
export function childEndpoint(tableName: string): string {
  return `/bus/${tableName.replace(/^bus_/, "")}`;
}

/** The key the child tab and every rollup over it share. */
export function childRowsKey(endpoint: string, parentId: string, link: string | undefined) {
  return ["ad-child", endpoint, parentId, link ?? ""] as const;
}

async function firstChildPage(
  endpoint: string,
  link: string,
  parentId: string
): Promise<PaginatedResponse<AnyRecord>> {
  const first = await apiClient.get<PaginatedResponse<AnyRecord>>(endpoint, {
    limit: CHILD_ROWS_LIMIT,
    [link]: parentId,
  });
  return first;
}

async function remainingRows(
  endpoint: string,
  link: string,
  parentId: string,
  total: number
): Promise<AnyRecord[]> {
  const rows: AnyRecord[] = [];
  const pages = Math.ceil(total / CHILD_ROWS_LIMIT);
  for (let page = 2; page <= pages; page++) {
    const next = await apiClient.get<PaginatedResponse<AnyRecord>>(endpoint, {
      limit: CHILD_ROWS_LIMIT,
      page,
      [link]: parentId,
    });
    rows.push(...(next.data ?? []));
    if (!next.data?.length) break;
  }
  return rows;
}

/**
 * For each rollup field of the record, its child rows — computed — or null
 * while they load or when they cannot be read. Keyed by the rollup's column.
 */
export function useRollupRows(
  fields: FieldMetadata[],
  parentId: string | undefined
): Record<string, AnyRecord[] | null> {
  const rollups = useMemo(
    () => fields.filter((f) => f.computed_kind === "rollup" && f.rollup),
    [fields]
  );
  const sources = useMemo(() => {
    const seen = new Map<string, { endpoint: string; entity: string; link: string }>();
    for (const field of rollups) {
      const rollup = field.rollup!;
      const endpoint = childEndpoint(rollup.child_table);
      seen.set(`${endpoint}|${rollup.link_column}`, {
        endpoint,
        entity: rollup.child_table.replace(/^bus_/, ""),
        link: rollup.link_column,
      });
    }
    return [...seen.values()];
  }, [rollups]);

  const enabled = !!parentId && sources.length > 0;
  const firstPages = useQueries({
    queries: sources.map((source) => ({
      queryKey: childRowsKey(source.endpoint, parentId ?? "", source.link),
      queryFn: () => firstChildPage(source.endpoint, source.link, parentId!),
      enabled,
      retry: false,
    })),
  });
  const rest = useQueries({
    queries: sources.map((source, i) => {
      const total = firstPages[i]?.data?.meta?.total ?? 0;
      return {
        queryKey: [...childRowsKey(source.endpoint, parentId ?? "", source.link), "rest", total],
        queryFn: () => remainingRows(source.endpoint, source.link, parentId!, total),
        enabled: enabled && total > CHILD_ROWS_LIMIT,
        retry: false,
      };
    }),
  });
  const childFields = useQueries({
    queries: sources.map((source) => ({
      queryKey: ["bus-form-fields", source.entity],
      queryFn: () => apiClient.get<FieldMetadata[]>(`/bus/${source.entity}/fields/form`),
      staleTime: 5 * 60 * 1000,
      enabled,
    })),
  });

  // `useQueries` hands back new arrays on every render. What decides the rows is
  // each query's data and status, so the memo is keyed on those — a stable object
  // for the form, which recomputes its fields whenever this changes.
  const signature = [...firstPages, ...rest, ...childFields]
    .map((query) => `${query.status}:${query.dataUpdatedAt}`)
    .join("|");

  return useMemo(() => {
    const bySource = new Map<string, AnyRecord[] | null>();
    sources.forEach((source, i) => {
      const first = firstPages[i];
      const more = rest[i];
      const total = first?.data?.meta?.total ?? 0;
      if (!first?.data || first.isError) {
        bySource.set(`${source.endpoint}|${source.link}`, null);
        return;
      }
      if (total > CHILD_ROWS_LIMIT && !more?.data) {
        bySource.set(`${source.endpoint}|${source.link}`, null);
        return;
      }
      const rows = [...(first.data.data ?? []), ...(more?.data ?? [])];
      const own = (childFields[i]?.data ?? []).filter(isComputed);
      bySource.set(
        `${source.endpoint}|${source.link}`,
        own.length ? rows.map((row) => ({ ...row, ...computeValues(own, row) })) : rows
      );
    });
    const result: Record<string, AnyRecord[] | null> = {};
    for (const field of rollups) {
      const rollup = field.rollup!;
      result[field.column_name] =
        bySource.get(`${childEndpoint(rollup.child_table)}|${rollup.link_column}`) ?? null;
    }
    return result;
  }, [rollups, sources, signature]);
}
