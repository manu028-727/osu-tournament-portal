import { z } from 'zod';

export const listPageSchema = z.coerce.number().int().min(1).max(100_000).default(1);
export type ListPage<T> = { items: T[]; page: number; pageSize: number; total: number };
export function pageWindow(requested: number, total: number, pageSize = 100) {
  const page = Math.min(listPageSchema.parse(requested), Math.max(1, Math.ceil(total / pageSize)));
  return { page, pageSize, total, skip: (page - 1) * pageSize, take: pageSize };
}
