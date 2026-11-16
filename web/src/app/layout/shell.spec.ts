import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import type { WritableSignal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Auth } from '../core/auth';
import { Confirm } from '../core/confirm';
import { Live } from '../core/live';
import { Reminders } from '../core/reminders';
import { Theme } from '../core/theme';
import { answerCatalogs } from '../testing/catalogs';
import { resizeScreen } from '../testing/viewport';
import { Shell } from './shell';

// Every screen asks through Confirm and counts on the shell to draw the question. Without the
// dialog a question is never answered, and what waits for it (deleting a case, leaving a form
// with unsaved changes) never happens. The dialog itself is in confirm.spec.ts.
// A session stored before an administrator changed its role, or before there were roles, shows
// what that user may use as soon as the shell has read the user again.
describe('Shell, with a session', () => {
  afterEach(() => {
    localStorage.removeItem('st.token');
    localStorage.removeItem('st.user');
  });

  it('reads the user of the session again when it opens', async () => {
    localStorage.setItem('st.token', 'token-de-ana');
    localStorage.setItem('st.user', JSON.stringify({ id: 1, username: 'ana', name: 'Ana', role: 'AGENT' }));
    const live: Partial<Live> = { catalogs: signal(0), settings: signal(0), connected: signal(true), start: () => undefined, stop: () => undefined };
    const reminders: Partial<Reminders> = { count: signal(0), start: () => undefined, stop: () => undefined, refreshSoon: () => undefined };
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), { provide: Live, useValue: live }, { provide: Reminders, useValue: reminders }],
    });
    const http = TestBed.inject(HttpTestingController);
    const auth = TestBed.inject(Auth);
    expect(auth.isAdmin()).toBeFalse();

    const fixture = TestBed.createComponent(Shell);
    fixture.detectChanges();
    http.expectOne({ method: 'GET', url: '/api/auth/me' }).flush({ id: 1, username: 'ana', name: 'Ana', role: 'ADMIN' });
    answerCatalogs(http);
    await fixture.whenStable();

    expect(auth.isAdmin()).toBeTrue();
    http.verify();
  });
});

