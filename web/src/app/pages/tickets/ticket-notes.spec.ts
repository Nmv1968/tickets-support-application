import type { ComponentFixture } from '@angular/core/testing';
import { TestBed, fakeAsync, flushMicrotasks } from '@angular/core/testing';
import type { TicketNote } from '../../core/api';
import { formatDateTime } from '../../core/ui';
import { isDisabled, screenOf } from '../../testing/screen';
import { textOf } from '../../testing/text';
import { TicketNotes } from './ticket-notes';

const CALLED: TicketNote = { id: 1, text: 'Se llamó al cliente\nVuelve a llamar el lunes', authorName: 'Ana', createdAt: '2026-11-06T09:00:00.000Z' };
const IMPORTED: TicketNote = { id: 2, text: 'Importada del Excel', authorName: null, createdAt: '2026-11-05T12:00:00.000Z' };

// The block only shows the observations and tells what the person does: the panel spec tries
// adding and deleting them, and the box saved with "Actualizar".
describe('TicketNotes', () => {
  let fixture: ComponentFixture<TicketNotes>;
  let el: HTMLElement;
  /** What the block told, in the order it told it. */
  let told: string[];

  function render(): void {
    fixture.detectChanges();
    flushMicrotasks();
    fixture.detectChanges();
  }

  function create(notes: TicketNote[] = [], text = ''): void {
    fixture = TestBed.createComponent(TicketNotes);
    el = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('notes', notes);
    fixture.componentRef.setInput('text', text);
    told = [];
    const block = fixture.componentInstance;
    block.text.subscribe((value) => told.push(`text ${value}`));
    block.add.subscribe(() => told.push('add'));
    block.remove.subscribe((id) => told.push(`remove ${id}`));
    render();
  }

  const { find, button, click, type } = screenOf(() => el, render);
  const box = (): HTMLTextAreaElement => find('textarea[aria-label="Nueva observación"]');
  const lines = (): string[] => Array.from(el.querySelectorAll('li')).map((line) => textOf(line));

  it('lists the observations of the case, each with when and who wrote it, line by line', fakeAsync(() => {
    create([CALLED, IMPORTED]);
    const [called, imported] = Array.from(el.querySelectorAll('li'));
    const head = (line: Element): (string | null)[] => Array.from(line.querySelectorAll('span')).map((part) => part.textContent);

    expect(head(called)).toEqual([formatDateTime(CALLED.createdAt), '· Ana']);
    expect(called.querySelector('p')?.textContent).toBe(CALLED.text);
    expect(called.querySelector('p')?.classList).toContain('whitespace-pre-line');
    // Written by nobody of the team: no name.
    expect(head(imported)).toEqual([formatDateTime(IMPORTED.createdAt)]);
    expect(imported.querySelector('p')?.textContent).toBe('Importada del Excel');
    expect(el.querySelectorAll('button[aria-label="Eliminar observación"]').length).toBe(2);
  }));

  it('says when the case has none', fakeAsync(() => {
    create();

    expect(lines()).toEqual(['Sin observaciones.']);
  }));

  it('gives back what is typed in the box, and "Agregar" can be pressed once it is more than spaces', fakeAsync(() => {
    create();
    expect(isDisabled(button('Agregar'))).toBeTrue();

    type(box(), '  ');
    expect(isDisabled(button('Agregar'))).toBeTrue();
    type(box(), 'Se llamó al cliente');
    expect(isDisabled(button('Agregar'))).toBeFalse();
    expect(told).toEqual(['text   ', 'text Se llamó al cliente']);
  }));

  it('shows in the box what the panel puts there, and empties it when the panel does', fakeAsync(() => {
    create([], 'Llamar mañana');
    expect(box().value).toBe('Llamar mañana');

    fixture.componentRef.setInput('text', '');
    render();
    expect(box().value).toBe('');
    expect(isDisabled(button('Agregar'))).toBeTrue();
  }));

  it('asks to add what is typed with "Agregar", and with Ctrl+Enter in the box', fakeAsync(() => {
    create([], 'Se llamó al cliente');
    click(button('Agregar'));
    box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }));
    render();
    // Enter alone is a new line.
    box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    render();

    expect(told).toEqual(['add', 'add']);
  }));

  it('asks to delete an observation with its trash', fakeAsync(() => {
    create([CALLED, IMPORTED]);
    click(el.querySelectorAll<HTMLButtonElement>('button[aria-label="Eliminar observación"]')[1]);

    expect(told).toEqual(['remove 2']);
  }));
  // The trash goes with its observation, and the browser put the focus nowhere.
  describe('the focus, once an observation is deleted', () => {
    const trashes = (): HTMLButtonElement[] => Array.from(el.querySelectorAll<HTMLButtonElement>('button[aria-label="Eliminar observación"]'));
    const THIRD: TicketNote = { ...IMPORTED, id: 3, text: 'Otra' };

    /** The trash at `index` is pressed, and the panel deletes its observation: the list comes again without it. */
    function remove(notes: TicketNote[], index: number): void {
      create(notes);
      trashes()[index].focus();
      click(trashes()[index]);
      expect(told).toEqual([`remove ${notes[index].id}`]);
      fixture.componentRef.setInput('notes', notes.filter((_, at) => at !== index));
      render();
    }

    it('goes to the trash of the one that took its place', fakeAsync(() => {
      remove([CALLED, IMPORTED, THIRD], 0);
      expect(document.activeElement).toBe(trashes()[0]);
      expect(trashes().length).toBe(2);
    }));

    it('goes to the trash of the one before, for the last one', fakeAsync(() => {
      remove([CALLED, IMPORTED], 1);
      expect(document.activeElement).toBe(trashes()[0]);
    }));

    it('goes to the box of a new one when none is left', fakeAsync(() => {
      remove([CALLED], 0);
      expect(document.activeElement).toBe(box());
    }));
  });

  it('keeps the focus on "Agregar" once the observation is added and the box is empty again', fakeAsync(() => {
    create([], 'Se llamó');
    button('Agregar').focus();
    click(button('Agregar'));
    fixture.componentRef.setInput('text', '');
    render();

    expect(told).toEqual(['add']);
    expect(isDisabled(button('Agregar'))).toBeTrue();
    expect(document.activeElement).toBe(button('Agregar'));
  }));
});
