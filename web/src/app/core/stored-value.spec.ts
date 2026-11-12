import { Component, signal, viewChild } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { StoredValue } from './stored-value';

@Component({
  imports: [StoredValue],
  template: `
    <input id="text" [appStoredValue]="stored()" [saving]="saving()" />
    <textarea id="area" [appStoredValue]="stored()"></textarea>
    <input id="date" type="date" [appStoredValue]="date()" />
  `,
})
class Host {
  readonly stored = signal('Acme');
  readonly saving = signal(false);
  readonly date = signal('2026-11-05');
  /** The directive of the first field. */
  readonly box = viewChild.required(StoredValue);
}

type Field = HTMLInputElement | HTMLTextAreaElement;

describe('StoredValue, a stored text shown in a field the person types in', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;

  beforeEach(() => {
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  const field = (id: string): Field => (fixture.nativeElement as HTMLElement).querySelector<Field>(`#${id}`)!;

  /** The person types: the field holds the text and says so. */
  function type(target: Field, text: string): void {
    target.value = text;
    target.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  /** The stored text changes: a save was answered, or the case was read again. */
  function store(text: string): void {
    host.stored.set(text);
    fixture.detectChanges();
  }

  it('shows the stored text, and follows it while the field holds nothing else', () => {
    expect(field('text').value).toBe('Acme');
    expect(field('area').value).toBe('Acme');
    expect(field('date').value).toBe('2026-11-05');

    store('Bodega Sur');
    host.date.set('2026-10-28');
    fixture.detectChanges();
    expect(field('text').value).toBe('Bodega Sur');
    expect(field('area').value).toBe('Bodega Sur');
    expect(field('date').value).toBe('2026-10-28');
  });

  // What `[value]` did not do: it wrote every change of the stored text over the field.
  it('keeps what the person typed when the stored text changes', () => {
    type(field('text'), 'Acme del Sur');
    type(field('area'), 'Acme del Norte');
    type(field('date'), '2026-11-28');

    store('Bodega Sur');
    host.date.set('2026-10-01');
    fixture.detectChanges();
    expect(field('text').value).toBe('Acme del Sur');
    expect(field('area').value).toBe('Acme del Norte');
    expect(field('date').value).toBe('2026-11-28');

    // And when it changes again.
    store('Bodega Norte');
    expect(field('text').value).toBe('Acme del Sur');
    expect(field('area').value).toBe('Acme del Norte');
  });

  it('follows again once what the person typed is the stored text', () => {
    type(field('text'), 'Acme del Sur');
    // It was saved.
    store('Acme del Sur');
    expect(field('text').value).toBe('Acme del Sur');

    store('Bodega Sur');
    expect(field('text').value).toBe('Bodega Sur');
  });

  // The field kept "Acme del Sur" while the stored text went from "Acme" to "Bodega Sur". Typing
  // "Acme" now is asking for another text than the stored one, even if the field once had it.
  it('takes an older stored text that the person types back as their own too', () => {
    type(field('text'), 'Acme del Sur');
    store('Bodega Sur');
    type(field('text'), 'Acme');

    store('Bodega Norte');
    expect(field('text').value).toBe('Acme');
  });

  describe('while a save of the field is unanswered', () => {
    // "Acme" changed to "Bodega Sur" and left, then put back to "Acme" and left: two saves on
    // their way, and the field holds the text it was first given.
    it('keeps what the field holds, even the text it was given, when the answer to an earlier save arrives', () => {
      host.saving.set(true);
      fixture.detectChanges();
      store('Bodega Sur');
      expect(field('text').value).toBe('Acme');

      // The second save stored: nothing left unanswered.
      host.stored.set('Acme');
      host.saving.set(false);
      fixture.detectChanges();
      expect(field('text').value).toBe('Acme');
      store('Bodega Norte');
      expect(field('text').value).toBe('Bodega Norte');
    });

    it('still keeps it when that save then fails: the case has the other text', () => {
      host.saving.set(true);
      fixture.detectChanges();
      store('Bodega Sur');

      host.saving.set(false);
      fixture.detectChanges();
      expect(field('text').value).toBe('Acme');
      store('Bodega Norte');
      expect(field('text').value).toBe('Acme');
    });

    it('follows as before once it is answered, when the field holds nothing else than the stored text', () => {
      host.saving.set(true);
      fixture.detectChanges();
      host.saving.set(false);
      fixture.detectChanges();

      store('Bodega Sur');
      expect(field('text').value).toBe('Bodega Sur');
    });
  });

  describe('show', () => {
    it('puts the text over what the person typed, and the field follows the stored text again', () => {
      type(field('text'), 'Acme del Sur');
      host.box().show('Acme');
      expect(field('text').value).toBe('Acme');
      expect(host.box().value).toBe('Acme');

      store('Bodega Sur');
      expect(field('text').value).toBe('Bodega Sur');
    });

    // A save was just answered: the caller knows the stored text before the field is given it.
    it('can run ahead of the stored text the field is given next', () => {
      type(field('text'), ' Acme del Sur ');
      host.box().show('Acme del Sur');
      store('Acme del Sur');
      expect(field('text').value).toBe('Acme del Sur');

      store('Bodega Sur');
      expect(field('text').value).toBe('Bodega Sur');
    });

    // The stored text can change once more before the field is given any of the two.
    it('leaves a text the field follows from, even if the field is never given that text itself', () => {
      type(field('text'), ' Acme del Sur ');
      host.box().show('Acme del Sur');

      store('Bodega Sur');
      expect(field('text').value).toBe('Bodega Sur');
    });
  });

  it('tells what the field holds', () => {
    expect(host.box().value).toBe('Acme');
    type(field('text'), 'Acme del Sur');
    expect(host.box().value).toBe('Acme del Sur');
  });

  it('knows whether the person is in the field: from the focus, or the first key, until it is left', () => {
    const box = host.box();
    expect(box.focused).toBeFalse();

    field('text').dispatchEvent(new Event('focus'));
    expect(box.focused).toBeTrue();
    field('text').dispatchEvent(new Event('blur'));
    expect(box.focused).toBeFalse();

    field('text').dispatchEvent(new Event('input'));
    expect(box.focused).toBeTrue();
    field('text').dispatchEvent(new Event('blur'));
    expect(box.focused).toBeFalse();
  });

  // A textarea gives its text back with every line end as a line feed, and an input drops them.
  // Compared as stored, such a text would never match what the field holds: it would count as the
  // person's own from the start and the field would stop following the case.
  it('follows a stored text with Windows line ends, or with a line end in a one-line field', () => {
    store('Uno\r\nDos');
    expect(field('area').value).toBe('Uno\nDos');
    expect(field('text').value).toBe('UnoDos');

    store('Uno\r\nDos\r\nTres');
    expect(field('area').value).toBe('Uno\nDos\nTres');
    expect(field('text').value).toBe('UnoDosTres');

    // And what the person types over it is still theirs.
    type(field('area'), 'Uno\nDos y medio');
    store('Otra cosa');
    expect(field('area').value).toBe('Uno\nDos y medio');
    expect(field('text').value).toBe('Otra cosa');
  });
});
