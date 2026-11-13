import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ArgumentMetadata } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { AssigneesController } from '../assignees/assignees.controller';
import { CatalogController } from '../catalog/catalog.controller';
import { CompaniesController } from '../companies/companies.controller';
import { SupportTypesController } from '../support-types/support-types.controller';
import { AttachmentsController } from '../tickets/attachments.controller';
import { TicketsController } from '../tickets/tickets.controller';
import { UsersController } from '../users/users.controller';
import { IdPipe, MAX_ID } from './id.pipe';

// The controllers import the login decorators and, through them, @nestjs/jwt, which is published
// as ES modules only: Jest cannot load it here. Nothing in these tests uses it.
jest.mock('@nestjs/jwt', () => ({ JwtService: class {} }));

describe('IdPipe', () => {
  const pipe = new IdPipe();
  const metadata: ArgumentMetadata = { type: 'param', data: 'id' };

  it('reads the id of a record, up to the largest the database can hold', async () => {
    expect(await pipe.transform('7', metadata)).toBe(7);
    expect(await pipe.transform('1', metadata)).toBe(1);
    expect(await pipe.transform('2147483647', metadata)).toBe(MAX_ID);
  });

  // The last one is a tax number: the MCP server takes the digits of whatever the assistant passes.
  it.each(['0', '-3', '2147483648', '99999999999', '1790012345001'])('answers 404 "El registro no existe" for %s, a number no record can have', async (value) => {
    const failure = await pipe.transform(value, metadata).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(NotFoundException);
    expect(failure).toHaveProperty('message', 'El registro no existe');
  });

  it.each(['abc', '1.5', '7x', ''])('answers 400 for "%s", which is not a whole number', async (value) => {
    await expect(pipe.transform(value, metadata)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('routes that take the id of a record from the URL', () => {
  /** The pipes of every `@Param()` of a controller, as Nest registers them, under "Controller.method(parameter)". */
  function paramPipes(controller: new (...args: never[]) => object): Record<string, unknown[]> {
    const found: Record<string, unknown[]> = {};
    for (const method of Object.getOwnPropertyNames(controller.prototype)) {
      const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, method) ?? {}) as Record<string, { data?: string; pipes: unknown[] }>;
      for (const [key, arg] of Object.entries(args)) {
        if (key.startsWith(`${RouteParamtypes.PARAM}:`)) found[`${controller.name}.${method}(${arg.data})`] = arg.pipes;
      }
    }
    return found;
  }

  // With Nest's own ParseIntPipe an id beyond what the database holds reached it and came back as a 500.
  it('read it through IdPipe', () => {
    const controllers = [TicketsController, AttachmentsController, UsersController, AssigneesController, CompaniesController, SupportTypesController, CatalogController];
    const pipes = controllers.map(paramPipes);

    expect(Object.assign({}, ...pipes)).toEqual({
      'TicketsController.get(id)': [IdPipe],
      'TicketsController.update(id)': [IdPipe],
      'TicketsController.remove(id)': [IdPipe],
      'TicketsController.addNote(id)': [IdPipe],
      'TicketsController.removeNote(id)': [IdPipe],
      'TicketsController.removeNote(noteId)': [IdPipe],
      'TicketsController.startTimer(id)': [IdPipe],
      'TicketsController.stopTimer(id)': [IdPipe],
      'AttachmentsController.upload(id)': [IdPipe],
      'AttachmentsController.download(id)': [IdPipe],
      'AttachmentsController.remove(id)': [IdPipe],
      'UsersController.update(id)': [IdPipe],
      'AssigneesController.update(id)': [IdPipe],
      'AssigneesController.remove(id)': [IdPipe],
      'CompaniesController.update(id)': [IdPipe],
      'CompaniesController.remove(id)': [IdPipe],
      'SupportTypesController.update(id)': [IdPipe],
      'SupportTypesController.remove(id)': [IdPipe],
      'CatalogController.updateModule(id)': [IdPipe],
    });
  });
});
