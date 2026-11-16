import { DOCUMENT } from '@angular/common';
import { DestroyRef, Directive, ElementRef, Injector, afterNextRender, inject } from '@angular/core';
import {
  NgLabelTemplateDirective,
  NgOptionComponent,
  NgOptionTemplateDirective,
  NgSelectComponent,
  NgSelectConfig,
  NgTagTemplateDirective,
} from '@ng-select/ng-select';
import { BACKDROP } from './backdrop-click';

/** What ng-select says by itself, in Spanish. A select can still say something else through its own inputs. */
export const SELECT_TEXTS: NgSelectConfig = Object.assign(new NgSelectConfig(), {
  notFoundText: 'Sin resultados',
  typeToSearchText: 'Escribe para buscar',
  addTagText: 'Crear',
  loadingText: 'Cargando…',
  clearAllText: 'Quitar',
});

/** Room a list of options leaves to the edges of the screen, in px: the 0.75rem of its widest in styles.css. */
const SCREEN_MARGIN = 12;

/** Above or below its select: what ng-select calls the place of a list (and its class, `ng-select-top`). */
type Side = 'top' | 'bottom';

/**
 * The list of options of ng-select, as far as the app moves it to the other side of its select.
 * `_currentPosition` is where the library keeps the side it chose: set, the list stays there when
 * the library places it again (a chip added to the select). `adjustPosition` places a list that
 * hangs from the body against its select, on that side.
 */
interface ListPanel {
  _currentPosition?: string;
  adjustPosition(): void;
}

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
 * - An open list stays inside the screen. It starts where its select starts, and with long options
 *   it is wider than the select (see styles.css): near the right edge of the screen it would go
 *   past it. It is moved left as far as it has to, and never off the left edge of the screen.
 *   ng-select opens it below the select, or above when it does not fit below, even with less room
 *   above: a select of several lines (chips, a long name) on a short screen leaves room for it on
 *   neither side. It then goes to the side with more room, as high as that side allows and never
 *   lower than one option, which scroll inside it. Where not even one option fits, it is moved
 *   over its select as far as it has to for all of it to be on the screen. As it opens, and
 *   whenever its size or the size of its select changes (the person types, adds a chip).
 * - The box the person types in controls the list of options itself, the element with the role of
 *   a listbox: ng-select points it at the frame around that one, which has no role, and nothing
 *   then told who hears it, or a checker such as axe, that the list belonged to the box.
 */
@Directive({
  // eslint-disable-next-line @angular-eslint/directive-selector -- ng-select's own tag, on purpose (see above).
  selector: 'ng-select',
  providers: [{ provide: NgSelectConfig, useValue: SELECT_TEXTS }],
})
export class SelectDefaults {
  constructor() {
    const select = inject(NgSelectComponent);
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const document = inject(DOCUMENT);

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
      if (top !== before[0] || left !== before[1]) select.close();
    };

    /** Moves the open list left as far as it has to for its right edge to stay on the screen. */
    const keepOnScreenSideways = (list: HTMLElement): void => {
      const box = host.getBoundingClientRect();
      const { left, width } = list.getBoundingClientRect();
      const rightmost = document.documentElement.clientWidth - SCREEN_MARGIN - width;
      // Where the select starts, unless that is too far right; and not left of the screen's margin,
      // unless the select itself starts there.
      const wanted = Math.max(Math.min(box.left, rightmost), Math.min(box.left, SCREEN_MARGIN));
      // `left` is counted from what the list is placed in (the body, or the select): moved by the difference.
      if (Math.abs(wanted - left) >= 0.5) list.style.left = `${parseFloat(getComputedStyle(list).left) + wanted - left}px`;
    };

    /** Puts the open list on the other side of its select, where ng-select will keep it. */
    const moveTo = (list: HTMLElement, side: Side): void => {
      for (const element of [list, host]) {
        element.classList.remove('ng-select-top', 'ng-select-bottom');
        element.classList.add(`ng-select-${side}`);
      }
      const panel = select.dropdownPanel() as ListPanel | undefined;
      if (!panel) return;
      panel._currentPosition = side;
      // Hung from the body, the list is placed by ng-select; inside its select, by its class (styles.css).
      if (list.parentElement !== host) panel.adjustPosition();
    };

    /**
     * The least the box of the options of the open list is high: one option, the one the list opened
     * on. Null until ng-select has chosen a side in this opening; from then on the side stays.
     */
    let least: number | null = null;

