import { BadRequestException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { ArgumentMetadata, PipeTransform, Type } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import type { TicketsService } from '../tickets/tickets.service';
import { AiController } from './ai.controller';
import type { AiService } from './ai.service';
import { AiError } from './types';

describe('AI endpoints', () => {
  /** The controller over fakes of the two services, each with only the calls the test expects. */
  const setup = (ai: { analyze?: jest.Mock; reply?: jest.Mock }, tickets: { get?: jest.Mock } = {}): AiController =>
    new AiController(ai as unknown as AiService, tickets as unknown as TicketsService);

  describe('analyze', () => {
    it('refuses a text field that is not one text', () => {
      const analyze = jest.fn();
      const controller = setup({ analyze });

      // A form field sent twice arrives as a list; a JSON body can carry anything.
      for (const text of [['uno', 'dos'], 5, { a: 1 }]) {
        const attempt = (): unknown => controller.analyze(undefined, text);
        expect(attempt).toThrow(BadRequestException);
        expect(attempt).toThrow('El campo "text" no es válido. Debe ser un solo texto.');
      }
      expect(analyze).not.toHaveBeenCalled();
    });

    it('hands the service the text without the spaces around it', async () => {
      const analyze = jest.fn().mockResolvedValue({ description: 'No abre' });
      const controller = setup({ analyze });

      await expect(controller.analyze(undefined, '  No abre el sistema \n')).resolves.toEqual({ description: 'No abre' });

      expect(analyze).toHaveBeenCalledWith('No abre el sistema', []);
    });

    it('asks for an image or a text when neither comes', () => {
      const controller = setup({ analyze: jest.fn() });

      for (const text of [undefined, '', '   ']) {
        expect(() => controller.analyze([], text)).toThrow('Envía una imagen o un texto');
      }
    });
  });

  describe('reply', () => {
    /** The pipes a route declares on one of its parameters, built as Nest builds them. */
    const pipesOf = (method: keyof AiController, index: number): PipeTransform[] => {
      const declared = Reflect.getMetadata(ROUTE_ARGS_METADATA, AiController, method) as Record<
        string,
        { index: number; pipes: (Type<PipeTransform> | PipeTransform)[] }
      >;
      const parameter = Object.values(declared).find((entry) => entry.index === index);
      return (parameter?.pipes ?? []).map((pipe) => (typeof pipe === 'function' ? new pipe() : pipe));
    };

    it('answers "not found" for an id that no case can have, and reads any other number', async () => {
      const [pipe] = pipesOf('reply', 0);
      const ticketId: ArgumentMetadata = { type: 'param', metatype: Number, data: 'ticketId' };

      // Passed on, zero finds nothing and a number beyond the id column makes the database fail.
      for (const id of ['0', '2147483648']) {
        await expect(pipe.transform(id, ticketId)).rejects.toBeInstanceOf(NotFoundException);
      }
      await expect(pipe.transform('7', ticketId)).resolves.toBe(7);
      await expect(pipe.transform('siete', ticketId)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('answers with the updated case once the message is saved', async () => {
      const reply = jest.fn().mockResolvedValue(undefined);
      const get = jest.fn().mockResolvedValue({ id: 7, customerReply: 'Buen día.' });

      await expect(setup({ reply }, { get }).reply(7)).resolves.toEqual({ id: 7, customerReply: 'Buen día.' });

      expect(reply).toHaveBeenCalledWith(7);
      expect(get).toHaveBeenCalledWith(7);
    });

    it('passes on the 404 of a case that does not exist, and turns a provider problem into a 422', async () => {
      const get = jest.fn();
      const missing = new NotFoundException('El caso no existe');

      await expect(setup({ reply: jest.fn().mockRejectedValue(missing) }, { get }).reply(99)).rejects.toBe(missing);

      const refused = await setup({ reply: jest.fn().mockRejectedValue(new AiError('Falta elegir el modelo en Configuración > IA.')) }, { get })
        .reply(7)
        .catch((caught: unknown) => caught);
      expect(refused).toBeInstanceOf(UnprocessableEntityException);
      expect((refused as UnprocessableEntityException).message).toBe('Falta elegir el modelo en Configuración > IA.');
      expect(get).not.toHaveBeenCalled();
    });
  });
});
