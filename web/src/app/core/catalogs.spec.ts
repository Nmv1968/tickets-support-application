import { assigneeInput, assigneeValue } from './catalogs';

describe('responsible select helpers', () => {
  describe('assigneeValue', () => {
    it('is the user id for a person', () => {
      expect(assigneeValue({ assigneeId: 5, assignedToClient: false })).toBe('5');
    });

    it('is "client" when the client is responsible', () => {
      expect(assigneeValue({ assigneeId: null, assignedToClient: true })).toBe('client');
    });

    it('is empty when nobody is responsible', () => {
      expect(assigneeValue({ assigneeId: null, assignedToClient: false })).toBe('');
    });

    // The select can show only one option, so a leftover user id must not hide the client.
    it('prefers the client over a user id', () => {
      expect(assigneeValue({ assigneeId: 5, assignedToClient: true })).toBe('client');
    });
  });

  describe('assigneeInput', () => {
    it('reads a user id as a number', () => {
      expect(assigneeInput('5')).toEqual({ assigneeId: 5, assignedToClient: false });
    });

    it('reads "client" as the client, without a user', () => {
      expect(assigneeInput('client')).toEqual({ assigneeId: null, assignedToClient: true });
    });

    it('reads the empty option as nobody', () => {
      expect(assigneeInput('')).toEqual({ assigneeId: null, assignedToClient: false });
    });
  });

  describe('round trip', () => {
    it('gives back every state a case can be in', () => {
      const states = [
        { assigneeId: 12, assignedToClient: false },
        { assigneeId: null, assignedToClient: true },
        { assigneeId: null, assignedToClient: false },
      ];
      for (const state of states) expect(assigneeInput(assigneeValue(state))).toEqual(state);
    });

    it('gives back every option of the select', () => {
      for (const value of ['12', 'client', '']) expect(assigneeValue(assigneeInput(value))).toBe(value);
    });
  });
});
