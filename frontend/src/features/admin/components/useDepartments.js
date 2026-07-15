import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { departments as departmentsApi } from '../../../api/endpoints.js';

export const DEPARTMENTS_QUERY_KEY = ['departments'];

const EMPTY = [];

/**
 * The department list is the backbone of every admin filter and every form.
 * The API scopes it for us — Management gets all four, a Tech Lead gets exactly
 * one — so a single long-lived query serves every screen.
 */
export function useDepartments() {
  const query = useQuery({
    queryKey: DEPARTMENTS_QUERY_KEY,
    queryFn: () => departmentsApi.list().then((res) => res.data),
    staleTime: 10 * 60 * 1000,
  });

  const list = query.data ?? EMPTY;

  const byId = useMemo(() => new Map(list.map((d) => [d.id, d])), [list]);

  const options = useMemo(
    () => list.map((d) => ({ value: d.id, label: d.name })),
    [list],
  );

  return {
    departments: list,
    byId,
    options,
    getById: (id) => byId.get(id) ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
}

export default useDepartments;
