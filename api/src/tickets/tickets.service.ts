import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { AuthUser } from '../common/auth';
import { noteSearchKey, parseDateOnly, ticketSearchKey, todayDateOnly } from '../common/labels';
import { PrismaService } from '../prisma.service';
import { SettingsService } from '../settings/settings.service';
import { uploadDir } from './attachment-files';
import { DEFAULT_PAGE_SIZE, buildWhere, ticketOrder } from './ticket-filters';
import type { TicketFilters } from './ticket-filters';
import { EMPTY_NOTE, MISSING_ENTRY } from './ticket-input';
import type { TicketInput } from './ticket-input';
import { baseInclude, detailDto, detailInclude, listDto, listInclude, moduleName } from './ticket-mappers';
import type { TicketDetailDto, TicketListDto } from './ticket-mappers';
import { activityStamp, assertReportDate, cleanReply, elapsedMinutes, planTicketUpdate, slaDueAt } from './ticket-update';
import type { TicketUpdateContext } from './ticket-update';

// The reads and writes of the cases in the database. What a case is answered as (ticket-mappers.ts),
// which cases a list holds (ticket-filters.ts) and what an edit writes (ticket-update.ts) are
// decided in the files next to this one.

/** The 404 of a case that is not there. */
export const TICKET_NOT_FOUND = 'El caso no existe';

