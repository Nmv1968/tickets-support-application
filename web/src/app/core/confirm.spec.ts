import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { ngSelect, openSelect } from '../testing/ng-select';
import { buttonIn } from '../testing/screen';
import { Confirm, ConfirmDialog } from './confirm';
import { SELECT } from './select';

/** Something that asks about itself and can go away before it is answered, as the case panel does when its case is deleted elsewhere. */
@Component({
  selector: 'app-test-asker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<button type="button" id="discard" (click)="leave()">Cerrar</button>`,
})
class Asker {
  private readonly confirm = inject(Confirm);
  private readonly destroyRef = inject(DestroyRef);
  /** What it was answered, once it was. */
  answered: boolean | undefined;

  async leave(): Promise<void> {
    this.answered = await this.confirm.ask({ title: 'Hay cambios sin guardar', confirmLabel: 'Descartar y salir', cancelLabel: 'Seguir editando', danger: true }, this.destroyRef);
  }
}

/** A screen with something that asks, and under the question a panel that closes with Escape, as the case panel does. */
@Component({
  imports: [ConfirmDialog, Asker],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'escapes = escapes + 1' },
  template: `
    <button type="button" id="delete" (click)="remove()">Eliminar caso</button>
    @if (panelOpen()) {
      <app-test-asker />
    }
    <app-confirm />
  `,
})
class Host {
  private readonly confirm = inject(Confirm);
  /** The part of the screen that asks about itself is on it. */
  readonly panelOpen = signal(true);
  /** What the person answered, once they did. */
  answered: boolean | undefined;
  /** Times the screen under the question heard Escape. */
  escapes = 0;

  async remove(): Promise<void> {
    this.answered = await this.confirm.ask({
      title: '¿Eliminar el caso SOP-00012?',
      message: 'Se eliminan también sus observaciones y adjuntos. No se puede deshacer.',
      confirmLabel: 'Eliminar',
      danger: true,
    });
  }
}

