import { BadRequestException, HttpException, Injectable, PayloadTooLargeException, mixin } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor, Type } from '@nestjs/common';
import { catchError, throwError } from 'rxjs';
import type { Observable } from 'rxjs';

export const MB = 1024 * 1024;

/** The 400 of a route of files that got none. */
export const NO_FILE_MESSAGE = 'No se recibió ningún archivo';

/** The limits of one upload route that its messages name: the size of each file and how many go in one request. */
export interface UploadLimits {
  fileSize: number;
  files: number;
}

/**
 * The fields of text a form of files may carry besides them, for a route that reads none. Multer
 * would take any number of fields of up to 1 MB each, all held in memory.
 */
export const FEW_FIELDS = { fields: 10, fieldSize: 1024 } as const;

/** Whole megabytes, as the messages say a size: 15 * MB is "15". */
export function megabytes(bytes: number): string {
  return String(Math.round(bytes / MB));
}

/** The messages of multer (through Nest) for the limits of the fields of a form, all said the same way here. */
const FIELD_LIMITS = [
  'Too many parts',
  'Too many fields',
  'Field name too long',
  'Field value too long',
  'Field name missing',
  'Field name nesting too deep',
  'Field name array index too large',
  'Invalid field name',
];

/**
 * The error of an upload in Spanish. Multer answers its limits in English, and Nest passes its
 * message on: "File too large" (413), "Too many files" (400), "Unexpected file field - name"...
 * Every other error, those the route itself throws among them, goes on as it came.
 */
export function uploadError(error: unknown, limits: UploadLimits): unknown {
  if (!(error instanceof HttpException)) return error;
  const { message } = error;
  const is = (english: string): boolean => message === english || message.startsWith(`${english} - `);

  if (error instanceof PayloadTooLargeException && is('File too large')) {
    return new PayloadTooLargeException(
      limits.files > 1 ? `Cada archivo puede pesar hasta ${megabytes(limits.fileSize)} MB.` : `El archivo puede pesar hasta ${megabytes(limits.fileSize)} MB.`,
    );
  }
  if (!(error instanceof BadRequestException)) return error;
  if (is('Too many files')) {
    return new BadRequestException(limits.files > 1 ? `Se pueden enviar hasta ${limits.files} archivos a la vez.` : 'Se puede enviar un solo archivo a la vez.');
  }
  if (is('Unexpected file field')) {
    const field = message.slice('Unexpected file field - '.length);
    return new BadRequestException(field ? `Un archivo llegó en un campo que no se esperaba: "${field}".` : 'Un archivo llegó en un campo que no se esperaba.');
  }
  if (FIELD_LIMITS.some(is)) return new BadRequestException('Los campos de texto que acompañan a los archivos superan lo que se admite.');
  if (message.startsWith('Multipart: ')) return new BadRequestException('Los archivos llegaron incompletos o mal formados. Vuelve a enviarlos.');
  return error;
}

/**
 * Interceptor that puts the errors of the upload interceptor after it in Spanish (see
 * `uploadError`). It goes first in `@UseInterceptors`, before the `FileInterceptor` or
 * `FilesInterceptor` of the route, with the same limits.
 */
export function uploadErrors(limits: UploadLimits): Type<NestInterceptor> {
  @Injectable()
  class UploadErrors implements NestInterceptor {
    intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
      return next.handle().pipe(catchError((error: unknown) => throwError(() => uploadError(error, limits))));
    }
  }
  return mixin(UploadErrors);
}
