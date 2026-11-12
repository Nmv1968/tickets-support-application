import { Injectable, inject, signal } from '@angular/core';
import { Auth } from './auth';
import { CLIENT_ID } from './client-id';
import { TicketEvents } from './ticket-events';
import { Toast } from './toast';

interface ChangeEvent {
  scope: 'tickets' | 'catalogs' | 'settings';
  ticketId: number | null;
  created: { code: string; by: string } | null;
  clientId: string | null;
}

/** One block of a Server-Sent Events stream. `data` is empty when the block has no `data:` line, as in a keep-alive comment. */
export interface SseEvent {
  type: string;
  data: string;
}

/**
 * Parses Server-Sent Events text: blocks separated by a blank line, each with `event:` and
 * `data:` lines. Takes the text that just arrived and the unfinished block the previous call
 * left; returns the complete blocks and what is left for the next call. Line ends are
 * normalised over the joined text, so the result does not depend on where the network cut it.
 */
export function parseSse(chunk: string, pending: string): { events: SseEvent[]; pending: string } {
  const events: SseEvent[] = [];
  let buffer = (pending + chunk).replace(/\r\n/g, '\n');

  let end: number;
  while ((end = buffer.indexOf('\n\n')) >= 0) {
    const block = buffer.slice(0, end);
    buffer = buffer.slice(end + 2);

    let type = 'message';
    let data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) type = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    events.push({ type, data });
  }
  return { events, pending: buffer };
}

const RETRY_MIN_MS = 2_000;
const RETRY_MAX_MS = 30_000;

/**
 * Live updates. Keeps a Server-Sent Events stream open to the API and passes on each change
 * made elsewhere (another person, another tab, an assistant through MCP): changes to cases go
 * to TicketEvents, one by one; the rest are signals the screens watch to reload themselves.
 *
 * The stream is read with `fetch` instead of `EventSource` because `EventSource` cannot send
 * the Authorization header, and the token must not travel in the URL.
 */
@Injectable({ providedIn: 'root' })
export class Live {
  private readonly auth = inject(Auth);
  private readonly toast = inject(Toast);
  private readonly ticketEvents = inject(TicketEvents);

  /** Users, modules or AI setup changed. */
  readonly catalogs = signal(0);
  /** App settings (reminders) changed. */
  readonly settings = signal(0);
  readonly connected = signal(false);

  private abort: AbortController | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retryMs = RETRY_MIN_MS;
  private everConnected = false;

  /** Called by the shell while a user is logged in. */
  start(): void {
    this.stop();
    void this.run();
  }

  stop(): void {
    clearTimeout(this.retryTimer);
    this.abort?.abort();
    this.abort = undefined;
    this.connected.set(false);
  }

  private async run(): Promise<void> {
    const controller = new AbortController();
    this.abort = controller;
    try {
      const response = await fetch('/api/events', {
        headers: { Authorization: `Bearer ${this.auth.token ?? ''}`, Accept: 'text/event-stream' },
        signal: controller.signal,
      });
      if (response.status === 401) {
        this.auth.logout();
        return;
      }
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

      this.connected.set(true);
      this.retryMs = RETRY_MIN_MS;
      // Changes made while the stream was down were missed: reload everything once.
      if (this.everConnected) this.reloadAll();
      this.everConnected = true;

      await this.read(response.body);
    } catch {
      // Network drop, server restart or abort: handled below.
    }

    this.connected.set(false);
    if (controller.signal.aborted) return;
    this.retryTimer = setTimeout(() => void this.run(), this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, RETRY_MAX_MS);
  }

  private async read(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      const parsed = parseSse(decoder.decode(value, { stream: true }), pending);
      pending = parsed.pending;
      for (const event of parsed.events) {
        if (event.type !== 'change' || !event.data) continue;
        let change: ChangeEvent;
        try {
          change = JSON.parse(event.data) as ChangeEvent;
        } catch {
          // One unreadable event is skipped; it must not take the whole stream down.
          continue;
        }
        this.handle(change);
      }
    }
  }

  private handle(event: ChangeEvent): void {
    // This tab made the change: Api already announced it with the stored case.
    if (event.clientId === CLIENT_ID) return;

    if (event.scope === 'tickets') {
      this.ticketEvents.outdated(event.ticketId);
      if (event.created) this.toast.ok(`${event.created.by || 'Alguien'} registró el caso ${event.created.code}`);
    } else if (event.scope === 'catalogs') {
      this.catalogs.update((version) => version + 1);
    } else {
      this.settings.update((version) => version + 1);
    }
  }

  private reloadAll(): void {
    this.ticketEvents.outdated(null);
    this.catalogs.update((version) => version + 1);
    this.settings.update((version) => version + 1);
  }
}
