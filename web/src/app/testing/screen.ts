import { TestBed } from '@angular/core/testing';
import { Toast } from '../core/toast';
import { chooseOption, closeSelect, ngSelect, optionTexts, selectedTexts } from './ng-select';

/*
 * For specs: the screen of a component, used as a person uses it. A spec finds what is on screen
 * and acts on it with these, and reads what the screen says.
 */

/** What `selector` matches in `root`. Throws when nothing does, so that a spec fails on the line that looked for it. */
export function findIn<T extends Element>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`Nothing on screen matches ${selector}`);
  return found;
}

const text = (element: Element): string => element.textContent?.replace(/\s+/g, ' ').trim() ?? '';

/** The button in `root` that says `text`, spaces around it aside. Throws when there is none. */
export function buttonIn(root: ParentNode, label: string): HTMLButtonElement {
  const found = Array.from(root.querySelectorAll('button')).find((candidate) => text(candidate) === label);
  if (!found) throw new Error(`No "${label}" button on screen`);
  return found;
}

/** A paste as the browser reports it: on the element that has the focus, with what was copied. */
export function paste(target: Element, files: File[], copiedText?: string): ClipboardEvent {
  const data = new DataTransfer();
  for (const file of files) data.items.add(file);
  if (copiedText !== undefined) data.setData('text/plain', copiedText);
  const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

/** What the toasts on screen say, oldest first. */
export function toasts(): string[] {
  return TestBed.inject(Toast)
    .items()
    .map((item) => item.text);
}

/**
 * What a person does on the screen of a component, each followed by `render`: the screen update
 * the spec runs after an event, as Angular runs one after every event. `root` gives the element
 * of the component, which a spec creates again in each test.
 *
 * `const { click, type, pick } = screenOf(() => el, render);`
 */
export function screenOf(root: () => HTMLElement, render: () => void) {
  /** An event of a control, which reports it as the browser does. */
  const fire = (target: HTMLElement, event: string): void => {
    target.dispatchEvent(new Event(event));
    render();
  };
  const select = (name: string): HTMLElement => ngSelect(root(), name);

  return {
    find: <T extends HTMLElement>(selector: string): T => findIn<T>(root(), selector),
    /** A button by what it says, on the screen or within a part of it. */
    button: (label: string, within: ParentNode = root()): HTMLButtonElement => buttonIn(within, label),
    fire,
    click(target: HTMLElement): void {
      target.click();
      render();
    },
    /**
     * What the person types in a field, or picks in the calendar of a date: the browser reports
     * both the same way. `change` for a field typed in and then left.
     */
    type(control: HTMLInputElement | HTMLTextAreaElement, typed: string, event = 'input'): void {
      control.value = typed;
      fire(control, event);
    },
    pressEscape(): void {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      render();
    },
    /** A select by its name: the id its label points at, or its `ariaLabel`. */
    select,
    /** What a select shows as chosen. */
    chosen: (name: string): string[] => selectedTexts(select(name)),
    /** What a select offers. Its list is closed again: left open, it would stay on the page. */
    offers(name: string): string[] {
      const texts = optionTexts(select(name));
      closeSelect(select(name));
      render();
      return texts;
    },
    /** Chooses an option of a select, as a click on it does. */
    pick(name: string, option: string): void {
      chooseOption(select(name), option);
      render();
    },
  };
}

/** Lets the promise chains that follow an answered request run: the next task of the browser, outside `fakeAsync`. */
export function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve));
}
