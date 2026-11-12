import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { Observable, tap } from 'rxjs';
import type { AuthUser } from '../common/auth';
import { EventsService } from './events.service';
import type { ChangeEvent } from './events.service';

const SCOPES: { pattern: RegExp; scope: ChangeEvent['scope'] }[] = [
  { pattern: /^\/api\/(tickets|attachments|import|ai\/reply)(\/|$)/, scope: 'tickets' },
  { pattern: /^\/api\/(modules|users|assignees|sla|ai\/config)(\/|$)/, scope: 'catalogs' },
  { pattern: /^\/api\/(settings|branding)(\/|$)/, scope: 'settings' },
];

/**
 * Announces every successful write. Working from the request (method and path) keeps
 * controllers and services free of event code: a new write endpoint under one of the
 * paths above is announced without further work.
 */
@Injectable()
export class ChangeEventsInterceptor implements NestInterceptor {
  constructor(private readonly events: EventsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const scope = req.method === 'GET' ? undefined : SCOPES.find((entry) => entry.pattern.test(req.path))?.scope;
    // An import preview writes nothing.
    if (!scope || req.query.dryRun === '1') return next.handle();

    return next.handle().pipe(
      tap((body: unknown) => {
        const ticket = body && typeof body === 'object' && 'code' in body && 'id' in body ? (body as { id: number; code: string }) : null;
        const idInPath = /^\/api\/tickets\/(\d+)/.exec(req.path);
        const sentClientId = req.headers['x-client-id'];
        const clientId = typeof sentClientId === 'string' ? sentClientId : null;
        this.events.emit({
          scope,
          ticketId: ticket?.id ?? (idInPath ? Number(idInPath[1]) : null),
          created: ticket && req.method === 'POST' && req.path === '/api/tickets' ? { code: ticket.code, by: req.user?.name ?? '' } : null,
          clientId,
        });
        // The import is the one write that also changes a catalog: it adds the responsibles named in
        // the sheet that did not exist yet (`newPeople` in its answer). The other browsers must
        // reload that list too, or the new cases show there without a responsible person.
        const newPeople = body && typeof body === 'object' && 'newPeople' in body ? body.newPeople : null;
        if (Array.isArray(newPeople) && newPeople.length) this.events.emit({ scope: 'catalogs', ticketId: null, created: null, clientId });
      }),
    );
  }
}
