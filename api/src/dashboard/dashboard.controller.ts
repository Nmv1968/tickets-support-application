import { Controller, Get, Query } from '@nestjs/common';
import { Priority } from '@prisma/client';
import { PRIORITIES, formatDateOnly, moduleFullName } from '../common/labels';
import { PrismaService } from '../prisma.service';
import { TicketsService, parseTicketFilters } from '../tickets/tickets.service';

interface StatusCount {
  name: string;
  unresolved: number;
  pending: number;
  resolved: number;
  total: number;
}

export interface DashboardDto {
  totals: { total: number; unresolved: number; pending: number; resolved: number; overdue: number };
  /** Creation to resolution, for cases resolved inside the app. Imported history has no resolution time. */
  avgResolutionHours: number | null;
  /** Percentage of cases with a deadline that were resolved on time. Open cases count once overdue. */
  slaCompliance: number | null;
  /** Sums over cases that have an estimate. */
  estimatedMinutes: number;
  spentMinutes: number;
  byAssignee: StatusCount[];
  byCompany: { name: string; total: number }[];
  byModule: { name: string; total: number }[];
  byPriority: { priority: Priority | null; total: number }[];
  monthly: { month: string; total: number; resolved: number; open: number }[];
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function top(map: Map<string, number>, limit: number): { name: string; total: number }[] {
  return [...map.entries()]
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tickets: TicketsService,
  ) {}

  @Get()
  async get(@Query('from') from?: string, @Query('to') to?: string): Promise<DashboardDto> {
    const [rows, users, modules] = await Promise.all([
      this.prisma.ticket.findMany({
        where: this.tickets.buildWhere(parseTicketFilters({ from, to })),
        select: {
          date: true,
          status: true,
          company: true,
          priority: true,
          assigneeId: true,
          assignedToClient: true,
          moduleId: true,
          createdAt: true,
          resolvedAt: true,
          dueAt: true,
          estimatedMinutes: true,
          spentMinutes: true,
        },
      }),
      this.prisma.user.findMany({ select: { id: true, name: true } }),
      this.prisma.systemModule.findMany({ select: { id: true, name: true, parent: { select: { name: true } } } }),
    ]);

    const userName = new Map(users.map((u) => [u.id, u.name]));
    // The full name, as the case shows it everywhere else: two submodules can share their own name.
    const moduleName = new Map(modules.map((m) => [m.id, moduleFullName(m)]));
    const now = new Date();

    const totals = { total: rows.length, unresolved: 0, pending: 0, resolved: 0, overdue: 0 };
    const assignees = new Map<string, StatusCount>();
    const companies = new Map<string, number>();
    const moduleCounts = new Map<string, number>();
    const priorities = new Map<Priority | null, number>();
    const months = new Map<string, { total: number; resolved: number }>();
    let resolutionMs = 0;
    let resolutionCount = 0;
    let slaMet = 0;
    let slaBreached = 0;
    let estimatedMinutes = 0;
    let spentMinutes = 0;

    for (const t of rows) {
      const statusKey = t.status === 'UNRESOLVED' ? 'unresolved' : t.status === 'PENDING' ? 'pending' : 'resolved';
      const resolved = t.status === 'RESOLVED';
      totals[statusKey]++;

      const assignee = t.assignedToClient ? 'Cliente' : t.assigneeId ? (userName.get(t.assigneeId) ?? 'Sin asignar') : 'Sin asignar';
      const entry = assignees.get(assignee) ?? { name: assignee, unresolved: 0, pending: 0, resolved: 0, total: 0 };
      entry[statusKey]++;
      entry.total++;
      assignees.set(assignee, entry);

      bump(companies, t.company);
      if (t.moduleId) bump(moduleCounts, moduleName.get(t.moduleId) ?? 'Otros');
      priorities.set(t.priority, (priorities.get(t.priority) ?? 0) + 1);

      const month = formatDateOnly(t.date).slice(0, 7);
      const monthEntry = months.get(month) ?? { total: 0, resolved: 0 };
      monthEntry.total++;
      if (resolved) monthEntry.resolved++;
      months.set(month, monthEntry);

      if (resolved && t.resolvedAt) {
        resolutionMs += t.resolvedAt.getTime() - t.createdAt.getTime();
        resolutionCount++;
      }
      if (t.dueAt) {
        if (resolved && t.resolvedAt) (t.resolvedAt <= t.dueAt ? slaMet++ : slaBreached++);
        else if (!resolved && t.dueAt < now) {
          slaBreached++;
          totals.overdue++;
        }
      }
      if (t.estimatedMinutes) {
        estimatedMinutes += t.estimatedMinutes;
        spentMinutes += t.spentMinutes;
      }
    }

    return {
      totals,
      avgResolutionHours: resolutionCount ? Math.round((resolutionMs / resolutionCount / 3_600_000) * 10) / 10 : null,
      slaCompliance: slaMet + slaBreached ? Math.round((slaMet / (slaMet + slaBreached)) * 100) : null,
      estimatedMinutes,
      spentMinutes,
      byAssignee: [...assignees.values()].sort((a, b) => b.total - a.total),
      byCompany: top(companies, 10),
      byModule: top(moduleCounts, 12),
      byPriority: [...PRIORITIES, null]
        .map((priority) => ({ priority, total: priorities.get(priority) ?? 0 }))
        .filter((p) => p.total > 0),
      monthly: [...months.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-12)
        .map(([month, m]) => ({ month, total: m.total, resolved: m.resolved, open: m.total - m.resolved })),
    };
  }
}
