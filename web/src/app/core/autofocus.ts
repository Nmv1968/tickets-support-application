import { Directive, ElementRef, afterNextRender, inject } from '@angular/core';

/** Focuses the element when it appears. For inputs created by an `@if`. */
@Directive({ selector: '[appAutofocus]' })
export class Autofocus {
  constructor() {
    const element = inject<ElementRef<HTMLElement>>(ElementRef);
    afterNextRender(() => element.nativeElement.focus());
  }
}
