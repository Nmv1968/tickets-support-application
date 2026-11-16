import { BadRequestException, StreamableFile } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Response } from 'express';
import type { PrismaService } from '../prisma.service';
import { formatDateOnly, todayDateOnly } from './labels';

// What the files the API makes share: the exports of the list (transfer/), the import template and
// the two files of the report of the dashboard.

/** The type of each kind of file the API makes, by its extension. */
export const FILE_TYPES = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
} as const;

export type FileKind = keyof typeof FILE_TYPES;

/** The name a file of the API is downloaded under: its extension says its type. */
export type FileName = `${string}.${FileKind}`;

/** `stem` with the day the file is made, in the server's time zone: "casos-soporte-2026-11-14.xlsx". */
export function datedFileName(stem: string, kind: FileKind, now: Date = new Date()): FileName {
  return `${stem}-${formatDateOnly(todayDateOnly(now))}.${kind}`;
}

/**
 * `file` as a download called `filename`, of the type its extension says. A route answers with it
 * once the file exists: one that fails or is refused before that answers with a plain JSON error,
 * not with an attachment.
 */
export function download(res: Response, file: Buffer, filename: FileName): StreamableFile {
  const kind = filename.slice(filename.lastIndexOf('.') + 1) as FileKind;
  res.set({ 'Content-Type': FILE_TYPES[kind], 'Content-Disposition': `attachment; filename="${filename}"` });
  return new StreamableFile(file);
}

/**
 * Counts the cases of `where`, and refuses the file with a 400 that says `refusal(total)` when they
 * are more than `limit`. Counted first: a file that is refused costs one query and loads no rows.
 * It is never cut short instead: a file with part of the cases and nothing that says so reads as
 * the whole of them.
 */
export async function refuseOverLimit(prisma: PrismaService, where: Prisma.TicketWhereInput, limit: number, refusal: (total: number) => string): Promise<void> {
  const total = await prisma.ticket.count({ where });
  if (total > limit) throw new BadRequestException(refusal(total));
}
