import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { mdiLoading, mdiPlus } from '@mdi/js';
import { Icon } from './icon';
import type { IconName } from './icons';

/** An icon in a line of text, with a mark on the baseline of the line. */
@Component({
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p [style.font-size.px]="size()" [style.line-height]="lineHeight()" style="color: rgb(229, 72, 77)">
      <span class="baseline" style="display: inline-block; width: 0; height: 0"></span>
      <app-icon [name]="name()" [label]="label()" [spin]="spin()" />
    </p>
  `,
})
class Line {
  readonly name = signal<IconName>('plus');
  readonly label = signal<string | undefined>(undefined);
  readonly spin = signal(false);
  readonly size = signal(16);
  readonly lineHeight = signal('1.5');
}

describe('Icon', () => {
  let fixture: ComponentFixture<Line>;
  let line: Line;
  const icon = (): HTMLElement => (fixture.nativeElement as HTMLElement).querySelector('app-icon')!;
  const svg = (): SVGSVGElement => icon().querySelector('svg')!;

  beforeEach(() => {
    fixture = TestBed.createComponent(Line);
    line = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('draws the icon of Material Design Icons it names, and follows the name', () => {
    expect(svg().getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg().querySelector('path')!.getAttribute('d')).toBe(mdiPlus);
    expect(icon().getAttribute('data-icon')).toBe('plus');

    line.name.set('loading');
    fixture.detectChanges();
    expect(svg().querySelector('path')!.getAttribute('d')).toBe(mdiLoading);
    expect(icon().getAttribute('data-icon')).toBe('loading');
  });

  it('is as big as the text and in its colour', () => {
    line.size.set(20);
    fixture.detectChanges();

    const box = svg().getBoundingClientRect();
    expect(box.width).toBe(20);
    expect(box.height).toBe(20);
    expect(getComputedStyle(svg().querySelector('path')!).fill).toBe('rgb(229, 72, 77)');
  });

  it('is hidden from screen readers, unless it is given a name to say', () => {
    expect(icon().getAttribute('aria-hidden')).toBe('true');
    expect(icon().getAttribute('role')).toBeNull();
    expect(icon().getAttribute('aria-label')).toBeNull();

    line.label.set('Prioridad Alta');
    fixture.detectChanges();
    expect(icon().getAttribute('role')).toBe('img');
    expect(icon().getAttribute('aria-label')).toBe('Prioridad Alta');
    expect(icon().getAttribute('aria-hidden')).toBeNull();
    // The name is said by the element, not written in it: the text of a button with an icon stays its own.
    expect(icon().textContent).toBe('');
  });

  it('turns while something loads, and any other one when it is asked to', () => {
    const turning = (): boolean => getComputedStyle(svg()).animationName !== 'none';
    expect(turning()).toBeFalse();

    line.name.set('loading');
    fixture.detectChanges();
    expect(turning()).toBeTrue();
    expect(getComputedStyle(svg()).animationDuration).toBe('2s');
    expect(getComputedStyle(svg()).animationIterationCount).toBe('infinite');
    // Around its centre, where it stays.
    expect(getComputedStyle(svg()).transformOrigin).toBe('8px 8px');

    line.name.set('refresh');
    fixture.detectChanges();
    expect(turning()).toBeFalse();
    line.spin.set(true);
    fixture.detectChanges();
    expect(turning()).toBeTrue();
  });

  // Where the icon font that came before drew its glyphs, measured in Chrome for these sizes and
  // line heights: how far its box reached above and below the baseline. A line, a button or a
  // badge with an icon is as tall as it was, and its icon where it was.
  const FONT_BOXES: { size: number; lineHeight: string; above: number; below: number }[] = [
    { size: 16, lineHeight: '1.5', above: 18, below: 6 },
    { size: 18, lineHeight: '1', above: 16, below: 2 },
    { size: 14, lineHeight: '1.25', above: 13, below: 4.5 },
    { size: 12, lineHeight: '20px', above: 14, below: 6 },
    { size: 20, lineHeight: '1.4', above: 21, below: 7 },
    { size: 14, lineHeight: '1.5556', above: 15, below: 6.766 },
    { size: 48, lineHeight: '1', above: 42, below: 6 },
  ];
  for (const { size, lineHeight, above, below } of FONT_BOXES) {
    it(`sits on the baseline as the icon font did, at ${size}px with a line height of ${lineHeight}`, () => {
      line.size.set(size);
      line.lineHeight.set(lineHeight);
      fixture.detectChanges();

      const baseline = (fixture.nativeElement as HTMLElement).querySelector('.baseline')!.getBoundingClientRect().bottom;
      const square = svg().getBoundingClientRect();
      const style = getComputedStyle(svg());
      // The square of the icon: 0.875em above the baseline, 0.125em below it.
      expect(baseline - square.top).toBeCloseTo(size * 0.875, 1);
      expect(square.bottom - baseline).toBeCloseTo(size * 0.125, 1);
      // Its box in the line.
      expect(baseline - (square.top - parseFloat(style.marginTop))).toBeCloseTo(above, 1);
      expect(square.bottom + parseFloat(style.marginBottom) - baseline).toBeCloseTo(below, 1);
    });
  }
});
