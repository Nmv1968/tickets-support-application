import { ArgumentsHost, BadRequestException, Catch, ConflictException, HttpException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Prisma } from '@prisma/client';

/** The 404 of a record that is not there, said by whatever cannot tell which kind of record it is. */
export const NO_RECORD_MESSAGE = 'El registro no existe';

/**
 * Prisma failures that the request itself causes, as the HTTP error to answer with.
 * The messages are generic because the filter cannot tell which record the screen was
 * working on; code that knows throws its own HttpException before Prisma fails.
 */
function toHttpException(error: Prisma.PrismaClientKnownRequestError): HttpException | null {
  switch (error.code) {
    case 'P2025':
      return new NotFoundException(NO_RECORD_MESSAGE);
    case 'P2002':
      return new ConflictException('Ya existe un registro con esos datos');
    case 'P2003':
      return new BadRequestException('La operación hace referencia a un registro que no existe o que sigue en uso');
    // A transaction that ran out of time, or that waited too long for a connection: nothing of it
    // was stored. The usual cause is a long write, such as a large import of cases, and a moment
    // later the same request goes through.
    case 'P2028':
      return new ServiceUnavailableException('El sistema está ocupado con otra operación y no se guardó nada. Intenta de nuevo en unos momentos.');
    default:
      return null;
  }
}

/**
 * True for the error of a write that the unique index on `fields` refused (P2002): another row
 * already has those values. Prisma names the columns of the index in `meta.target`. Code that
 * knows what the index means answers its own 409 with it; this filter can only say the generic one.
 */
export function violatesUnique(error: unknown, ...fields: string[]): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false;
  const target: unknown = error.meta?.target;
  return (Array.isArray(target) || typeof target === 'string') && fields.every((field) => target.includes(field));
}

/**
 * Without it a wrong id or a duplicate reaches Nest as an unknown error and the client gets
 * a 500. Only Prisma's known request errors are caught: HttpExceptions never pass through
 * here, and both the translated errors and the codes left untranslated are answered by
 * Nest's default handler, so the body stays `{ message, error, statusCode }`.
 */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter extends BaseExceptionFilter {
  catch(error: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost): void {
    super.catch(toHttpException(error) ?? error, host);
  }
}