describe('Shell, the frame around every screen', () => {
  let fixture: ComponentFixture<Shell>;
  let el: HTMLElement;
  let http: HttpTestingController;

  beforeEach(async () => {
    // The live updates and the bell stay quiet: both would open connections of their own.
    const live: Partial<Live> = { catalogs: signal(0), settings: signal(0), connected: signal(true), start: () => undefined, stop: () => undefined };
    const reminders: Partial<Reminders> = { count: signal(0), start: () => undefined, stop: () => undefined, refreshSoon: () => undefined };
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), { provide: Live, useValue: live }, { provide: Reminders, useValue: reminders }],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Shell);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    // The shell reads the catalogs every screen shares.
    answerCatalogs(http);
    await show();
  });

  afterEach(() => http.verify());

  async function show(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const question = (): HTMLElement | null => el.querySelector('[role=alertdialog]');

  // The shell of these tests has no session: nothing is read again for it.
  it('reads nothing of a session that is not there', () => {
    http.expectNone('/api/auth/me');
  });

  it('has no question on screen until a screen asks one', () => {
    expect(question()).toBeNull();
  });

  it('draws the question a screen asks through Confirm, and gives it the answer of the person', async () => {
    const answer = TestBed.inject(Confirm).ask({ title: '¿Eliminar el caso SOP-00012?', confirmLabel: 'Eliminar', danger: true });
    await show();

    expect(question()?.textContent).toContain('¿Eliminar el caso SOP-00012?');
    const yes = Array.from(question()!.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Eliminar')!;
    yes.click();
    await show();

    expect(await answer).toBeTrue();
    expect(question()).toBeNull();
  });

  // Seven stops of the Tab key (three on a phone) came before the screen itself, with no way past them.
  it('starts with a link past the menu to the screen, hidden until it has the focus', async () => {
    const focusable = el.querySelector<HTMLElement>('a[href], button, input, [tabindex]:not([tabindex="-1"])')!;
    expect(focusable.textContent?.trim()).toBe('Saltar al contenido');
    expect(getComputedStyle(focusable).position).toBe('absolute');
    focusable.focus();
    expect(getComputedStyle(focusable).position).toBe('fixed');

    focusable.click();
    await show();
    const main = el.querySelector('main')!;
    expect(main.id).toBe('contenido');
    expect(main.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(main);
    // Without going to `#contenido`, which would put it in the address of the screen.
    expect(location.hash).toBe('');
  });

  // "Cambiar tema" did not say which theme was on.
  it('names the theme button of a phone by what it does, as the one of the menu', async () => {
    const button = (): HTMLButtonElement => el.querySelector<HTMLButtonElement>('header button[aria-label^="Tema"]')!;
    const theme = TestBed.inject(Theme);
    expect(button().getAttribute('aria-label')).toBe(theme.dark() ? 'Tema claro' : 'Tema oscuro');

    button().click();
    await show();
    expect(button().getAttribute('aria-label')).toBe(theme.dark() ? 'Tema claro' : 'Tema oscuro');
    theme.toggle();
    await show();
  });

  // The name was cut with an ellipsis, the rest of it nowhere, and the username only in its title.
  it('writes the whole name of who is in, on more lines where it needs them, and the username under it', async () => {
    const name = 'José Ñáñez Villavicencio-Quiñónez, agente de pruebas';
    TestBed.inject(Auth).user.set({ id: 1, username: 'jose.nanez', name, role: 'AGENT' });
    await show();
    const user = el.querySelector<HTMLElement>('aside [data-user]')!;

    expect(Array.from(user.children, (line) => line.textContent?.trim())).toEqual([name, 'jose.nanez']);
    expect(user.querySelector('[title]')).toBeNull();
    for (const line of Array.from(user.children)) expect(getComputedStyle(line).textOverflow).not.toBe('ellipsis');
  });

  // What "En vivo" means, and what to do while it reconnects, was only in its title.
  it('says what the live state of the menu means with its "?"', async () => {
    const help = el.querySelector<HTMLButtonElement>('aside button[aria-label="Ayuda sobre En vivo"]')!;
    const text = el.querySelector<HTMLElement>(`#${help.getAttribute('aria-describedby')}`)!;
    expect(text.textContent?.trim()).toBe('Los cambios de otras personas y del asistente aparecen solos');

    (TestBed.inject(Live).connected as WritableSignal<boolean>).set(false);
    await show();
    expect(help.getAttribute('aria-label')).toBe('Ayuda sobre Reconectando');
    expect(text.textContent?.trim()).toBe('Sin conexión en vivo. Reintentando; mientras tanto recarga para ver cambios');
    help.click();
    await show();
    expect(text.hidden).toBeFalse();
    help.click();
    await show();
  });

  // White on the red of the theme was 3.9:1.
  it('writes the count of the bell in white on a red that holds 4.5:1 with it', async () => {
    (TestBed.inject(Reminders).count as WritableSignal<number>).set(3);
    await show();
    for (const badge of Array.from(el.querySelectorAll<HTMLElement>('.bg-danger-fill'))) {
      expect(badge.textContent?.trim()).toBe('3');
      expect(getComputedStyle(badge).backgroundColor).toBe('rgb(196, 43, 49)');
    }
    expect(el.querySelectorAll('.bg-danger-fill').length).toBe(2);
  });

  // Drawn for real, with the stylesheet of the app, on a screen of the size of each test.
  describe('on the screen', () => {
    const main = (): HTMLElement => el.querySelector('main')!;
    const tabs = (): HTMLElement => el.querySelector('nav.md\\:hidden')!;
    const menuButton = (): HTMLButtonElement => el.querySelector<HTMLButtonElement>('header button[aria-label="Menú"]')!;
    const menu = (): HTMLElement => el.querySelector<HTMLElement>('#short-menu')!;
    /** The frame of the shell. Not at the top of the test page, which has the report of the tests above it. */
    const frame = (): DOMRect => el.querySelector('div')!.getBoundingClientRect();

    /** A screen as long as a list of cases, in the place of the one the router would draw. */
    function fillTheScreen(): void {
      const content = document.createElement('div');
      content.style.height = '1500px';
      main().appendChild(content);
    }

    afterEach(() => window.scrollTo(0, 0));

    // A phone: its bars above and below, the screen scrolling between them.
    it('on a phone keeps its bars in view, and its buttons are of a finger’s size', () => {
      resizeScreen(390, 844);
      fillTheScreen();

      expect(main().scrollHeight).toBeGreaterThan(main().clientHeight);
      expect(frame().height).toBe(844);
      expect(tabs().getBoundingClientRect().bottom).toBe(frame().bottom);
      // The tab bar is the menu: no button for one in the header.
      expect(menuButton().offsetWidth).toBe(0);
      for (const button of Array.from(el.querySelectorAll<HTMLElement>('header button')).filter((shown) => shown.offsetWidth > 0)) {
        expect(button.offsetWidth).withContext(button.getAttribute('aria-label') ?? '').toBeGreaterThanOrEqual(44);
        expect(button.offsetHeight).withContext(button.getAttribute('aria-label') ?? '').toBeGreaterThanOrEqual(44);
      }
    });

    // At 400 % (320 × 200) the header and the tab bar took 117 px of 200, and left the screen 83.
    it('on a short screen lets its header scroll away with the page', () => {
      resizeScreen(320, 200);
      fillTheScreen();

      expect(main().scrollHeight).toBe(main().clientHeight);
      expect(frame().height).toBeGreaterThan(1500);
      main().lastElementChild!.scrollIntoView();
      expect(el.querySelector('header')!.getBoundingClientRect().bottom).toBeLessThanOrEqual(0);
    });

    // After the screen, the tab bar was some 10,000 px down a list of cases at 740 × 360: the four
    // screens are behind a button of the header instead.
    for (const [width, height] of [
      [740, 360],
      [320, 200],
    ]) {
      it(`on a short screen (${width} × ${height}) has the four screens behind "Menú", under the header`, async () => {
        resizeScreen(width, height);
        fillTheScreen();

        // No tab bar after the screen.
        expect(tabs().offsetHeight).toBe(0);
        expect(menuButton().offsetWidth).toBeGreaterThanOrEqual(44);
        expect(menuButton().offsetHeight).toBeGreaterThanOrEqual(44);
        expect(menuButton().getAttribute('aria-expanded')).toBe('false');
        expect(menu().offsetHeight).toBe(0);
        expect(menuButton().getAttribute('aria-controls')).toBe(menu().id);
        // The name of the app on one line, beside the four buttons.
        const title = el.querySelector<HTMLElement>('header span.flex-1')!;
        expect(title.offsetHeight).toBeLessThanOrEqual(parseFloat(getComputedStyle(title).lineHeight) + 0.5);

        menuButton().click();
        await show();

        expect(menuButton().getAttribute('aria-expanded')).toBe('true');
        expect(menu().getAttribute('aria-label')).toBe('Principal');
        expect(Array.from(menu().querySelectorAll('a'), (link) => link.textContent!.trim())).toEqual(['Casos', 'Tablero', 'Dashboard', 'Configuración']);
        // Right under the header, in the first screen of the page.
        const header = el.querySelector('header')!.getBoundingClientRect();
        const shown = menu().getBoundingClientRect();
        expect(shown.top).toBeCloseTo(header.bottom, 0);
        expect(shown.bottom - frame().top).toBeLessThanOrEqual(height);
        for (const link of Array.from(menu().querySelectorAll<HTMLElement>('a'))) {
          expect(link.getBoundingClientRect().right).toBeLessThanOrEqual(width);
        }
        // The one menu of the screen: one landmark named "Principal" in sight.
        expect(Array.from(el.querySelectorAll<HTMLElement>('nav[aria-label="Principal"]')).filter((nav) => nav.offsetHeight > 0)).toEqual([menu()]);

        menuButton().click();
        await show();
        expect(menuButton().getAttribute('aria-expanded')).toBe('false');
        expect(menu().offsetHeight).toBe(0);
      });
    }

    it('on a short screen closes the menu with Escape, which goes no further, and leaves the focus on its button', async () => {
      resizeScreen(740, 360);
      let heard = 0;
      const listen = (): void => void heard++;
      document.addEventListener('keydown', listen);
      menuButton().click();
      await show();
      const link = menu().querySelector<HTMLElement>('a')!;
      link.focus();

      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      link.dispatchEvent(event);
      await show();
      document.removeEventListener('keydown', listen);

      expect(menuButton().getAttribute('aria-expanded')).toBe('false');
      expect(menu().offsetHeight).toBe(0);
      expect(document.activeElement).toBe(menuButton());
      expect(event.defaultPrevented).toBeTrue();
      expect(heard).toBe(0);
    });

    it('keeps the tab bar of a phone of usual height after the screen, and no menu button', () => {
      resizeScreen(375, 812);
      expect(tabs().offsetHeight).toBeGreaterThan(0);
      expect(menuButton().offsetWidth).toBe(0);
      expect(menu().offsetHeight).toBe(0);
    });
  });
});

/** A screen of the menu, in the place of the real one. */
@Component({ changeDetection: ChangeDetectionStrategy.OnPush, template: '' })
class Blank {}

// The link of the screen on was told only by its colours: on the tab bar of a phone, by its hue
// alone (the primary and the muted are as light as each other), and to a screen reader not at all.
describe('Shell, the link of the screen on', () => {
  let fixture: ComponentFixture<Shell>;
  let el: HTMLElement;
  let http: HttpTestingController;

  beforeEach(async () => {
    const live: Partial<Live> = { catalogs: signal(0), settings: signal(0), connected: signal(true), start: () => undefined, stop: () => undefined };
    const reminders: Partial<Reminders> = { count: signal(0), start: () => undefined, stop: () => undefined, refreshSoon: () => undefined };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([
          { path: 'casos', component: Blank },
          { path: 'tablero', component: Blank },
        ]),
        { provide: Live, useValue: live },
        { provide: Reminders, useValue: reminders },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Shell);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    answerCatalogs(http);
    await TestBed.inject(Router).navigateByUrl('/tablero');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  /** The links of a menu, by the text they show. */
  const links = (menu: string): Map<string, HTMLAnchorElement> =>
    new Map(Array.from(el.querySelectorAll<HTMLAnchorElement>(`${menu} a`), (link) => [link.textContent!.trim(), link]));

  it('says which one is the screen on, in the menu, in the tab bar and in the menu of a short screen', () => {
    for (const menu of ['aside nav', 'nav.md\\:hidden', '#short-menu']) {
      const shown = links(menu);
      expect(shown.get('Tablero')!.getAttribute('aria-current')).withContext(menu).toBe('page');
      for (const other of ['Casos', 'Dashboard', 'Configuración']) {
        expect(shown.get(other)!.hasAttribute('aria-current')).withContext(`${menu}: ${other}`).toBeFalse();
      }
    }
  });

  // A link pressed in the menu of a short screen leaves that screen: the menu closes with it.
  it('closes the menu of a short screen when one of its links is pressed, and leaves the focus on its button', async () => {
    resizeScreen(740, 360);
    const button = el.querySelector<HTMLButtonElement>('header button[aria-label="Menú"]')!;
    button.click();
    fixture.detectChanges();
    const casos = links('#short-menu').get('Casos')!;
    casos.focus();

    casos.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(TestBed.inject(Router).url).toBe('/casos');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(el.querySelector<HTMLElement>('#short-menu')!.offsetHeight).toBe(0);
    expect(document.activeElement).toBe(button);
    // The focus may have scrolled the test page to the shell.
    window.scrollTo(0, 0);
  });

  it('marks the tab of the screen on with a line, besides its colour', () => {
    resizeScreen(390, 844);
    const tabs = links('nav.md\\:hidden');
    expect(getComputedStyle(tabs.get('Tablero')!).boxShadow).not.toBe('none');
    expect(getComputedStyle(tabs.get('Casos')!).boxShadow).toBe('none');
  });
});
