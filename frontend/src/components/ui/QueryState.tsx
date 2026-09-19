import type { UseQueryResult } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { EmptyState } from "./EmptyState";

/** Standard loading / error / empty (no_data) / ready switch for a query. */
export function QueryState<T>({
  query,
  loading,
  empty,
  isEmpty,
  children,
}: {
  query: UseQueryResult<T | null>;
  loading: ReactNode;
  empty: ReactNode;
  isEmpty?: (data: T) => boolean;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) return <>{loading}</>;
  if (query.isError) {
    return <EmptyState error compact title="Couldn't load this" hint={query.error instanceof Error ? query.error.message : undefined} />;
  }
  const data = query.data;
  if (data == null || (isEmpty && isEmpty(data))) return <>{empty}</>;
  return <>{children(data)}</>;
}
