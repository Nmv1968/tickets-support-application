import { ChangeDetectionStrategy, Component, Injector, inject, signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { heardOnFocus, said } from '../testing/screen';
import { SAID_MS } from './announcer';
import { focusAfterRender, focusLost, focusProblem } from './focus';
import { STATUS_DELAY_MS, Status } from './status';

/** A button that swaps itself for another one when pressed, as "Iniciar cronómetro" does. */
@Component({
  imports: [Status],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (running()) {
      <button id="stop" type="button" (click)="swap()">Detener</button>
    } @else {
      <button id="start" type="button" (click)="swap()">Iniciar</button>
    }
    <h2 id="heading">Título</h2>
    <h2 id="target" tabindex="-1">Destino</h2>
    <input id="other" />
    <app-status>{{ running() ? 'En marcha' : '' }}</app-status>
  `,
})
class Host {
  readonly running = signal(false);
  readonly injector = inject(Injector);

  swap(): void {
    this.running.update((running) => !running);
    focusAfterRender(this.injector, () => document.getElementById('missing'), () => document.getElementById('heading'), () => document.getElementById(this.running() ? 'stop' : 'start'));
  }
}

describe('focusAfterRender', () => {
  let fixture: ComponentFixture<Host>;
  let el: HTMLElement;
  const find = (id: string): HTMLElement => el.querySelector<HTMLElement>(`#${id}`)!;

  beforeEach(() => {
    fixture = TestBed.createComponent(Host);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  it('gives the focus to the first target on the screen that can take it, once the screen is drawn again', async () => {
    find('start').focus();
    find('start').click();
    await fixture.whenStable();

    // Not the one that is not there, nor a heading without tabindex: the button that took the place of the one pressed.
    expect(document.activeElement).toBe(find('stop'));
  });

  it('does nothing when the focus is somewhere: the person put it there', async () => {
    find('start').focus();
    find('start').click();
    find('other').focus();
    await fixture.whenStable();

    expect(document.activeElement).toBe(find('other'));
  });

  it('tells when the focus is lost', () => {
    find('start').focus();
    expect(focusLost()).toBeFalse();
    find('start').remove();
    expect(focusLost()).toBeTrue();
  });
});

/** A form that marks its field only once it is sent, as the login does. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <input id="name" [attr.aria-invalid]="tried() ? 'true' : null" [attr.aria-describedby]="tried() ? 'name-error' : null" />
    @if (tried()) {
      <p id="name-error">Escribe el nombre.</p>
    }
    <button id="send" type="button" (click)="send()">Agregar</button>
  `,
})
class Form {
  readonly tried = signal(false);
  private readonly injector = inject(Injector);

  send(): void {
    this.tried.set(true);
    focusProblem(this.injector, () => document.getElementById('name'), 'Escribe el nombre.');
  }
}

describe('focusProblem', () => {
  let fixture: ComponentFixture<Form>;
  const find = (id: string): HTMLElement => (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(`#${id}`)!;

  beforeEach(() => {
    fixture = TestBed.createComponent(Form);
    fixture.detectChanges();
  });

  // Given before the screen was drawn again, the focus found the field with no message yet.
  it('gives the focus to the field once its message is on the screen and tied to it', fakeAsync(() => {
    const heard = heardOnFocus(find('name'));
    find('send').focus();
    find('send').click();
    expect(document.activeElement).toBe(find('send'));

    fixture.detectChanges();
    expect(document.activeElement).toBe(find('name'));
    expect(heard).toEqual(['Escribe el nombre.']);
    expect(said()).toEqual([]);
  }));

  // A field that already has the focus says nothing when it gets it again.
  it('says the message when the field already has the focus, for a moment', fakeAsync(() => {
    find('name').focus();
    find('send').click();
    fixture.detectChanges();
    expect(document.activeElement).toBe(find('name'));
    expect(said()).toEqual(['Escribe el nombre.']);

    // Said again when sent again: each time is a message of its own.
    find('send').click();
    fixture.detectChanges();
    expect(said()).toEqual(['Escribe el nombre.', 'Escribe el nombre.']);
    tick(SAID_MS);
    expect(said()).toEqual([]);
  }));
});

describe('Status', () => {
  it('is a region read out politely, and whole, that is always on the screen', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const status = (fixture.nativeElement as HTMLElement).querySelector('app-status')!;

    expect(status.getAttribute('role')).toBe('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.getAttribute('aria-atomic')).toBe('true');
    expect(status.textContent?.trim()).toBe('');
  });

  // The "Cargando…" of a panel was there as the panel opened, with its status: a screen reader may say nothing of that.
  it('comes empty, and what it holds goes in a moment later, as a change a screen reader hears', fakeAsync(() => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.running.set(true);
    fixture.detectChanges();
    const status = (fixture.nativeElement as HTMLElement).querySelector('app-status')!;
    expect(status.textContent?.trim()).toBe('');

    tick(STATUS_DELAY_MS - 1);
    fixture.detectChanges();
    expect(status.textContent?.trim()).toBe('');
    tick(1);
    fixture.detectChanges();
    expect(status.textContent?.trim()).toBe('En marcha');

    fixture.componentInstance.running.set(false);
    fixture.detectChanges();
    expect(status.textContent?.trim()).toBe('');
  }));
});
