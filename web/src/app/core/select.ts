import { DOCUMENT } from '@angular/common';
import { DestroyRef, Directive, ElementRef, NgZone, inject } from '@angular/core';
import {
  NgLabelTemplateDirective,
  NgOptionComponent,
  NgOptionTemplateDirective,
  NgSelectComponent,
  NgSelectConfig,
  NgTagTemplateDirective,
} from '@ng-select/ng-select';

/** What ng-select says by itself, in Spanish. A select can still say something else through its own inputs. */
export const SELECT_TEXTS: NgSelectConfig = Object.assign(new NgSelectConfig(), {
  notFoundText: 'Sin resultados',
  typeToSearchText: 'Escribe para buscar',
  addTagText: 'Crear',
  loadingText: 'Cargando…',
  clearAllText: 'Quitar',
});

/** The dimmed area behind a dialog or a side panel, which closes it when clicked. Known by its class (see styles.css). */
const BACKDROP = '.modal-backdrop, .panel-backdrop';

/**
 * Goes on every ng-select by itself (it matches the tag), for what all of them share:
 *
 * - The texts in Spanish, also in a spec, which does not load the providers of the app.
 * - Escape closes an open list of options and stops there. ng-select lets the key go on to the
 *   document, where the panel or the dialog around the select listens for it and would close
 *   too, with whatever the person was filling in. With the list closed, Escape is theirs again.
 * - The click that puts an open list away stops there too when it lands on a backdrop. ng-select
 *   closes the list and lets the click go on, and the backdrop would close its dialog or panel
 *   with it. With the list closed, the backdrop is clicked as always.
 * - An open list closes when its select is scrolled away from under it. The list hangs where the
 *   select was when it opened (from the body, in most of them) and does not follow it.
 */
@Directive({
  selector: 'ng-select',
  providers: [{ provide: NgSelectConfig, useValue: SELECT_TEXTS }],
})
export class SelectDefaults {
  constructor() {
    const select = inject(NgSelectComponent);
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const document = inject(DOCUMENT);
    const zone = inject(NgZone);

    // On the way down to the search box: on the way up ng-select has already closed the list,
    // and the key cannot be told apart from one pressed with the list closed.
    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || !select.isOpen()) return;
      event.stopPropagation();
      event.preventDefault();
      select.close();
    };

    // On the way down too, and for the same reason: ng-select hears the same click on the
    // document right after this, and closes the list there. The click goes no further.
    const onClick = (event: MouseEvent): void => {
      if (select.isOpen() && event.target instanceof Element && event.target.matches(BACKDROP)) event.stopPropagation();
    };

    /** How far something is scrolled: an element, or the page itself, whose scroll the document tells of. */
    const scrollOf = (scroller: Node): [number, number] =>
      scroller instanceof Element ? [scroller.scrollTop, scroller.scrollLeft] : [document.defaultView?.scrollY ?? 0, document.defaultView?.scrollX ?? 0];
    /**
     * How far everything the select is in was scrolled when its list opened. Not where the select
     * was on screen: that shifts by itself while a list hung from the body waits for its place,
     * since the page is longer for that moment and gets a scrollbar.
     */
    let scrolledAtOpen = new Map<Node, [number, number]>();
    // Taken once ng-select is done opening: it gives the focus to its search box on the way, and
    // the browser scrolls a box that was half out of view into it.
    select.openEvent.subscribe(() =>
      queueMicrotask(() => {
        scrolledAtOpen = new Map();
        for (let around = host.parentNode; around; around = around.parentNode) scrolledAtOpen.set(around, scrollOf(around));
      }),
    );

    // A scroll is heard on the way down, since it does not come back up. Only one of something
    // the select is in takes it away: the list of options scrolls too, and so does the search
    // box under a long text. And only one made after the list opened: the scroll that brought
    // the select into view as it opened is told a moment later.
    const onScroll = ({ target }: Event): void => {
      if (!select.isOpen() || !(target instanceof Node)) return;
      const before = scrolledAtOpen.get(target);
      if (!before) return;
      const [top, left] = scrollOf(target);
      if (top !== before[0] || left !== before[1]) zone.run(() => select.close());
    };

    host.addEventListener('keydown', onKeydown, true);
    // Heard for every click and every scroll of the page: not a reason to check the whole screen.
    zone.runOutsideAngular(() => {
      document.addEventListener('click', onClick, true);
      document.addEventListener('scroll', onScroll, true);
    });
    inject(DestroyRef).onDestroy(() => {
      host.removeEventListener('keydown', onKeydown, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('scroll', onScroll, true);
    });
  }
}

/**
 * What a component imports to use ng-select: `imports: [FormsModule, ...SELECT]`. The select, its
 * `<ng-option>`, the templates the app uses (`ng-option-tmp`, `ng-label-tmp`, `ng-tag-tmp`) and the
 * defaults above.
 */
export const SELECT = [
  NgSelectComponent,
  NgOptionComponent,
  NgOptionTemplateDirective,
  NgLabelTemplateDirective,
  NgTagTemplateDirective,
  SelectDefaults,
] as const;