// Real time and real focus: the dialog moves the focus once it is on screen, and gives it back.
describe('Confirm, the question asked before something is done', () => {
  let fixture: ComponentFixture<Host>;
  let el: HTMLElement;
  let confirm: Confirm;

  beforeEach(async () => {
    fixture = TestBed.createComponent(Host);
    el = fixture.nativeElement as HTMLElement;
    // In the page: an element outside it cannot have the focus.
    document.body.appendChild(el);
    confirm = TestBed.inject(Confirm);
    await render();
  });

  afterEach(() => el.remove());

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const dialog = (): HTMLElement | null => el.querySelector('[role=alertdialog]');
  const opener = (): HTMLButtonElement => el.querySelector<HTMLButtonElement>('#delete')!;
  const button = (text: string): HTMLButtonElement => buttonIn(dialog()!, text);

  /** The person presses the button of the screen that asks. */
  async function ask(): Promise<void> {
    opener().focus();
    opener().click();
    await render();
  }

  async function press(key: string): Promise<void> {
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    await render();
  }

  it('shows nothing until something asks', () => {
    expect(dialog()).toBeNull();
    expect(confirm.current()).toBeNull();
  });

  it('asks with the title, the message and the buttons it was given', async () => {
    await ask();

    expect(dialog()!.getAttribute('aria-modal')).toBe('true');
    expect(el.querySelector(`#${dialog()!.getAttribute('aria-labelledby')}`)!.textContent).toBe('¿Eliminar el caso SOP-00012?');
    expect(el.querySelector(`#${dialog()!.getAttribute('aria-describedby')}`)!.textContent).toBe('Se eliminan también sus observaciones y adjuntos. No se puede deshacer.');
    expect([...dialog()!.querySelectorAll('button')].map((item) => item.textContent?.trim())).toEqual(['Cancelar', 'Eliminar']);
    expect(fixture.componentInstance.answered).toBeUndefined();
  });

  it('answers yes with its button, and goes away', async () => {
    await ask();
    button('Eliminar').click();
    await render();

    expect(fixture.componentInstance.answered).toBeTrue();
    expect(dialog()).toBeNull();
  });

  it('answers no with "Cancelar"', async () => {
    await ask();
    button('Cancelar').click();
    await render();

    expect(fixture.componentInstance.answered).toBeFalse();
    expect(dialog()).toBeNull();
  });

  it('answers no with a click outside the dialog, and nothing with a click on its text', async () => {
    await ask();
    dialog()!.querySelector('h2')!.click();
    await render();
    expect(fixture.componentInstance.answered).toBeUndefined();

    el.querySelector<HTMLElement>('.modal-backdrop')!.click();
    await render();
    expect(fixture.componentInstance.answered).toBeFalse();
  });

  // People double-click buttons. The first click asks, and the dialog is on screen before the
  // second one, which lands on whatever the dialog has under the pointer.
  describe('the second click of a double click on the button that asked', () => {
    /** A click as the browser reports it: `count` is 1 for a click of its own, 2 for the second of a double click. */
    async function click(target: HTMLElement, count: number): Promise<void> {
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: count }));
      await render();
    }

    it('does not answer no through the backdrop: the question stays', async () => {
      await ask();
      await click(el.querySelector<HTMLElement>('.modal-backdrop')!, 2);

      expect(fixture.componentInstance.answered).toBeUndefined();
      expect(dialog()).not.toBeNull();

      // A click of its own, once the person has read the question, answers it.
      await click(el.querySelector<HTMLElement>('.modal-backdrop')!, 1);
      expect(fixture.componentInstance.answered).toBeFalse();
    });

    it('does not press a button of the dialog that happens to be under it', async () => {
      await ask();
      await click(button('Eliminar'), 2);
      await click(button('Cancelar'), 2);

      expect(fixture.componentInstance.answered).toBeUndefined();
      expect(dialog()).not.toBeNull();

      await click(button('Eliminar'), 1);
      expect(fixture.componentInstance.answered).toBeTrue();
    });

    // Enter or Space on a button is a click that counts no presses of the mouse.
    it('is not what a key pressed on a button is taken for', async () => {
      await ask();
      await click(button('Eliminar'), 0);

      expect(fixture.componentInstance.answered).toBeTrue();
    });
  });

  // The dialog is drawn a moment after the press that asks. On a busy screen a second press
  // finds the button still there, and asks again.
  describe('asked a second time before it is answered', () => {
    const question = { title: '¿Eliminar el caso SOP-00012?', confirmLabel: 'Eliminar', danger: true };

    it('is one question: the second press gets a no at once, and what is confirmed is done once', async () => {
      const first = confirm.ask(question);
      const second = confirm.ask({ ...question });
      await render();

      expect(await second).toBeFalse();
      expect(dialog()!.textContent).toContain('¿Eliminar el caso SOP-00012?');
      button('Eliminar').click();
      await render();
      expect(await first).toBeTrue();
      // No second dialog with the same words behind the first.
      expect(dialog()).toBeNull();
    });

    it('can be asked again once it was answered', async () => {
      const first = confirm.ask(question);
      await render();
      button('Cancelar').click();
      await render();
      expect(await first).toBeFalse();

      const again = confirm.ask(question);
      await render();
      button('Eliminar').click();
      expect(await again).toBeTrue();
    });

    it('is another question when its words are others, or when someone else asks it', async () => {
      const first = confirm.ask(question);
      const other = confirm.ask({ ...question, title: '¿Eliminar el caso SOP-00013?' });
      // The same words, asked by something that says who it is.
      const elsewhere = confirm.ask(question, TestBed.inject(DestroyRef));
      await render();

      for (const title of ['SOP-00012', 'SOP-00013', 'SOP-00012']) {
        expect(dialog()!.textContent).toContain(title);
        button('Eliminar').click();
        await render();
      }
      expect(await Promise.all([first, other, elsewhere])).toEqual([true, true, true]);
      expect(dialog()).toBeNull();
    });
  });

  // The panel that asked listens for Escape on the document. It was only asked about, say,
  // leaving: hearing the same key, it would close with the question.
  it('answers no with Escape, which the screen under it does not hear', async () => {
    await ask();
    await press('Escape');

    expect(fixture.componentInstance.answered).toBeFalse();
    expect(dialog()).toBeNull();
    expect(fixture.componentInstance.escapes).toBe(0);

    // With no question on screen the key is the screen's again.
    await press('Escape');
    expect(fixture.componentInstance.escapes).toBe(1);
  });

  describe('the focus', () => {
    // Enter on a button presses it: what cannot be undone must take a deliberate step.
    it('starts on "Cancelar" when saying yes cannot be undone, and its button is drawn as a danger', async () => {
      await ask();

      expect(document.activeElement).toBe(button('Cancelar'));
      expect(button('Eliminar').classList).toContain('btn-danger');
    });

    it('starts on the button that says yes for a question without danger', async () => {
      const answer = confirm.ask({ title: '¿Archivar el caso?', confirmLabel: 'Archivar' });
      await render();

      expect(document.activeElement).toBe(button('Archivar'));
      expect(button('Archivar').classList).toContain('btn-primary');
      // No message: the dialog is described by its title alone.
      expect(dialog()!.hasAttribute('aria-describedby')).toBeFalse();

      button('Archivar').click();
      expect(await answer).toBeTrue();
    });

    it('stays inside the dialog while it is open', async () => {
      await ask();
      // What the focus trap of the other dialogs of the app does: Tab from the last button goes to the first.
      expect(dialog()!.hasAttribute('cdktrapfocus')).toBeTrue();
      expect(dialog()!.contains(document.activeElement)).toBeTrue();
    });

    it('goes back to what had it once the question is answered', async () => {
      await ask();
      expect(document.activeElement).not.toBe(opener());

      button('Cancelar').click();
      await render();
      expect(document.activeElement).toBe(opener());
    });
  });

  it('says no with another wording when the question gives one', async () => {
    const answer = confirm.ask({ title: 'Hay cambios sin guardar', confirmLabel: 'Descartar y salir', cancelLabel: 'Seguir editando' });
    await render();

    expect([...dialog()!.querySelectorAll('button')].map((item) => item.textContent?.trim())).toEqual(['Seguir editando', 'Descartar y salir']);
    button('Seguir editando').click();
    expect(await answer).toBeFalse();
  });

  // Nothing a person does asks twice at once, but a change arriving from elsewhere could.
  it('asks a second question once the first one is answered, each with its own answer', async () => {
    const first = confirm.ask({ title: '¿Archivar el caso?', confirmLabel: 'Archivar' });
    const second = confirm.ask({ title: '¿Eliminar la observación?', confirmLabel: 'Eliminar', danger: true });
    await render();
    expect(dialog()!.textContent).toContain('¿Archivar el caso?');

    button('Archivar').click();
    await render();
    expect(await first).toBeTrue();
    expect(dialog()!.textContent).toContain('¿Eliminar la observación?');
    // The focus starts again where this question says, not on the button just pressed.
    expect(document.activeElement).toBe(button('Cancelar'));

    await press('Escape');
    expect(await second).toBeFalse();
    expect(dialog()).toBeNull();
  });

  // The case panel closes by itself when its case is deleted somewhere else. A question it had
  // on screen would be left asking about a form that is gone.
  describe('asked by something that goes away before it is answered', () => {
    const asker = (): Asker => fixture.debugElement.children.find((child) => child.componentInstance instanceof Asker)!.componentInstance as Asker;

    async function askFromPanel(): Promise<Asker> {
      const panel = asker();
      el.querySelector<HTMLButtonElement>('#discard')!.click();
      await render();
      return panel;
    }

    it('is withdrawn with it, answered as a no', async () => {
      const panel = await askFromPanel();
      expect(dialog()!.textContent).toContain('Hay cambios sin guardar');

      fixture.componentInstance.panelOpen.set(false);
      await render();

      expect(dialog()).toBeNull();
      expect(confirm.current()).toBeNull();
      expect(panel.answered).toBeFalse();
    });

    it('is withdrawn while it waits behind another question, which stays', async () => {
      await ask();
      const panel = await askFromPanel();
      expect(dialog()!.textContent).toContain('¿Eliminar el caso SOP-00012?');

      fixture.componentInstance.panelOpen.set(false);
      await render();
      expect(panel.answered).toBeFalse();
      expect(dialog()!.textContent).toContain('¿Eliminar el caso SOP-00012?');

      // Nothing waits behind the question on screen any more.
      button('Cancelar').click();
      await render();
      expect(dialog()).toBeNull();
    });

    it('is answered by the person as any other while whoever asked is still there', async () => {
      const panel = await askFromPanel();
      button('Descartar y salir').click();
      await render();
      expect(panel.answered).toBeTrue();

      // Answered: going away afterwards withdraws nothing, and answers nothing again.
      fixture.componentInstance.panelOpen.set(false);
      await render();
      expect(panel.answered).toBeTrue();
    });

    it('is not asked at all once whoever asks has gone', async () => {
      const panel = asker();
      fixture.componentInstance.panelOpen.set(false);
      await render();

      await panel.leave();
      await render();
      expect(panel.answered).toBeFalse();
      expect(dialog()).toBeNull();
    });
  });

  // The shell goes away when the session ends: whoever asked must not wait for ever.
  it('answers no to what is still asked when the dialog goes away', async () => {
    await ask();
    fixture.destroy();

    // The answer reaches whoever asked in a turn of its own.
    await new Promise((resolve) => setTimeout(resolve));
    expect(fixture.componentInstance.answered).toBeFalse();
  });
});