@Injectable()
export class TicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async list(filters: TicketFilters): Promise<{ items: TicketListDto[]; total: number; page: number; pageSize: number }> {
    const rules = await this.settings.reminderRules();
    const where = buildWhere(filters, rules);
    const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;
    const page = filters.page ?? 1;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.ticket.findMany({
        where,
        include: listInclude,
        orderBy: ticketOrder(filters),
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.ticket.count({ where }),
    ]);
    return { items: rows.map((row) => listDto(row, rules)), total, page, pageSize };
  }

  /**
   * What the notification bell shows, all for open cases that are not archived:
   * - promises: promised delivery date already passed, due today or, when the team configured
   *   advance notice, coming up within those days (most urgent first);
   * - stale: nobody has touched the case for longer than the configured time (oldest first);
   * - overdue: past the SLA deadline.
   */
  async reminders(): Promise<{
    staleHours: number;
    promiseSoonDays: number;
    promises: TicketListDto[];
    stale: TicketListDto[];
    overdue: TicketListDto[];
  }> {
    const staleHours = await this.settings.staleHours();
    const rules = await this.settings.reminderRules();
    const [promises, stale, overdue] = await Promise.all([
      this.prisma.ticket.findMany({
        where: buildWhere({ promise: 'due' }, rules),
        include: listInclude,
        orderBy: [{ promisedDate: 'asc' }, { id: 'asc' }],
        take: 100,
      }),
      rules.staleBefore
        ? this.prisma.ticket.findMany({
            where: buildWhere({ stale: true }, rules),
            include: listInclude,
            orderBy: { lastActivityAt: 'asc' },
            take: 100,
          })
        : [],
      this.prisma.ticket.findMany({
        where: buildWhere({ overdue: true }),
        include: listInclude,
        orderBy: { dueAt: 'asc' },
        take: 100,
      }),
    ]);
    return {
      staleHours,
      promiseSoonDays: rules.promiseSoonDays,
      promises: promises.map((row) => listDto(row, rules)),
      stale: stale.map((row) => listDto(row, rules)),
      overdue: overdue.map((row) => listDto(row, rules)),
    };
  }

  async get(id: number): Promise<TicketDetailDto> {
    const ticket = await this.prisma.ticket.findUnique({ where: { id }, include: detailInclude });
    if (!ticket) throw new NotFoundException(TICKET_NOT_FOUND);
    return detailDto(ticket, await this.settings.reminderRules());
  }

  async create(dto: TicketInput, user: AuthUser): Promise<TicketDetailDto> {
    const description = dto.description?.trim();
    if (dto.companyId == null) throw new BadRequestException('La empresa es obligatoria');
    if (!description) throw new BadRequestException('La descripción es obligatoria');
    const { companyName, supportTypes, slaHours } = await this.lookups(dto);
    // `lookups` has already refused a company that is not in the catalog: this only tells the compiler.
    if (companyName === null) throw new BadRequestException(MISSING_ENTRY.company);

    const now = new Date();
    assertReportDate(dto.date, now);
    const status = dto.status ?? 'PENDING';
    const note = dto.note?.trim();

    const ticket = await this.prisma.ticket.create({
      data: {
        date: dto.date ? parseDateOnly(dto.date) : todayDateOnly(now),
        time: dto.time ?? null,
        companyId: dto.companyId,
        description,
        searchText: ticketSearchKey(companyName, description),
        status,
        // Nobody unless one is chosen: registering a case does not make a person responsible for it.
        assigneeId: dto.assigneeId ?? null,
        supportTypes: supportTypes?.length ? { create: supportTypes.map((type) => ({ supportTypeId: type.id })) } : undefined,
        archivedAt: dto.archived ? now : null,
        priority: dto.priority ?? null,
        estimatedMinutes: dto.estimatedMinutes ?? null,
        spentMinutes: dto.spentMinutes ?? 0,
        moduleId: dto.moduleId ?? null,
        dueAt: slaDueAt(now, slaHours),
        promisedDate: dto.promisedDate ? parseDateOnly(dto.promisedDate) : null,
        resolvedAt: status === 'RESOLVED' ? now : null,
        aiGenerated: dto.aiGenerated ?? false,
        createdById: user.id,
        createdAt: now,
        ...activityStamp(now),
        notes: note ? { create: { text: note, searchText: noteSearchKey(note), authorId: user.id } } : undefined,
      },
    });
    return this.get(ticket.id);
  }

  async update(id: number, dto: TicketInput, user: AuthUser): Promise<TicketDetailDto> {
    const before = await this.prisma.ticket.findUnique({ where: { id }, include: baseInclude });
    if (!before) throw new NotFoundException(TICKET_NOT_FOUND);

    const { data, history } = planTicketUpdate(before, dto, { now: new Date(), ...(await this.lookups(dto)) });
    await this.prisma.$transaction([
      this.prisma.ticket.update({ where: { id }, data }),
      this.prisma.ticketHistory.createMany({ data: history.map((change) => ({ ...change, ticketId: id, userId: user.id })) }),
    ]);
    return this.get(id);
  }

  async remove(id: number): Promise<void> {
    const attachments = await this.prisma.attachment.findMany({ where: { ticketId: id } });
    try {
      await this.prisma.ticket.delete({ where: { id } });
    } catch (error) {
      // P2025 is Prisma's "the row to delete does not exist". Any other failure is not a 404.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException(TICKET_NOT_FOUND);
      }
      throw error;
    }
    await Promise.all(attachments.map((a) => unlink(join(uploadDir(), a.storedName)).catch(() => undefined)));
  }

  async addNote(id: number, text: string, user: AuthUser): Promise<TicketDetailDto> {
    const clean = text.trim();
    if (!clean) throw new BadRequestException(EMPTY_NOTE);
    await this.get(id);
    await this.prisma.$transaction([
      this.prisma.ticketNote.create({ data: { ticketId: id, text: clean, searchText: noteSearchKey(clean), authorId: user.id } }),
      this.prisma.ticket.update({ where: { id }, data: activityStamp() }),
    ]);
    return this.get(id);
  }

  async removeNote(id: number, noteId: number): Promise<TicketDetailDto> {
    await this.prisma.ticketNote.deleteMany({ where: { id: noteId, ticketId: id } });
    return this.get(id);
  }

  /**
   * Stores the message for the client when it does not come from a person editing the case,
   * as the AI draft does. Null or empty clears it.
   */
  async saveCustomerReply(id: number, reply: string | null): Promise<void> {
    const { count } = await this.prisma.ticket.updateMany({
      where: { id },
      data: { customerReply: cleanReply(reply), ...activityStamp() },
    });
    if (!count) throw new NotFoundException(TICKET_NOT_FOUND);
  }

  async startTimer(id: number): Promise<TicketDetailDto> {
    const ticket = await this.get(id);
    if (!ticket.timerStartedAt) {
      const now = new Date();
      await this.prisma.ticket.update({ where: { id }, data: { timerStartedAt: now, ...activityStamp(now) } });
    }
    return this.get(id);
  }

  /**
   * Stops the timer and adds its minutes to the time spent. The write only goes through while the
   * timer is still the one read, and adds the minutes to whatever the time spent is by then: of two
   * stops at once (a double click, two tabs), the second writes nothing (a count of 0) instead of
   * stopping a timer started again meanwhile, or undoing an edit of the time spent. Either way the
   * answer is the case as it is now.
   */
  async stopTimer(id: number): Promise<TicketDetailDto> {
    const ticket = await this.get(id);
    if (ticket.timerStartedAt) {
      const now = new Date();
      await this.prisma.ticket.updateMany({
        where: { id, timerStartedAt: ticket.timerStartedAt },
        data: {
          timerStartedAt: null,
          spentMinutes: { increment: elapsedMinutes(ticket.timerStartedAt, now) },
          ...activityStamp(now),
        },
      });
    }
    return this.get(id);
  }

  /**
   * Loads what the input points to: its company, its person, its module, its support types and
   * the SLA of its priority. Any of the first four that does not exist is a 400.
   */
  private async lookups(dto: TicketInput): Promise<Omit<TicketUpdateContext, 'now'>> {
    // Null for a null too: the list is optional, and null means "not sent".
    const typeIds = dto.supportTypeIds ? [...new Set(dto.supportTypeIds)] : null;
    const [company, assignee, module, supportTypes, sla] = await Promise.all([
      dto.companyId != null ? this.prisma.company.findUnique({ where: { id: dto.companyId }, select: { name: true } }) : null,
      dto.assigneeId != null ? this.prisma.assignee.findUnique({ where: { id: dto.assigneeId }, select: { name: true } }) : null,
      dto.moduleId != null ? this.prisma.systemModule.findUnique({ where: { id: dto.moduleId }, select: baseInclude.module.select }) : null,
      typeIds?.length ? this.prisma.supportType.findMany({ where: { id: { in: typeIds } }, select: { id: true, name: true } }) : [],
      dto.priority ? this.prisma.slaPolicy.findUnique({ where: { priority: dto.priority } }) : null,
    ]);
    if (dto.companyId != null && !company) throw new BadRequestException(MISSING_ENTRY.company);
    if (dto.assigneeId != null && !assignee) throw new BadRequestException(MISSING_ENTRY.assignee);
    if (dto.moduleId != null && !module) throw new BadRequestException(MISSING_ENTRY.module);
    if (typeIds && supportTypes.length !== typeIds.length) throw new BadRequestException(MISSING_ENTRY.supportType);
    return {
      companyName: company?.name ?? null,
      assigneeName: assignee?.name ?? null,
      moduleName: moduleName(module),
      supportTypes: typeIds ? supportTypes : null,
      slaHours: sla?.hours ?? null,
    };
  }
}
