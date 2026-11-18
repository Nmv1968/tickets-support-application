import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Role, Ticket } from '../core/api';
import { Auth } from '../core/auth';
import { Reminders } from '../core/reminders';
import { ticket } from '../testing/fixtures';
import { textOf } from '../testing/text';
import { resizeScreen } from '../testing/viewport';
import { RemindersPanel } from './reminders-panel';

// The drawer of the bell. What goes into each group is in reminders.spec.ts; here, what it says
// while the forgotten cases are off. Configuración > Recordatorios is a tab of administrators.
describe('RemindersPanel', () => {
  const staleHours = signal(0);

  beforeEach(() => {
    staleHours.set(0);
    const reminders: Partial<Reminders> = { staleHours, promiseSoonDays: signal(0), promises: signal<Ticket[]>([]), stale: signal<Ticket[]>([]), overdue: signal<Ticket[]>([]) };
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), { provide: Reminders, useValue: reminders }] });
  });

  /** What the drawer says, opened in a session of someone with `role`. */
  function openAs(role: Role): string {
    TestBed.inject(Auth).user.set({ id: 1, username: 'ana', name: 'Ana', role });
    const fixture = TestBed.createComponent(RemindersPanel);
    fixture.detectChanges();
    return textOf(fixture.nativeElement as HTMLElement);
  }

  it('tells an administrator where the forgotten cases are turned on', () => {
    expect(openAs('ADMIN')).toContain('Los recordatorios están apagados. Se activan en Configuración > Recordatorios.');
  });

  it('tells an agent that an administrator turns them on', () => {
    const text = openAs('AGENT');
    expect(text).toContain('Los recordatorios están apagados. Un administrador puede activarlos en Configuración > Recordatorios.');
    expect(text).not.toContain('Se activan en');
  });

  it('says nothing of turning them on while they are on', () => {
    staleHours.set(48);
    for (const role of ['ADMIN', 'AGENT'] as const) expect(openAs(role)).withContext(role).not.toContain('apagados');
  });
});

// Drawn for real, with the stylesheet of the app, with many cases to tell of and names that do not break by themselves.
describe('RemindersPanel on the screen', () => {
  const cases = Array.from({ length: 6 }, (_, index) =>
    ticket({ id: index + 1, code: `SOP-0000${index + 1}`, company: 'CorporaciónÑanduríQuíntupleZafiroDeLaSierra'.repeat(3), assignees: [{ id: 3, name: 'FernandaGisellaVillavicencioQuiñónez' }], promisedDate: '2026-11-05', promiseState: 'overdue' }),
  );

  let el: HTMLElement;

  function open(): void {
    const reminders: Partial<Reminders> = { staleHours: signal(48), promiseSoonDays: signal(0), promises: signal<Ticket[]>(cases), stale: signal<Ticket[]>(cases), overdue: signal<Ticket[]>([]) };
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), { provide: Reminders, useValue: reminders }] });
    TestBed.inject(Auth).user.set({ id: 1, username: 'ana', name: 'Ana', role: 'ADMIN' });
    const fixture = TestBed.createComponent(RemindersPanel);
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  const panel = (): HTMLElement => el.querySelector('[role=dialog]')!;
  const footer = (): HTMLButtonElement[] => Array.from(el.querySelectorAll<HTMLButtonElement>('footer button'));

  it('on a phone scrolls its cards between its header and its footer, and no card is wider than the panel', () => {
    resizeScreen(390, 844);
    open();

    expect(panel().scrollWidth).toBe(panel().clientWidth);
    for (const card of Array.from(el.querySelectorAll<HTMLElement>('button[appReminderCard]'))) expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth);
    for (const button of footer()) expect(button.getBoundingClientRect().bottom).toBeLessThanOrEqual(844);
  });

  // At 400 % (320 × 200) its header and its two buttons, one on top of the other, left the cards some 33 px.
  it('on a short screen scrolls whole, with its two buttons side by side at the end', () => {
    resizeScreen(320, 200);
    open();

    expect(panel().scrollHeight).toBeGreaterThan(panel().clientHeight);
    const [promises, forgotten] = footer();
    expect(promises.getBoundingClientRect().top).toBe(forgotten.getBoundingClientRect().top);
    forgotten.scrollIntoView();
    expect(forgotten.getBoundingClientRect().bottom).toBeLessThanOrEqual(200);
    expect(promises.getBoundingClientRect().bottom).toBeLessThanOrEqual(200);
  });
});

describe('RemindersPanel, its cards to who hears them', () => {
  // A card of the bell was a button named by all its text. The same case is in two groups: its ids are of each card.
  it('names each card by the code and the company of its case, and describes it by why it is there and the rest', () => {
    const due = ticket({ id: 1, code: 'SOP-00001', company: 'Acme', description: 'No imprime', promisedDate: '2026-11-05', promiseState: 'overdue' });
    const reminders: Partial<Reminders> = { staleHours: signal(48), promiseSoonDays: signal(0), promises: signal<Ticket[]>([due]), stale: signal<Ticket[]>([due]), overdue: signal<Ticket[]>([]) };
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), { provide: Reminders, useValue: reminders }] });
    TestBed.inject(Auth).user.set({ id: 1, username: 'ana', name: 'Ana', role: 'ADMIN' });
    const fixture = TestBed.createComponent(RemindersPanel);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const texts = (ids: string | null): string[] => (ids ?? '').split(' ').map((id) => textOf(el.querySelector(`#${id}`)));

    // A dialog, not a landmark that announces a dialog.
    expect(el.querySelector('[role=dialog]')!.tagName).toBe('DIV');
    const cards = Array.from(el.querySelectorAll<HTMLButtonElement>('button[appReminderCard]'));
    expect(cards.length).toBe(2);
    for (const card of cards) {
      expect(texts(card.getAttribute('aria-labelledby'))).toEqual(['SOP-00001', 'Acme']);
      expect(texts(card.getAttribute('aria-describedby')).join(' ')).toContain('No imprime');
    }
    expect(cards[0].getAttribute('aria-labelledby')).not.toBe(cards[1].getAttribute('aria-labelledby'));
    expect(texts(cards[0].getAttribute('aria-describedby'))[0]).toMatch(/^venció /);
  });

  it('names every responsible of a case on its card, and "Sin asignar" for a case nobody has', () => {
    const team = ticket({
      id: 1,
      code: 'SOP-00001',
      assignees: [
        { id: 4, name: 'Ana' },
        { id: 5, name: 'Luis' },
      ],
      promisedDate: '2026-11-05',
      promiseState: 'overdue',
    });
    const nobody = ticket({ id: 2, code: 'SOP-00002', promisedDate: '2026-11-05', promiseState: 'overdue' });
    const reminders: Partial<Reminders> = { staleHours: signal(48), promiseSoonDays: signal(0), promises: signal<Ticket[]>([team, nobody]), stale: signal<Ticket[]>([]), overdue: signal<Ticket[]>([]) };
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), { provide: Reminders, useValue: reminders }] });
    TestBed.inject(Auth).user.set({ id: 1, username: 'ana', name: 'Ana', role: 'ADMIN' });
    const fixture = TestBed.createComponent(RemindersPanel);
    fixture.detectChanges();
    const cards = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button[appReminderCard]'));

    expect(textOf(cards[0])).toContain('Ana, Luis');
    expect(textOf(cards[1])).toContain('Sin asignar');
  });
});
