import { ChangeDetectionStrategy, Component, ElementRef, input, model, output, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { Ticket } from '../../core/api';
import { Icon } from '../../core/icon';
import { formatDateTime, formatMinutes } from '../../core/ui';
import { NO_NOT_NUMBER } from './ticket-form';
import type { NotNumber, Problems } from './ticket-form';

/**
 * The "Tiempos" block of the case panel: the two fields of minutes of the draft, the timer of the
 * stored case and its deadline. It keeps nothing of the case: the panel gives it the minutes of
 * the draft and the case as stored, and does what the buttons ask.
 */
@Component({
  selector: 'app-ticket-times',
  imports: [FormsModule, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @let t = ticket();
    <section class="rounded-card border border-line p-3">
      <h2 class="section-title mb-2">Tiempos</h2>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="label" for="tp-estimated">Estimado (minutos)</label>
          <input
            #estimatedBox
            id="tp-estimated"
            class="input aria-[invalid=true]:border-danger"
            type="number"
            min="0"
            max="1000000"
            step="5"
            [ngModel]="estimated()"
            (ngModelChange)="estimated.set($event)"
            (input)="watch()"
            (keyup)="watch()"
            (change)="leave()"
            [attr.aria-invalid]="problems().estimatedMinutes ? 'true' : null"
            [attr.aria-describedby]="problems().estimatedMinutes ? 'tp-estimated-error' : null"
          />
          @if (problems().estimatedMinutes; as problem) {
            <p class="field-error" id="tp-estimated-error"><app-icon name="alert-circle-outline" class="text-danger" /> {{ problem }}</p>
          }
        </div>
        <div>
          <label class="label" for="tp-spent">Real (minutos)</label>
          <input
            #spentBox
            id="tp-spent"
            class="input aria-[invalid=true]:border-danger"
            type="number"
            min="0"
            max="1000000"
            step="5"
            [ngModel]="spent()"
            (ngModelChange)="spent.set($event)"
            (input)="watch()"
            (keyup)="watch()"
            (change)="leave()"
            [attr.aria-invalid]="problems().spentMinutes ? 'true' : null"
            [attr.aria-describedby]="problems().spentMinutes ? 'tp-spent-error' : null"
          />
          @if (problems().spentMinutes; as problem) {
            <p class="field-error" id="tp-spent-error"><app-icon name="alert-circle-outline" class="text-danger" /> {{ problem }}</p>
          }
        </div>
      </div>
      <!-- The timer runs on the stored case and acts at once, whatever the draft holds (see TicketPanel.timer). -->
      <div class="mt-3 flex flex-wrap items-center gap-2">
        @if (t.timerStartedAt) {
          <button type="button" class="btn btn-danger" [disabled]="spentUnsaved()" (click)="timer.emit('stop')">
            <app-icon name="stop" /> Detener cronómetro
          </button>
          @if (spentUnsaved()) {
            <span class="text-xs text-muted" id="tp-timer-hint">Actualiza o descarta el cambio en «Real (minutos)» para detenerlo.</span>
          } @else {
            <span class="text-xs text-muted">En marcha desde {{ formatDateTime(t.timerStartedAt) }}</span>
          }
        } @else {
          <button type="button" class="btn btn-soft" [disabled]="t.status === 'RESOLVED'" (click)="timer.emit('start')">
            <app-icon name="play" /> Iniciar cronómetro
          </button>
          <span class="text-xs text-muted">Acumulado: {{ formatMinutes(t.spentMinutes) }}</span>
        }
      </div>
      <dl class="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt class="text-muted">Fecha límite (SLA)</dt>
        <dd [class.text-danger]="t.overdue">{{ t.dueAt ? formatDateTime(t.dueAt) : 'Sin prioridad, sin fecha límite' }}</dd>
        @if (t.resolvedAt) {
          <dt class="text-muted">Resuelto</dt>
          <dd>{{ formatDateTime(t.resolvedAt) }}</dd>
        }
      </dl>
    </section>
  `,
})
export class TicketTimes {
  /** The case as it is stored: its timer, the minutes it has, its deadline. */
  readonly ticket = input.required<Pick<Ticket, 'status' | 'spentMinutes' | 'timerStartedAt' | 'dueAt' | 'overdue' | 'resolvedAt'>>();
  /** "Estimado (minutos)" and "Real (minutos)" of the draft, as typed: null while the field is empty. */
  readonly estimated = model.required<number | null>();
  readonly spent = model.required<number | null>();
  /** The fields that hold a text that is not a number: told from the fields themselves (see watch). */
  readonly notNumber = model.required<NotNumber>();
  /** What the panel says of the minutes the draft holds. */
  readonly problems = input.required<Problems>();
  /** "Real (minutos)" has a change that is not saved: the timer cannot be stopped (see TicketPanel.timer). */
  readonly spentUnsaved = input.required<boolean>();

  /** A field of minutes was left: the panel then shows the minutes as they would be stored. */
  readonly tidy = output<void>();
  /** "Iniciar cronómetro" or "Detener cronómetro". */
  readonly timer = output<'start' | 'stop'>();

  private readonly estimatedBox = viewChild.required<ElementRef<HTMLInputElement>>('estimatedBox');
  private readonly spentBox = viewChild.required<ElementRef<HTMLInputElement>>('spentBox');

  protected readonly formatDateTime = formatDateTime;
  protected readonly formatMinutes = formatMinutes;

  /**
   * Called with what the person does in the two fields, to tell whether one holds a text that is
   * not a number. With every key too: a text that starts in an empty field leaves it empty for
   * the browser, which may then report no change.
   */
  protected watch(): void {
    const held = this.notNumber();
    const now = {
      estimatedMinutes: this.estimatedBox().nativeElement.validity.badInput,
      spentMinutes: this.spentBox().nativeElement.validity.badInput,
    };
    if (now.estimatedMinutes !== held.estimatedMinutes || now.spentMinutes !== held.spentMinutes) this.notNumber.set(now);
  }

  /** On leaving a field: what it holds is told first, so that the panel tidies the minutes knowing it. */
  protected leave(): void {
    this.watch();
    this.tidy.emit();
  }

  /**
   * For the panel, when the form goes back to the stored case. A text that is not a number is in
   * its field alone, which reported it as empty: the draft never had it to give up.
   */
  emptyNotNumbers(): void {
    const held = this.notNumber();
    if (!held.estimatedMinutes && !held.spentMinutes) return;
    if (held.estimatedMinutes) this.estimatedBox().nativeElement.value = '';
    if (held.spentMinutes) this.spentBox().nativeElement.value = '';
    this.notNumber.set(NO_NOT_NUMBER);
  }
}
