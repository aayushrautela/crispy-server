import type { ListSourceCtx } from '../list-source.types.js';

export function limitFromCtx(ctx: ListSourceCtx, defaultLimit: number): number {
  return Math.min(ctx.limit || defaultLimit, 100);
}
