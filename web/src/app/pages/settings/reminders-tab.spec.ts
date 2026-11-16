import type { HttpTestingController } from '@angular/common/http/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Auth } from '../../core/auth';
import { httpTestBed } from '../../testing/http';
import { chooseOption, closeSelect, ngSelect, optionTexts, selectedTexts } from '../../testing/ng-select';
import { RemindersTab } from './reminders-tab';
import { isDisabled } from '../../testing/screen';

describe('RemindersTab, the time after which an open case counts as forgotten', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<RemindersTab>;
  let el: HTMLElement;

  beforeEach(() => {
    http = httpTestBed(provideRouter([]));
    // Nobody logged in: the bell, which is read again after every save, asks for nothing here.
    TestBed.inject(Auth).user.set(null);
  });

  afterEach(() => http.verify());

  function render(): void {
    fixture.detectChanges();
    flushMicrotasks();
    fixture.detectChanges();
  }

  function open(staleHours: number): void {
    fixture = TestBed.createComponent(RemindersTab);
    el = fixture.nativeElement as HTMLElement;
    render();
    http.expectOne({ method: 'GET', url: '/api/settings/reminders' }).flush({ staleHours, promiseSoonDays: 0 });
    tick();
    render();
  }

  const amount = (): HTMLInputElement => el.querySelector<HTMLInputElement>('#reminder-amount')!;
  const unit = (): HTMLElement => ngSelect(el, 'reminder-unit');

  /** "Guardar" of the forgotten cases, and what it sends. */
  function save(): unknown {
    el.querySelector<HTMLButtonElement>('form button[type="submit"]')!.click();
    render();
    const request = http.expectOne({ method: 'PUT', url: '/api/settings/reminders' });
    request.flush(null);
    tick(3000);
    return request.request.body;
  }

  // Whole days read better as days.
  it('is shown in days when it is whole days, and in hours otherwise', fakeAsync(() => {
    open(72);
    expect(amount().value).toBe('3');
    expect(selectedTexts(unit())).toEqual(['días']);

    fixture.destroy();
    open(36);
    expect(amount().value).toBe('36');
    expect(selectedTexts(unit())).toEqual(['horas']);
  }));

  it('is counted in hours or in days, one of the two always', fakeAsync(() => {
    open(72);

    expect(el.querySelector('label[for=reminder-unit]')!.textContent).toBe('Unidad');
    expect(optionTexts(unit())).toEqual(['horas', 'días']);
    closeSelect(unit());
    // Not a select to type in or to leave empty.
    expect(unit().querySelector('.ng-clear-wrapper')).toBeNull();
    expect(unit().querySelector('input')!.readOnly).toBeTrue();
  }));

  it('is saved in hours, whatever the unit it was written in', fakeAsync(() => {
    open(72);
    expect(save()).toEqual({ staleHours: 72 });

    chooseOption(unit(), 'horas');
    render();
    expect(save()).toEqual({ staleHours: 3 });
  }));

  it('cannot be changed while the reminder is off', fakeAsync(() => {
    open(0);

    expect(isDisabled(amount())).toBeTrue();
    expect(unit().classList).toContain('ng-select-disabled');
    expect(isDisabled(unit().querySelector('input')!)).toBeTrue();
  }));

  // Dimmed to half, the labels and the unit of the fields that are off read at 2.1:1 (WCAG 1.4.3).
  it('leaves the fields of a reminder that is off readable: the fields say they are off, nothing is dimmed', fakeAsync(() => {
    // Both reminders off: no forgotten cases, and no notice before the promised day.
    open(0);
    expect(isDisabled(el.querySelector<HTMLInputElement>('#promise-days')!)).toBeTrue();

    const texts = [...el.querySelectorAll<HTMLElement>('label.label, span')].filter((text) => ['Tiempo sin movimiento', 'Unidad', 'Días de anticipación', 'día(s) antes'].includes(text.textContent!.trim()));
    expect(texts.length).toBe(4);
    for (const text of texts) {
      for (let box: HTMLElement | null = text; box && box !== el; box = box.parentElement) {
        expect(getComputedStyle(box).opacity).withContext(`${text.textContent!.trim()}: ${box.className}`).toBe('1');
      }
    }
  }));
});
