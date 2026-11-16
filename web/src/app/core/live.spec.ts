import { TestBed } from '@angular/core/testing';
import { nextTask } from '../testing/screen';
import { Auth } from './auth';
import { CLIENT_ID } from './client-id';
import { Live, parseSse } from './live';
import type { SseEvent } from './live';
import { TicketEvents } from './ticket-events';
import type { TicketEvent } from './ticket-events';
import { Toast } from './toast';

const CASE_7 = '{"scope":"tickets","ticketId":7,"created":null,"clientId":"abc"}';
const CASE_8 = '{"scope":"tickets","ticketId":8,"created":{"code":"SOP-00008","by":"Ana"},"clientId":null}';

// Messages as the API writes them (NestJS): `event`, `id` and `data` lines, then a blank line.
const change = (id: number, data: string): string => `event: change\nid: ${id}\ndata: ${data}\n\n`;
const ping = (id: number): string => `event: ping\nid: ${id}\ndata: \n\n`;

/** Feeds the chunks one after another, carrying the unfinished block over as Live does. */
function feed(chunks: string[]): { events: SseEvent[]; pending: string } {
  const events: SseEvent[] = [];
  let pending = '';
  for (const chunk of chunks) {
    const parsed = parseSse(chunk, pending);
    events.push(...parsed.events);
    pending = parsed.pending;
  }
  return { events, pending };
}

describe('parseSse', () => {
  it('reads a complete event', () => {
    expect(parseSse(change(1, CASE_7), '')).toEqual({ events: [{ type: 'change', data: CASE_7 }], pending: '' });
  });

  it('reads several events that arrive in one chunk, in order', () => {
    expect(parseSse(change(1, CASE_7) + ping(2) + change(3, CASE_8), '')).toEqual({
      events: [
        { type: 'change', data: CASE_7 },
        { type: 'ping', data: '' },
        { type: 'change', data: CASE_8 },
      ],
      pending: '',
    });
  });

  it('waits for the rest of an event that is split across chunks', () => {
    const text = change(1, CASE_7);
    const first = parseSse(text.slice(0, 30), '');
    expect(first).toEqual({ events: [], pending: text.slice(0, 30) });
    expect(parseSse(text.slice(30), first.pending)).toEqual({ events: [{ type: 'change', data: CASE_7 }], pending: '' });
  });

  it('keeps the start of the next event when a chunk ends in the middle of it', () => {
    const next = change(2, CASE_8);
    const first = parseSse(change(1, CASE_7) + next.slice(0, 12), '');
    expect(first.events).toEqual([{ type: 'change', data: CASE_7 }]);
    expect(parseSse(next.slice(12), first.pending)).toEqual({ events: [{ type: 'change', data: CASE_8 }], pending: '' });
  });

  it('reads a ping as an event without data', () => {
    expect(parseSse(ping(1), '').events).toEqual([{ type: 'ping', data: '' }]);
  });

  // The server writes a lone line feed before its first message.
  it('reads the first event after the line feed that opens the stream', () => {
    expect(feed(['\n', change(1, CASE_7)])).toEqual({ events: [{ type: 'change', data: CASE_7 }], pending: '' });
    expect(parseSse('\n' + ping(1), '').events).toEqual([{ type: 'ping', data: '' }]);
  });

  describe('with CRLF line endings', () => {
    const crlf = (text: string): string => text.replace(/\n/g, '\r\n');

    it('reads the same events', () => {
      expect(parseSse(crlf(change(1, CASE_7) + ping(2) + change(3, CASE_8)), '')).toEqual({
        events: [
          { type: 'change', data: CASE_7 },
          { type: 'ping', data: '' },
          { type: 'change', data: CASE_8 },
        ],
        pending: '',
      });
    });

    // Cut between the CR and the LF of the blank line, the two events must not become one.
    it('reads a line ending that is cut between two chunks', () => {
      const first = crlf(change(1, CASE_7));
      const second = crlf(change(2, CASE_8));
      expect(feed([first.slice(0, -1), first.slice(-1) + second]).events).toEqual([
        { type: 'change', data: CASE_7 },
        { type: 'change', data: CASE_8 },
      ]);
    });
  });

  it('gives the same result wherever the network cuts the stream', () => {
    const unfinished = 'event: change\nid: 5\ndata: {"sco';
    const lf = '\n' + change(1, CASE_7) + ping(2) + ': keep-alive\n\n' + change(4, CASE_8) + unfinished;

    for (const stream of [lf, lf.replace(/\n/g, '\r\n')]) {
      const whole = parseSse(stream, '');
      expect(whole.events.length).toBe(4);
      expect(whole.pending).toBe(unfinished);

      for (let cut = 0; cut <= stream.length; cut++) {
        expect(feed([stream.slice(0, cut), stream.slice(cut)])).withContext(`cut at ${cut}`).toEqual(whole);
      }
      expect(feed(stream.split(''))).withContext('one character at a time').toEqual(whole);
    }
  });

  describe('with malformed input', () => {
    it('passes on data that is not JSON as it came, and keeps reading', () => {
      expect(parseSse(change(1, '{"scope":') + change(2, CASE_8), '').events).toEqual([
        { type: 'change', data: '{"scope":' },
        { type: 'change', data: CASE_8 },
      ]);
    });

    it('names an event without an event line "message"', () => {
      expect(parseSse(`data: ${CASE_7}\n\n`, '').events).toEqual([{ type: 'message', data: CASE_7 }]);
    });

    it('accepts fields written without a space after the colon', () => {
      expect(parseSse(`event:change\ndata:${CASE_7}\n\n`, '').events).toEqual([{ type: 'change', data: CASE_7 }]);
    });

    it('gives no data for comments, unknown fields and lines that are not fields', () => {
      expect(parseSse(': keep-alive\n\nretry: 3000\nid: 9\n\nnot a field\n\n', '').events).toEqual([
        { type: 'message', data: '' },
        { type: 'message', data: '' },
        { type: 'message', data: '' },
      ]);
    });

    it('reads the events on both sides of extra blank lines', () => {
      const events = parseSse(change(1, CASE_7) + '\n\n\n' + change(2, CASE_8), '').events;
      expect(events.filter((event) => event.data)).toEqual([
        { type: 'change', data: CASE_7 },
        { type: 'change', data: CASE_8 },
      ]);
    });

    // A connection that drops in the middle of an event must not deliver half of it.
    it('never gives an event that did not end', () => {
      const half = 'event: change\nid: 1\ndata: {"scope":"tickets"';
      expect(parseSse(half, '')).toEqual({ events: [], pending: half });
      expect(parseSse(half + '\n', '')).toEqual({ events: [], pending: half + '\n' });
    });
  });
});