/** A form with a list of options, and the question that can arrive while the list is open: the Back button of the browser asks about what the form has unsaved. */
@Component({
  imports: [ConfirmDialog, FormsModule, ...SELECT],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-select ariaLabel="Estado" [items]="statuses" [clearable]="false" [(ngModel)]="status" />
    <app-confirm />
  `,
})
class FormHost {
  readonly statuses = ['Pendiente', 'Resuelto', 'Sin resolver'];
  readonly status = signal('Pendiente');
}

describe('Confirm, asked while a list of options is open', () => {
  let fixture: ComponentFixture<FormHost>;
  let el: HTMLElement;

  beforeEach(async () => {
    fixture = TestBed.createComponent(FormHost);
    el = fixture.nativeElement as HTMLElement;
    await render();
  });

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  // The list is drawn over the question. The click that puts it away lands on the backdrop of the dialog.
  it('is not answered by the click that puts the list away', async () => {
    openSelect(ngSelect(el, 'Estado'));
    let answered: boolean | undefined;
    void TestBed.inject(Confirm)
      .ask({ title: 'Hay cambios sin guardar', confirmLabel: 'Descartar y salir', cancelLabel: 'Seguir editando', danger: true })
      .then((answer) => (answered = answer));
    await render();
    expect(document.querySelector('.ng-dropdown-panel')).not.toBeNull();

    el.querySelector<HTMLElement>('.modal-backdrop')!.click();
    await render();
    expect(document.querySelector('.ng-dropdown-panel')).toBeNull();
    expect(answered).toBeUndefined();
    expect(el.querySelector('[role=alertdialog]')).not.toBeNull();

    el.querySelector<HTMLElement>('.modal-backdrop')!.click();
    await render();
    expect(answered).toBeFalse();
  });
});
