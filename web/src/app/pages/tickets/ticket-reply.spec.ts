import type { ComponentFixture } from '@angular/core/testing';
import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { screenOf, toasts } from '../../testing/screen';
import { TicketReply } from './ticket-reply';

interface State {
  reply: string;
  storedReply: string | null;
  replying: boolean;
  aiReady: boolean;
  unsaved: boolean;
}

// The block shows the reply of the draft and tells what the person does; copying is its own.
// The panel spec tries the AI and the save of the reply.
describe('TicketReply', () => {
  let fixture: ComponentFixture<TicketReply>;
  let el: HTMLElement;
  /** What the block told, in the order it told it. */
  let told: string[];

  function render(): void {
    fixture.detectChanges();
    flushMicrotasks();
    fixture.detectChanges();
  }

  function create(state: Partial<State> = {}): void {
    fixture = TestBed.createComponent(TicketReply);
    el = fixture.nativeElement as HTMLElement;
    const given: State = { reply: '', storedReply: null, replying: false, aiReady: true, unsaved: false, ...state };
    for (const [name, value] of Object.entries(given)) fixture.componentRef.setInput(name, value);
    told = [];
    fixture.componentInstance.reply.subscribe((value) => told.push(`reply ${value}`));
    fixture.componentInstance.generate.subscribe(() => told.push('generate'));
    render();
  }

  function give(name: keyof State, value: State[keyof State]): void {
    fixture.componentRef.setInput(name, value);
    render();
  }

  const { find, button, click, type } = screenOf(() => el, render);
  const box = (): HTMLTextAreaElement => find('textarea[aria-label="Respuesta para el cliente"]');

  it('shows the reply of the draft, and gives back what is written in its box', fakeAsync(() => {
    create({ reply: 'Ya puede imprimir.' });
    expect(box().value).toBe('Ya puede imprimir.');

    type(box(), 'Ya puede imprimir desde el lunes.');
    expect(told).toEqual(['reply Ya puede imprimir desde el lunes.']);
  }));

  describe('the button of the AI', () => {
    it('drafts the message when the case has none, and drafts it again when it has one', fakeAsync(() => {
      create();
      click(button('Generar con IA'));
      expect(told).toEqual(['generate']);

      give('storedReply', 'Ya puede imprimir.');
      expect(button('Volver a generar').disabled).toBeFalse();
    }));

    it('says it is writing, and cannot be pressed again meanwhile', fakeAsync(() => {
      create({ replying: true });

      expect(button('Redactando…').disabled).toBeTrue();
      expect(find('button app-icon').getAttribute('data-icon')).toBe('loading');
    }));

    it('says what it does', fakeAsync(() => {
      create();

      expect(button('Generar con IA').title).toBe('Redacta el mensaje con el caso y sus observaciones');
      expect(el.textContent).not.toContain('Para redactarlo con IA');
    }));

    // The AI writes from the stored case: it would leave out what the person is changing.
    it('waits for unsaved changes to be saved or discarded, and says why', fakeAsync(() => {
      create({ unsaved: true });

      expect(button('Generar con IA').disabled).toBeTrue();
      expect(button('Generar con IA').title).toBe('Actualiza o descarta los cambios primero: la IA redacta con el caso guardado');
      expect(el.textContent).toContain('Para redactarlo con IA, actualiza o descarta antes los cambios: la IA lee el caso guardado.');
    }));

    it('says where to turn it on when no AI provider is active, and nothing about the changes', fakeAsync(() => {
      create({ aiReady: false, unsaved: true });

      expect(button('Generar con IA').disabled).toBeTrue();
      expect(button('Generar con IA').title).toBe('Activa un proveedor en Configuración > IA');
      expect(el.textContent).not.toContain('Para redactarlo con IA');
    }));
  });

  describe('"Copiar"', () => {
    it('has nothing to copy while the box holds only spaces', fakeAsync(() => {
      create({ reply: '   ' });

      expect(button('Copiar').disabled).toBeTrue();
    }));

    it('copies the reply as it is in its box, spaces around it aside, and says so for two seconds', fakeAsync(() => {
      spyOn(navigator.clipboard, 'writeText').and.resolveTo();
      create({ reply: ' Ya puede imprimir. ' });
      click(button('Copiar'));

      expect(navigator.clipboard.writeText).toHaveBeenCalledOnceWith('Ya puede imprimir.');
      expect(button('Copiado')).toBeDefined();
      tick(1999);
      render();
      expect(button('Copiado')).toBeDefined();
      tick(1);
      render();
      expect(button('Copiar')).toBeDefined();
    }));

    // The two seconds are a timer, and the app has no zone to tell Angular when it fires: the
    // label comes back on screen because it is a signal.
    it('goes back to "Copiar" on screen by itself, with nobody checking the screen', fakeAsync(() => {
      spyOn(navigator.clipboard, 'writeText').and.resolveTo();
      create({ reply: 'Ya puede imprimir.' });
      click(button('Copiar'));
      expect(button('Copiado')).toBeDefined();

      tick(2000);

      expect(button('Copiar')).toBeDefined();
    }));

    it('copied again, says so for two seconds from the second copy', fakeAsync(() => {
      spyOn(navigator.clipboard, 'writeText').and.resolveTo();
      create({ reply: 'Ya puede imprimir.' });
      click(button('Copiar'));
      tick(1500);
      click(button('Copiado'));

      tick(1999);
      render();
      expect(button('Copiado')).toBeDefined();
      tick(1);
      render();
      expect(button('Copiar')).toBeDefined();
    }));

    it('that could not copy says how to do it by hand', fakeAsync(() => {
      spyOn(navigator.clipboard, 'writeText').and.rejectWith(new Error('Not allowed'));
      spyOn(document, 'execCommand').and.returnValue(false);
      create({ reply: 'Ya puede imprimir.' });
      click(button('Copiar'));

      expect(toasts()).toEqual(['No se pudo copiar. Selecciona el texto y usa Ctrl+C.']);
      expect(button('Copiar')).toBeDefined();
    }));

    it('leaves nothing behind when the block goes away before the two seconds', fakeAsync(() => {
      spyOn(navigator.clipboard, 'writeText').and.resolveTo();
      const timers = spyOn(window, 'setTimeout').and.callThrough();
      const cleared = spyOn(window, 'clearTimeout').and.callThrough();
      create({ reply: 'Ya puede imprimir.' });
      click(button('Copiar'));
      const mark = timers.calls.all().find((call) => call.args[1] === 2000)!.returnValue;

      fixture.destroy();
      expect(cleared).toHaveBeenCalledWith(mark);
    }));
  });
});
