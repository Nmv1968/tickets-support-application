import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { said } from '../testing/screen';
import { Announcements, Announcer, REGION_IDS, SAID_MS, Say, spokenText } from './announcer';
import type { Politeness } from './announcer';
import { Icon } from './icon';

/**
 * A page with the regions of the Announcer and dialogs that open and close: the case panel, with a
 * box of its own that it already owns, and a question over it.
 */
@Component({
  imports: [Announcements],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main>
      @if (panel()) {
        <div id="panel" role="dialog" aria-modal="true" aria-label="Caso" aria-owns="panel-extra">
          <button type="button">Cerrar</button>
          @if (image()) {
            <div id="image" role="dialog" aria-modal="true" aria-label="Imagen"><button type="button">Cerrar</button></div>
          }
        </div>
      }
      <div id="panel-extra"></div>
      @if (question()) {
        <div id="question" role="alertdialog" aria-modal="true" aria-label="¿Eliminar?"><button type="button">Cancelar</button></div>
      }
    </main>
    <app-announcements />
  `,
})
class Page {
  readonly panel = signal(false);
  readonly image = signal(false);
  readonly question = signal(false);
}

describe('Announcer', () => {
  let fixture: ComponentFixture<Page>;
  let announcer: Announcer;
  const page = (): Page => fixture.componentInstance;
  const byId = (id: string): HTMLElement | null => document.getElementById(id);
  const owns = (id: string): string | null => byId(id)?.getAttribute('aria-owns') ?? null;
  /** What a region holds now, oldest first. */
  const inRegion = (politeness: Politeness): string[] => {
    fixture.detectChanges();
    return Array.from(byId(REGION_IDS[politeness])!.children, (child) => child.textContent!.trim());
  };
  /** Every id a dialog on the page owns is on the page: an `aria-owns` that points at nothing is an error (axe). */
  const ownedOnPage = (): boolean =>
    Array.from(document.querySelectorAll('[aria-owns]')).every((owner) => owner.getAttribute('aria-owns')!.split(' ').every((id) => !!byId(id)));
  const open = (dialog: 'panel' | 'image' | 'question'): void => {
    page()[dialog].set(true);
    fixture.detectChanges();
  };
  const close = (dialog: 'panel' | 'image' | 'question'): void => {
    page()[dialog].set(false);
    fixture.detectChanges();
  };

  beforeEach(() => {
    fixture = TestBed.createComponent(Page);
    fixture.detectChanges();
    announcer = TestBed.inject(Announcer);
  });

  it('has a region of each politeness, on the page from the start, empty', () => {
    expect(byId(REGION_IDS.polite)?.getAttribute('aria-live')).toBe('polite');
    expect(byId(REGION_IDS.assertive)?.getAttribute('aria-live')).toBe('assertive');
    expect(inRegion('polite')).toEqual([]);
    expect(inRegion('assertive')).toEqual([]);
  });

  it('lends nothing to anyone with no dialog open', fakeAsync(() => {
    announcer.say('Caso actualizado');
    expect(inRegion('polite')).toEqual(['Caso actualizado']);
    expect(document.querySelectorAll(`[aria-owns~="${REGION_IDS.polite}"]`).length).toBe(0);
    tick(SAID_MS);
  }));

  // VoiceOver takes what is outside an open aria-modal dialog for inert: a toast said over the panel went unheard.
  describe('with a modal dialog open', () => {
    it('lends the region of a message to the dialog while the message is in it, with what the dialog owned before', fakeAsync(() => {
      open('panel');
      expect(owns('panel')).toBe('panel-extra');

      announcer.say('Caso actualizado');
      // Before the message is drawn in it: the screen reader finds the region in the dialog when the message comes.
      expect(owns('panel')).toBe(`panel-extra ${REGION_IDS.polite}`);
      expect(inRegion('polite')).toEqual(['Caso actualizado']);
      expect(ownedOnPage()).toBeTrue();

      tick(SAID_MS);
      expect(inRegion('polite')).toEqual([]);
      expect(owns('panel')).toBe('panel-extra');
    }));

    it('lends the region of each politeness apart, each until its own last message goes', fakeAsync(() => {
      open('panel');
      const error = announcer.say('No se pudo guardar el caso', 'assertive', null);
      expect(owns('panel')).toBe(`panel-extra ${REGION_IDS.assertive}`);

      announcer.say('Caso actualizado');
      announcer.say('Observación agregada', 'polite', SAID_MS * 2);
      expect(owns('panel')).toBe(`panel-extra ${REGION_IDS.assertive} ${REGION_IDS.polite}`);
      tick(SAID_MS);
      // The second message of the polite region is still in it.
      expect(inRegion('polite')).toEqual(['Observación agregada']);
      expect(owns('panel')).toBe(`panel-extra ${REGION_IDS.assertive} ${REGION_IDS.polite}`);
      tick(SAID_MS);
      expect(owns('panel')).toBe(`panel-extra ${REGION_IDS.assertive}`);

      announcer.unsay(error);
      expect(owns('panel')).toBe('panel-extra');
    }));

    it('lends it to the topmost dialog only: the question over the panel, the image inside it', fakeAsync(() => {
      open('panel');
      open('question');
      announcer.say('Escribe el motivo.');
      expect(owns('question')).toBe(REGION_IDS.polite);
      expect(owns('panel')).toBe('panel-extra');
      tick(SAID_MS);
      expect(owns('question')).toBeNull();
      close('question');

      open('image');
      announcer.say('Imagen descargada');
      expect(owns('image')).toBe(REGION_IDS.polite);
      expect(owns('panel')).toBe('panel-extra');
      tick(SAID_MS);
      expect(owns('image')).toBeNull();
    }));

    // A region has one owner: the dialog that was topmost when its first message came may not be any more.
    it('moves it to the dialog on top when another message comes, and gives it back to the one below', fakeAsync(() => {
      open('panel');
      announcer.say('Caso actualizado');
      expect(owns('panel')).toBe(`panel-extra ${REGION_IDS.polite}`);

      open('question');
      announcer.say('Escribe el motivo.');
      expect(owns('question')).toBe(REGION_IDS.polite);
      expect(owns('panel')).toBe('panel-extra');
      expect(document.querySelectorAll(`[aria-owns~="${REGION_IDS.polite}"]`).length).toBe(1);
      tick(SAID_MS);
      expect(owns('question')).toBeNull();
      expect(owns('panel')).toBe('panel-extra');
    }));

    it('leaves nothing pointing at it once the dialog it was lent to closes, and lends it to the next one', fakeAsync(() => {
      open('panel');
      announcer.say('Caso actualizado', 'polite', null);
      open('question');
      announcer.say('Escribe el motivo.', 'polite', null);
      close('question');
      // The message is still in the region, which is on the page again, and still points at nothing that is gone.
      expect(owns('panel')).toBe('panel-extra');
      expect(ownedOnPage()).toBeTrue();

      announcer.say('Caso eliminado');
      expect(owns('panel')).toBe(`panel-extra ${REGION_IDS.polite}`);
      close('panel');
      expect(ownedOnPage()).toBeTrue();
      expect(document.querySelectorAll('[aria-owns]').length).toBe(0);
      tick(SAID_MS);
    }));
  });
});

// Without the regions on the page (a spec of one component), a dialog is lent nothing: its aria-owns would point at nothing.
describe('Announcer without its regions on the page', () => {
  @Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `<div id="lonely" role="dialog" aria-modal="true" aria-label="Caso"></div>`,
  })
  class Lonely {}

  it('lends nothing', fakeAsync(() => {
    TestBed.createComponent(Lonely).detectChanges();
    TestBed.inject(Announcer).say('Caso actualizado');
    expect(document.getElementById('lonely')!.hasAttribute('aria-owns')).toBeFalse();
    expect(said()).toEqual(['Caso actualizado']);
    tick(SAID_MS);
  }));
});

/** Messages that come on screen with their words, as an `@if` brings them. */
@Component({
  imports: [Say, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (notice()) {
      <p id="notice" appSay>
        <span><app-icon name="alert-outline" /> Este caso cambió en otra pantalla.</span>
        <span aria-hidden="true">(visto)</span>
        <span class="sr-only"> Pulsa el botón para verlo.</span>
        <button type="button">Ver la versión actual</button>
        {{ count() }}
      </p>
    }
    @if (error()) {
      <p id="error" [appSay]="error()" sayAs="assertive">{{ error() }}</p>
    }
  `,
})
class Messages {
  readonly notice = signal(false);
  readonly count = signal(1);
  readonly error = signal('');
}