// Live reads the stream with fetch. Here fetch answers with a stream the test writes to, so each
// event goes through the same reader, parser and filter as in the app.
describe('Live', () => {
  let live: Live;
  let stream: ReadableStreamDefaultController<Uint8Array>;
  let seen: TicketEvent[];

  /** The data of a change to a case, as the API sends it. */
  const caseChange = (ticketId: number, clientId: string | null): string => JSON.stringify({ scope: 'tickets', ticketId, created: null, clientId });

  /**
   * Writes to the stream and waits until Live has gone through it: until it waits for the stream
   * again. Its promises are real ones, so it takes a real turn of the browser.
   */
  async function send(text: string): Promise<void> {
    stream.enqueue(new TextEncoder().encode(text));
    await nextTask();
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [{ provide: Auth, useValue: { token: 'token-de-prueba', logout: () => undefined } }] });
    const body = new ReadableStream<Uint8Array>({ start: (controller) => void (stream = controller) });
    spyOn(window, 'fetch').and.resolveTo(new Response(body));

    seen = [];
    TestBed.inject(TicketEvents).events.subscribe((event) => seen.push(event));
    live = TestBed.inject(Live);
    live.start();
    await nextTask();
  });

  afterEach(async () => {
    // Stopped first, so the end of the stream is not taken for a drop to reconnect after.
    live.stop();
    stream.close();
    await nextTask();
  });

  it('opens the stream with the token in a header, not in the address', () => {
    expect(window.fetch).toHaveBeenCalledOnceWith('/api/events', jasmine.objectContaining({ headers: { Authorization: 'Bearer token-de-prueba', Accept: 'text/event-stream' } }));
    expect(live.connected()).toBeTrue();
  });

  // Api already announced this tab's own change, with the case as it was stored. Its echo would
  // make every screen read again what it already shows.
  it('skips a change that carries the id of this tab, and passes on the ones made elsewhere', async () => {
    await send(change(1, caseChange(7, CLIENT_ID)) + change(2, caseChange(8, 'otra-pestana')) + change(3, caseChange(9, null)));
    expect(seen).toEqual([
      { kind: 'outdated', id: 8 },
      { kind: 'outdated', id: 9 },
    ]);
  });

  it('skips an event it cannot read, and keeps reading the ones after it', async () => {
    await send(change(1, '{"scope":') + change(2, caseChange(8, null)));
    expect(seen).toEqual([{ kind: 'outdated', id: 8 }]);
    expect(live.connected()).toBeTrue();

    await send(change(3, caseChange(9, null)));
    expect(seen).toEqual([
      { kind: 'outdated', id: 8 },
      { kind: 'outdated', id: 9 },
    ]);
  });

  it('says who registered a case elsewhere', async () => {
    await send(change(1, CASE_8));
    expect(seen).toEqual([{ kind: 'outdated', id: 8 }]);
    expect(TestBed.inject(Toast).items().map((item) => item.text)).toEqual(['Ana registró el caso SOP-00008']);
  });

  it('counts the changes to catalogs and to settings for the screens that watch them, and takes them for no case', async () => {
    const other = (scope: string): string => JSON.stringify({ scope, ticketId: null, created: null, clientId: null });
    await send(change(1, other('catalogs')) + ping(2) + change(3, other('settings')) + change(4, other('catalogs')));
    expect(live.catalogs()).toBe(2);
    expect(live.settings()).toBe(1);
    expect(seen).toEqual([]);
  });
});
