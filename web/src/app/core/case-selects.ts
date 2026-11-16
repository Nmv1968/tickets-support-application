import { ChangeDetectionStrategy, Component, booleanAttribute, computed, input, model, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgSelectComponent } from '@ng-select/ng-select';
import type { Priority, TicketStatus, TicketSupportType } from './api';
import { NAME_MAX, companyCreator } from './catalogs';
import { SELECT } from './select';
import { TypeChip } from './type-chip';
import { PRIORITY_OPTIONS, STATUS_OPTIONS } from './ui';

/*
 * The selects of the fields of a case, the same in every screen that has them: the form of a
 * case, "Nuevo caso", the case the AI drafted and the filters of the list. Each screen gives
 * them what it offers (a new case takes only the active entries of a catalog, a case also keeps
 * its own) and its own placeholder where it says something else.
 *
 * The label stays in the screen, pointing at `inputId`. Every list of options hangs from the
 * body: inside a dialog, a panel or the page it would be cut where they scroll. The "×" that empties
 * one says what it empties ("Quitar empresa"): a form has several, and "Quitar" alone said none.
 */

/** A client company. `creatable` offers "Crear empresa «X»" for a name the list does not have. */
@Component({
  selector: 'app-company-select',
  imports: [FormsModule, ...SELECT],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <ng-select
      [labelForId]="inputId()"
      bindValue="id"
      bindLabel="name"
      appendTo="body"
      [placeholder]="placeholder()"
      clearAllText="Quitar empresa"
      [items]="items()"
      [clearable]="clearable()"
      [addTag]="creatable() ? create : false"
      [inputAttrs]="inputAttrs()"
      [ngModel]="value()"
      (ngModelChange)="value.set($event)"
    >
      <ng-template ng-tag-tmp let-search="searchTerm">Crear empresa «{{ search }}»</ng-template>
    </ng-select>
  `,
})
export class CompanySelect<V extends number | null> {
  readonly inputId = input.required<string>();
  readonly items = input.required<readonly { id: number; name: string }[]>();
  readonly value = model.required<V>();
  readonly placeholder = input('');
  /** Off for a case, which always has a company: the select cannot be emptied. */
  readonly clearable = input(true, { transform: booleanAttribute });
  readonly creatable = input(false, { transform: booleanAttribute });
  /** Tells who hears the form that it cannot be sent without a company. */
  readonly required = input(false, { transform: booleanAttribute });
  /** The form was sent without a company: the select is marked (see styles.css), and says why through `describedBy`. */
  readonly invalid = input(false, { transform: booleanAttribute });
  /** The id of the message under the select. */
  readonly describedBy = input<string | null>(null);

  /**
   * A name typed to create a company is cut where the catalog cuts it. The state of the field goes on
   * the box the person types in, which has the focus. ng-select only ever sets these, never takes
   * one away: each is always given, with the value that says nothing when there is nothing to say.
   */
  protected readonly inputAttrs = computed(() => ({
    ...(this.creatable() ? { maxlength: String(NAME_MAX.company) } : {}),
    ...(this.required() ? { 'aria-required': 'true' } : {}),
    'aria-invalid': this.invalid() ? 'true' : 'false',
    'aria-describedby': this.describedBy() ?? '',
  }));

  /**
   * "Crear empresa «X»": the company joins the catalog, and the select chooses it. Public for a
   * screen that offers to create one by a button of its own (the company the AI read): the same
   * creation, which a second press of either one does not send again (see companyCreator).
   */
  readonly create = companyCreator();

  private readonly select = viewChild.required(NgSelectComponent);

  focus(): void {
    this.select().focus();
  }
}

/** The status of a case. A case always has one: the select cannot be emptied unless it is `clearable` (a filter). */
@Component({
  selector: 'app-status-select',
  imports: [FormsModule, ...SELECT],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <ng-select
      [labelForId]="inputId()"
      bindValue="id"
      bindLabel="label"
      appendTo="body"
      [placeholder]="placeholder()"
      clearAllText="Quitar estado"
      [items]="options"
      [clearable]="clearable()"
      [searchable]="false"
      [ngModel]="value()"
      (ngModelChange)="value.set($event)"
    />
  `,
})
export class StatusSelect<V extends TicketStatus | null> {
  readonly inputId = input.required<string>();
  readonly value = model.required<V>();
  readonly placeholder = input('');
  readonly clearable = input(false, { transform: booleanAttribute });

