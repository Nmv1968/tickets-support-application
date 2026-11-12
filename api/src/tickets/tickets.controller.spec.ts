import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { NoteDto } from './tickets.controller';

// The controller imports the login decorators and, through them, @nestjs/jwt, which is published
// as ES modules only: Jest cannot load it here. Nothing in these tests uses it.
jest.mock('@nestjs/jwt', () => ({ JwtService: class {} }));

describe('observation input', () => {
  /** What the person would read for this request body: the messages of the 400, none when it is accepted. */
  const errors = async (input: Record<string, unknown>): Promise<string[]> =>
    (await validate(plainToInstance(NoteDto, input))).flatMap((error) => Object.values(error.constraints ?? {}));

  it('says in Spanish that an observation is empty or too long', async () => {
    expect(await errors({ text: '' })).toEqual(['La observación está vacía']);
    expect(await errors({ text: 'x'.repeat(5001) })).toEqual(['La observación no puede tener más de 5000 caracteres']);
  });

  it('accepts an observation of up to 5000 characters', async () => {
    expect(await errors({ text: 'x' })).toEqual([]);
    expect(await errors({ text: 'x'.repeat(5000) })).toEqual([]);
  });
});