describe('Say', () => {
  let fixture: ComponentFixture<Messages>;
  const messages = (): Messages => fixture.componentInstance;
  const announcer = (): Announcer => TestBed.inject(Announcer);
  const politenessOf = (text: string): Politeness | undefined =>
    announcer()
      .said()
      .find((item) => item.text === text)?.politeness;

  beforeEach(() => {
    fixture = TestBed.createComponent(Messages);
    fixture.detectChanges();
  });

  // A live region that came with its words may say nothing; one that held a button read it out with them.
  it('says what a message shows a screen reader as it comes, buttons and hidden parts aside, politely', fakeAsync(() => {
    messages().notice.set(true);
    fixture.detectChanges();

    const words = 'Este caso cambió en otra pantalla. Pulsa el botón para verlo. 1';
    expect(said()).toEqual([words]);
    expect(politenessOf(words)).toBe('polite');
    expect(document.getElementById('notice')!.hasAttribute('role')).toBeFalse();
    expect(document.getElementById('notice')!.hasAttribute('aria-live')).toBeFalse();
    tick(SAID_MS);
    expect(said()).toEqual([]);
  }));

  it('says it once, whatever it shows later, and takes it out of its region when it leaves the screen', fakeAsync(() => {
    messages().notice.set(true);
    fixture.detectChanges();
    messages().count.set(2);
    fixture.detectChanges();
    expect(said().length).toBe(1);
    expect(said()[0]).toMatch(/ 1$/);

    messages().notice.set(false);
    fixture.detectChanges();
    expect(said()).toEqual([]);
  }));

  it('says it again, alone, each time what it follows changes: at once for an error', fakeAsync(() => {
    messages().error.set('Usuario o contraseña incorrectos');
    fixture.detectChanges();
    expect(said()).toEqual(['Usuario o contraseña incorrectos']);
    expect(politenessOf('Usuario o contraseña incorrectos')).toBe('assertive');

    messages().error.set('El servidor no respondió');
    fixture.detectChanges();
    expect(said()).toEqual(['El servidor no respondió']);

    // Gone and back with the same words (sent again, failed again): said again.
    messages().error.set('');
    fixture.detectChanges();
    expect(said()).toEqual([]);
    messages().error.set('El servidor no respondió');
    fixture.detectChanges();
    expect(said()).toEqual(['El servidor no respondió']);
    tick(SAID_MS);
  }));
});

describe('spokenText', () => {
  it('is the text of an element as a screen reader reads it: without what is aria-hidden, with single spaces', () => {
    const element = document.createElement('p');
    element.innerHTML = ' Faltan <b>3</b>\n casos <span aria-hidden="true">•</span><span>más</span> <button type="button">Ver</button><a href="/casos">Casos</a> ';
    expect(spokenText(element)).toBe('Faltan 3 casos más');
  });
});
