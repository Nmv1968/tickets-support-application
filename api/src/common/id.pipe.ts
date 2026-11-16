import { BadRequestException, Injectable, NotFoundException, ParseIntPipe } from '@nestjs/common';
import type { ArgumentMetadata } from '@nestjs/common';
import { NO_RECORD_MESSAGE } from './prisma-exception.filter';

/** Largest id the database can hold: its id columns are 32-bit integers. */
export const MAX_ID = 2_147_483_647;

/** The 400 of an id in the URL that is not a whole number. ParseIntPipe's own text is English. */
export const notAnId = (name = 'id'): string => `El identificador «${name}» debe ser un número entero`;

/**
 * Id of a record taken from the URL. A number no record can have (zero, negative, or beyond
 * what the column holds) answers "not found" here. Passed on, the database rejects it and the
 * person gets a 500 instead.
 */
@Injectable()
export class IdPipe extends ParseIntPipe {
  override async transform(value: string, metadata: ArgumentMetadata): Promise<number> {
    if (!this.isNumeric(value)) throw new BadRequestException(notAnId(metadata.data));
    const id = await super.transform(value, metadata);
    if (id < 1 || id > MAX_ID) throw new NotFoundException(NO_RECORD_MESSAGE);
    return id;
  }
}
