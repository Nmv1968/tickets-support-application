import { randomUUID } from 'node:crypto';
import { mkdir, rm, unlink } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { diskStorage } from 'multer';
import { uploadDir } from './tickets.service';

/**
 * Folder where the files of an upload are written while they arrive, inside the folder of the
 * attachments: on the same disk, so that moving one into place is a rename and not a copy. Nothing
 * in it is an attachment yet. The backups leave it out (backup/backup.sh).
 */
export function incomingDir(): string {
  return join(uploadDir(), '.incoming');
}

/** The name of the file as the computer that sent it had it. Multer decodes multipart file names as latin1; browsers send UTF-8. */
export function originalName(file: Pick<Express.Multer.File, 'originalname'>): string {
  return Buffer.from(file.originalname, 'latin1').toString('utf8').slice(0, 200);
}

/** A name of its own for the stored file, with the extension of the original only if it is plain. */
export function storedName(filename: string): string {
  return `${randomUUID()}${extname(filename).toLowerCase().replace(/[^.a-z0-9]/g, '')}`;
}

/**
 * Multer writes each file of an attachment upload to disk as it arrives, under its stored name in
 * `incomingDir()`, instead of holding the whole request in memory (up to 10 files of 15 MB). If the
 * upload fails on the way (a file over the limit, a request cut short), multer removes what it wrote.
 */
export const attachmentStorage = diskStorage({
  destination: (_req, _file, done) => {
    const dir = incomingDir();
    mkdir(dir, { recursive: true }).then(
      () => done(null, dir),
      (error: Error) => done(error, dir),
    );
  },
  filename: (_req, file, done) => done(null, storedName(originalName(file))),
});

/** Removes files that may or may not exist: a file already moved, or never written, is no failure. */
export async function removeFiles(paths: string[]): Promise<void> {
  await Promise.all(paths.map((path) => unlink(path).catch(() => undefined)));
}

/**
 * Empties `incomingDir()` when the API starts: whatever is there was left by an upload that the API
 * stopped in the middle of (a restart, a crash), and no upload of this process has begun yet. One
 * API per attachments folder, as everywhere else.
 */
export async function clearIncoming(): Promise<void> {
  await rm(incomingDir(), { recursive: true, force: true });
}
