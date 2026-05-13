type PageInfo = {
  nextCursor: string | null;
  hasMore: boolean;
};

export type SuccessResponse<T> = {
  data: T;
  meta: { requestId: string };
};

export type SuccessListResponse<T> = {
  data: { items: T[] };
  meta: { requestId: string; pageInfo?: PageInfo };
};

function resolveRequestId(request?: { id: string }): string {
  if (request && typeof request.id === 'string') return request.id;
  return 'unknown';
}

export function success<T>(data: T, request?: { id: string }): SuccessResponse<T> {
  return { data, meta: { requestId: resolveRequestId(request) } };
}

export function successList<T>(items: T[], pageInfo: PageInfo | null, request?: { id: string }): SuccessListResponse<T> {
  return { data: { items }, meta: { requestId: resolveRequestId(request), ...(pageInfo ? { pageInfo } : {}) } };
}

export function mutation(data: Record<string, unknown>, request?: { id: string }): SuccessResponse<Record<string, unknown>> {
  return { data, meta: { requestId: resolveRequestId(request) } };
}
