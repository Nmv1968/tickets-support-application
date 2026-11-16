import { ChangeDetectionStrategy, Component, booleanAttribute, computed, input } from '@angular/core';
import type { Ticket } from './api';
import { Hint } from './hint';
import { Icon } from './icon';
import type { IconName } from './icons';
import {
  PRIORITIES,
  PRIORITY_CLASS,
  PRIORITY_ICON,
  PRIORITY_LABEL,
  PROMISE_CLASS,
  PROMISE_ICON,
  formatDateTime,
  formatDay,
  promiseText,
  timeAgo,
} from './ui';

interface Flag {
  icon: IconName;
  color: string;
  /** Tooltip and accessible name: the same text for who sees the icon and who hears it. */
  label: string;
  /** What is written beside the icon where the case has room for it (see `labelled`): a word or two. */
  short: string;
}

/**
 * The small status icons of a case: delivery promise, forgotten, overdue, priority, running
 * timer, attachments and created with AI. Every list of cases shows them through this
 * component, so the icons, their order and their wording are the same everywhere.
 *
 * The state of the promise and the priority each have an icon of their own besides a colour:
 * the colour alone does not tell them apart to everyone (see PRIORITY_ICON, PROMISE_ICON).
 *
 * Each icon is an image named by what it says, for who hears it. Who sees it reads it in words
 * beside it where the case has room (`labelled`: the card of a case on a phone), and in the
 * legend of the list where it has none (see TicketFlagsLegend): its tooltip shows only under a
 * mouse that stays on it, and stays as a copy.
 */
@Component({
  selector: 'app-ticket-flags',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Wraps instead of overflowing where the list leaves little room (the code column, a phone).
  host: { class: 'flex flex-wrap items-center gap-1 text-sm leading-none', '[class.gap-x-2]': 'labelled()' },
  template: `
    @for (flag of flags(); track flag.label) {
      @if (labelled()) {
        <!-- The words are for the eye: who hears the case hears the name of the icon, which says more. -->
        <span class="inline-flex items-center gap-0.5" [class]="flag.color">
          <app-icon [name]="flag.icon" [label]="flag.label" [title]="flag.label" />
          <span class="text-xs leading-4" aria-hidden="true">{{ flag.short }}</span>
        </span>
      } @else {
        <app-icon [name]="flag.icon" [class]="flag.color" [label]="flag.label" [title]="flag.label" />
      }
    }
  `,
})
export class TicketFlags {
  readonly ticket = input.required<Ticket>();
  /** Off where the promise is already written out next to the case, as in the table. */
  readonly showPromise = input(true);
  /** Each icon with its words beside it, where the case has room for them. */
  readonly labelled = input(false, { transform: booleanAttribute });

  protected readonly flags = computed(() => {
    const t = this.ticket();
    const flags: Flag[] = [];
    if (this.showPromise() && t.promiseState) {
      const due = promiseText(t.promisedDate);
      flags.push({
        icon: PROMISE_ICON[t.promiseState],
        color: PROMISE_CLASS[t.promiseState],
        label: `Entrega prometida: ${formatDay(t.promisedDate)} · ${due}`,
        short: `Promesa: ${due}`,
      });
    }
    if (t.stale) {
      const ago = timeAgo(t.lastActivityAt);
      flags.push({ icon: 'bell-ring-outline', color: 'text-warning', label: `Olvidado: sin movimiento ${ago}`, short: 'Olvidado' });
    }
    if (t.overdue) flags.push({ icon: 'clock-alert-outline', color: 'text-danger', label: `Vencido: ${formatDateTime(t.dueAt)}`, short: 'Vencido' });
    if (t.priority) {
      const priority = PRIORITY_LABEL[t.priority];
      flags.push({ icon: PRIORITY_ICON[t.priority], color: PRIORITY_CLASS[t.priority], label: `Prioridad ${priority}`, short: priority });
    }
    if (t.timerStartedAt) flags.push({ icon: 'timer-outline', color: 'text-primary', label: 'Cronómetro en marcha', short: 'Cronómetro' });
    if (t.attachmentsCount) {
      const count = t.attachmentsCount;
      flags.push({ icon: 'paperclip', color: 'text-muted', label: `${count} adjunto(s)`, short: count === 1 ? '1 adjunto' : `${count} adjuntos` });
    }
    if (t.aiGenerated) flags.push({ icon: 'creation-outline', color: 'text-muted', label: 'Creado con IA', short: 'IA' });
    return flags;
  });
}

/** A line of the legend: the icons of a flag, in their colours, and what they mean. */
interface LegendLine {
  icons: readonly { name: IconName; color: string }[];
  text: string;
}

/** What the flags of a case mean, in the order TicketFlags shows them. */
export const FLAGS_LEGEND: readonly LegendLine[] = [
  {
    icons: (['overdue', 'today', 'soon'] as const).map((state) => ({ name: PROMISE_ICON[state], color: PROMISE_CLASS[state] })),
    text: 'Entrega prometida al cliente: vencida, para hoy o por venir.',
  },
  { icons: [{ name: 'bell-ring-outline', color: 'text-warning' }], text: 'Olvidado: abierto y sin movimiento por más del tiempo fijado en Recordatorios.' },
  { icons: [{ name: 'clock-alert-outline', color: 'text-danger' }], text: 'Vencido: abierto y con la fecha límite de su prioridad ya pasada.' },
  {
    icons: PRIORITIES.map((priority) => ({ name: PRIORITY_ICON[priority], color: PRIORITY_CLASS[priority] })),
    text: `Prioridad: ${PRIORITIES.map((priority) => PRIORITY_LABEL[priority].toLowerCase()).join(', ')}.`,
  },
  { icons: [{ name: 'timer-outline', color: 'text-primary' }], text: 'Cronómetro en marcha.' },
  { icons: [{ name: 'paperclip', color: 'text-muted' }], text: 'Tiene adjuntos.' },
  { icons: [{ name: 'creation-outline', color: 'text-muted' }], text: 'Creado con IA.' },
];

/**
 * What the flags of a case mean, behind a "?" (see Hint) next to where a list shows them without
 * words: the header of the codes in the table of cases, the line under the title of the board.
 * `<app-ticket-flags-legend textId="list-flags-legend" />`: the id of its text, once on the page.
 */
@Component({
  selector: 'app-ticket-flags-legend',
  imports: [Hint, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex' },
  template: `
    <!-- A space after each part (&#32;): it is the description of the "?", read as one text, and the lines are only drawn apart. -->
    <app-hint [textId]="textId()" about="Indicadores">
      <span class="block font-semibold">Indicadores del caso.&#32;</span>
      @for (line of legend; track line.text) {
        <span class="mt-1.5 flex items-start gap-2">
          <span class="flex shrink-0 gap-0.5 text-sm leading-4">
            @for (icon of line.icons; track icon.name + icon.color) {
              <app-icon [name]="icon.name" [class]="icon.color" />
            }
          </span>
          <span>{{ line.text }}&#32;</span>
        </span>
      }
    </app-hint>
  `,
})
export class TicketFlagsLegend {
  readonly textId = input.required<string>();
  protected readonly legend = FLAGS_LEGEND;
}