  protected readonly options = STATUS_OPTIONS;
}

/** The priority of a case. Emptied, the case has none, and so no deadline. */
@Component({
  selector: 'app-priority-select',
  imports: [FormsModule, ...SELECT],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <ng-select
      [labelForId]="inputId()"
      bindValue="id"
      bindLabel="label"
      appendTo="body"
      [placeholder]="placeholder()"
      clearAllText="Quitar prioridad"
      [items]="options"
      [searchable]="false"
      [ngModel]="value()"
      (ngModelChange)="value.set($event)"
    />
  `,
})
export class PrioritySelect {
  readonly inputId = input.required<string>();
  readonly value = model.required<Priority | null>();
  readonly placeholder = input('Sin prioridad');

  protected readonly options = PRIORITY_OPTIONS;
}

/**
 * The responsible of a case. Named by `inputId`, which a label points at, or by `ariaLabel`
 * where there is no label. A filter offers `none` among its options, for the cases nobody has.
 */
@Component({
  selector: 'app-assignee-select',
  imports: [FormsModule, ...SELECT],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <!-- ariaLabel is left out when it is not given: the select is then named by its label. -->
    <ng-select
      [labelForId]="inputId()"
      [ariaLabel]="ariaLabel()!"
      bindValue="id"
      bindLabel="name"
      appendTo="body"
      [placeholder]="placeholder()"
      clearAllText="Quitar responsable"
      [items]="items()"
      [ngModel]="value()"
      (ngModelChange)="value.set($event)"
    />
  `,
})
export class AssigneeSelect<T extends number | 'none'> {
  readonly inputId = input<string | null>(null);
  readonly ariaLabel = input<string>();
  readonly items = input.required<readonly { id: T; name: string }[]>();
  readonly value = model.required<T | null>();
  /** What an empty select says: in a form, that the case has no responsible. */
  readonly placeholder = input('Sin asignar');
}

/** The module of a case, by its full name ("Ventas / Facturas"). */
@Component({
  selector: 'app-module-select',
  imports: [FormsModule, ...SELECT],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <ng-select
      [labelForId]="inputId()"
      bindValue="id"
      bindLabel="fullName"
      appendTo="body"
      [placeholder]="placeholder()"
      clearAllText="Quitar módulo"
      [items]="items()"
      [ngModel]="value()"
      (ngModelChange)="value.set($event)"
    />
  `,
})
export class ModuleSelect {
  readonly inputId = input.required<string>();
  readonly items = input.required<readonly { id: number; fullName: string }[]>();
  readonly value = model.required<number | null>();
  readonly placeholder = input('Sin módulo');
}

/**
 * Support types, each as a chip of its colour. `multiple` for the types of a case: the value is
 * a list of ids, each chosen type has a "×" that takes it off, and the list stays open after each
 * choice, since a case often takes more than one. Otherwise one type (a filter).
 */
@Component({
  selector: 'app-support-type-select',
  imports: [FormsModule, ...SELECT, TypeChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <ng-select
      [labelForId]="inputId()"
      bindValue="id"
      bindLabel="name"
      appendTo="body"
      [placeholder]="placeholder()"
      [clearAllText]="multiple() ? 'Quitar todos los tipos de soporte' : 'Quitar tipo de soporte'"
      [items]="items()"
      [multiple]="multiple()"
      [closeOnSelect]="!multiple()"
      [ngModel]="value()"
      (ngModelChange)="value.set($event)"
    >
      <ng-template ng-label-tmp let-item="item" let-clear="clear">
        <app-type-chip [type]="item" [removable]="multiple()" (removed)="clear(item)" />
      </ng-template>
      <ng-template ng-option-tmp let-item="item">
        <app-type-chip [type]="item" />
      </ng-template>
    </ng-select>
  `,
})
export class SupportTypeSelect<V extends number[] | number | null> {
  readonly inputId = input.required<string>();
  readonly items = input.required<readonly TicketSupportType[]>();
  /** A list of ids with `multiple`, one id or null without it. */
  readonly value = model.required<V>();
  readonly multiple = input(false, { transform: booleanAttribute });
  readonly placeholder = input('Sin tipo de soporte');
}
