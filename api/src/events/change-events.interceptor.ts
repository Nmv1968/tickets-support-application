import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { Observable, tap } from 'rxjs';
import type { AuthUser } from '../common/auth';
import { EventsService } from './events.service';
import type { ChangeEvent } from './events.service';

const SCOPES: { pattern: RegExp; scope: ChangeEvent['scope'] }[] = [
  { pattern: /^\/api\/(tickets|attachments|import|ai\/reply)(\/|$)/, scope: 'tickets' },
  { pattern: /^\/api\/(modules|users|assignees|companies|support-types|sla|ai\/config)(\/|$)/, scope: 'catalogs' },
  { pattern: /^\/api\/(settings|branding)(\/|$)/, scope: 'settings' },
];

/** One entry of a catalog whose name, or colour, every case that points at it shows. */
const ENTRY_SHOWN_ON_CASES = /^\/api\/(companies|support-types|assignees|modules)\/\d+\/?$/;

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
        // The import is the one write that can also change the catalogs: asked to, it adds the
        // companies, responsibles and support types of the sheet that did not exist yet (`created`
        // in its answer, a list of names per catalog). The other browsers must reload those lists
        // too, or the new cases show there without their company, responsible or types.
        const added = body && typeof body === 'object' && 'created' in body ? body.created : null;
        const addedAny = !!added && typeof added === 'object' && Object.values(added).some((names) => Array.isArray(names) && names.length > 0);
        if (addedAny) this.events.emit({ scope: 'catalogs', ticketId: null, created: null, clientId });
        // And the other way round: an edit of a company, a support type, a responsible or a module
        // can rename it, or give a type another colour. Each case carries the name and the colour
        // as they were when it was read, so the lists, the board and the bell of the other browsers
        // have to read their cases again, or they keep showing the old ones next to selects that
        // already offer the new.
        if (req.method === 'PATCH' && ENTRY_SHOWN_ON_CASES.test(req.path)) {
          this.events.emit({ scope: 'tickets', ticketId: null, created: null, clientId });
        }
      }),
    );
  }
}
