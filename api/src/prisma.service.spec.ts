import { PrismaService } from './prisma.service';

// Closing the application, the server first answers the requests it had: only then do the
// connections to the database close, instead of being cut when the process ends.
describe('the client of the database', () => {
  it('disconnects as the last step of closing the application', async () => {
    const prisma = new PrismaService();
    const disconnect = jest.spyOn(prisma, '$disconnect').mockResolvedValue();

    await prisma.onApplicationShutdown();

    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