    /**
     * Keeps the open list on the screen: moved left as far as it has to for its right edge to stay
     * on it; on the side of its select with more room when it does not fit where ng-select put it;
     * no higher than that side leaves room for, and never lower than one option; over its select
     * when even that does not fit. `highest` is the height styles.css gives its options.
     */
    const keepInScreen = (list: HTMLElement, highest: number): void => {
      if (!list.isConnected) return;
      keepOnScreenSideways(list);

      // Only once ng-select has chosen the side, a moment after the list is drawn.
      const options = list.querySelector<HTMLElement>('.ng-dropdown-panel-items');
      let side: Side | null = list.classList.contains('ng-select-top') ? 'top' : list.classList.contains('ng-select-bottom') ? 'bottom' : null;
      if (!options || !side) return;
      list.style.transform = '';
      const box = host.getBoundingClientRect();
      const screen = document.documentElement.clientHeight;
      // The list is a frame around its options (see styles.css): its padding is in the room too.
      const frame = list.offsetHeight - options.offsetHeight;
      const room = { top: box.top - SCREEN_MARGIN - frame, bottom: screen - box.bottom - SCREEN_MARGIN - frame };
      // The box of the options, its padding and its border, around what it holds.
      const style = getComputedStyle(options);
      const edges = options.offsetHeight - options.clientHeight + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const opening = least === null;
      const marked = options.querySelector<HTMLElement>('.ng-option-marked') ?? options.querySelector<HTMLElement>('.ng-option');
      if (opening) {
        const whole = Math.min(highest, options.scrollHeight + options.offsetHeight - options.clientHeight);
        least = Math.min(whole, (marked?.offsetHeight ?? 0) + edges);
        const other: Side = side === 'top' ? 'bottom' : 'top';
        if (whole > room[side] && room[other] > room[side]) {
          side = other;
          moveTo(list, side);
        }
      }

      // Not from what the list holds, which changes as the person types: the box is as high as that, up to this.
      const fit = `${Math.round(Math.max(least ?? 0, Math.min(highest, room[side])))}px`;
      if (options.style.maxHeight !== fit) options.style.maxHeight = fit;

      // Not even one option fits on that side: over the select, as far as it takes to be on the screen.
      const shown = list.getBoundingClientRect();
      const margin = Math.min(SCREEN_MARGIN, Math.max(0, (screen - shown.height) / 2));
      const shift = shown.top < margin ? margin - shown.top : shown.bottom > screen - margin ? screen - margin - shown.bottom : 0;
      if (Math.abs(shift) >= 0.5) list.style.transform = `translateY(${Math.round(shift)}px)`;

      // The option the list opened on, in view in the list as high as it now is.
      if (opening && marked && marked.offsetTop + marked.offsetHeight > options.scrollTop + options.clientHeight) {
        options.scrollTop = marked.offsetTop + marked.offsetHeight - options.clientHeight;
      }
    };
    let resized: ResizeObserver | undefined;
    let frame = 0;
    const stopWatching = (): void => {
      resized?.disconnect();
      resized = undefined;
      cancelAnimationFrame(frame);
      frame = 0;
    };
    // Once the list is on the page: it is drawn after the select says it opened.
    const injector = inject(Injector);
    select.openEvent.subscribe(() =>
      afterNextRender(
        () => {
          const list = document.getElementById(select.dropdownId);
          if (!list || !select.isOpen()) return;
          const listbox = list.querySelector<HTMLElement>('[role=listbox]');
          const box = host.querySelector<HTMLInputElement>('input[role=combobox]');
          if (listbox && box) {
            listbox.id ||= `${select.dropdownId}-options`;
            box.setAttribute('aria-controls', listbox.id);
          }
          const options = list.querySelector('.ng-dropdown-panel-items');
          const highest = options ? parseFloat(getComputedStyle(options).maxHeight) : Infinity;
          least = null;
          keepInScreen(list, highest);
          // ng-select chooses the side in a microtask of its own, queued as the list was drawn: after it.
          queueMicrotask(() => keepInScreen(list, highest));
          stopWatching();
          // In the next frame: a list made lower while the browser tells of new sizes is one more
          // size to tell, which it leaves for later with an error ("ResizeObserver loop").
          resized = new ResizeObserver(() => {
            if (frame) return;
            frame = requestAnimationFrame(() => {
              frame = 0;
              keepInScreen(list, highest);
            });
          });
          resized.observe(list);
          // A chip added or taken out makes the select higher or lower, and the room around it with it.
          resized.observe(host);
        },
        { injector },
      ),
    );
    select.closeEvent.subscribe(stopWatching);

    /*
     * Sideways, the list is also kept on the screen the moment it is on the page, before anything
     * is drawn or pressed: the render above comes later. ng-select puts it at the left of its
     * select, as wide as its options, and on a phone a select on the right half of the screen (the
     * responsible, the module of the case panel) had it past the right edge until then. A phone
     * lays out a page wider than its screen again, wider: the select moved from under the finger,
     * the end of the tap that opened the list landed outside it, and ng-select closed the list.
     */
    let placing: MutationObserver | undefined;
    const stopPlacing = (): void => {
      placing?.disconnect();
      placing = undefined;
    };
    select.openEvent.subscribe(() => {
      stopPlacing();
      placing = new MutationObserver(() => {
        const list = document.getElementById(select.dropdownId);
        if (!list) return;
        stopPlacing();
        keepOnScreenSideways(list);
      });
      placing.observe(document.body, { childList: true, subtree: true });
    });
    select.closeEvent.subscribe(stopPlacing);

    // Plain listeners: hearing every click and every scroll of the page checks no screen. Closing
    // the list does, by itself: ng-select keeps whether it is open in a signal.
    host.addEventListener('keydown', onKeydown, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('scroll', onScroll, true);
    inject(DestroyRef).onDestroy(() => {
      host.removeEventListener('keydown', onKeydown, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('scroll', onScroll, true);
      stopWatching();
      stopPlacing();
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
