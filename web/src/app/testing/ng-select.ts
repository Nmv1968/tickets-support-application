/**
 * For specs: an ng-select handled as a person handles it, through the page. A spec reads what a
 * select shows and chooses in it with these, instead of reaching into the component.
 *
 * They only send the events of a mouse or a keyboard. The spec then updates the screen as after
 * any other action (`fixture.detectChanges()`), which is when the form takes the new value.
 */

/**
 * The select with this name: the id its label points at (`labelForId`) or its `ariaLabel`.
 * Throws when the page has none, so a spec fails on the line that looked for it.
 */
export function ngSelect(root: ParentNode, name: string): HTMLElement {
  const box = [...root.querySelectorAll<HTMLInputElement>('ng-select input[role=combobox]')].find((input) => input.id === name || input.getAttribute('aria-label') === name);
  const select = box?.closest<HTMLElement>('ng-select');
  if (!select) throw new Error(`No ng-select named "${name}" on screen`);
  return select;
}

const text = (element: Element): string => element.textContent?.replace(/\s+/g, ' ').trim() ?? '';

/** The text of one chosen value, without the "×" that takes it out of a multiple select. */
function chosenText(value: Element): string {
  const label = value.querySelector('.ng-value-label');
  if (label) return text(label);
  // Drawn by a template of the app (a support type as a chip of its colour): its text, less its button.
  const copy = value.cloneNode(true) as Element;
  copy.querySelectorAll('button').forEach((button) => button.remove());
  return text(copy);
}

/** What the select shows as chosen: one text, several in a multiple select, none when empty. */
export function selectedTexts(select: HTMLElement): string[] {
  return [...select.querySelectorAll('.ng-value')].map(chosenText);
}

/** The box of the select: what has the focus while a person uses it, and where they type. */
function searchBox(select: HTMLElement): HTMLInputElement {
  return select.querySelector<HTMLInputElement>('input[role=combobox]')!;
}

/** The list of options, when it is open. It hangs from the body in a select with `appendTo="body"`. */
function panel(select: HTMLElement): HTMLElement | null {
  const id = searchBox(select).getAttribute('aria-controls');
  return id ? document.getElementById(id) : null;
}

/** Opens the list as a press on the select does. Does nothing when it is already open. */
export function openSelect(select: HTMLElement): void {
  if (!panel(select)) select.querySelector('.ng-select-container')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
}

/** Closes the list without choosing, as a press anywhere else does. */
export function closeSelect(select: HTMLElement): void {
  if (panel(select)) document.body.click();
}

/**
 * The options the open list offers, as texts. Among them, when they apply, the line that says
 * nothing matches ("Sin resultados") and the one that creates what was typed ("Crear…").
 * Opens the list to read them and leaves it open.
 */
export function optionTexts(select: HTMLElement): string[] {
  openSelect(select);
  return [...(panel(select)?.querySelectorAll('.ng-option') ?? [])].map(text);
}

/** Chooses the option with this text, as a click on it does. Throws when the list does not offer it. */
export function chooseOption(select: HTMLElement, option: string): void {
  openSelect(select);
  const found = [...(panel(select)?.querySelectorAll<HTMLElement>('.ng-option') ?? [])].find((item) => text(item) === option);
  if (!found) throw new Error(`The select does not offer "${option}". It offers: ${optionTexts(select).join(', ') || 'nothing'}`);
  found.click();
}

/** Types in the select, which narrows its options to the ones that match. */
export function typeInSelect(select: HTMLElement, typed: string): void {
  openSelect(select);
  const box = searchBox(select);
  box.value = typed;
  box.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Empties the select with its "×". Throws when there is none: the select is not clearable, or
 * has nothing chosen.
 */
export function clearSelect(select: HTMLElement): void {
  const clear = select.querySelector<HTMLElement>('.ng-clear-wrapper');
  if (!clear) throw new Error('The select has nothing to clear, or cannot be cleared');
  clear.click();
}

/** Takes one chosen value out of a multiple select, with the "×" of its chip (or the button a chip of its own brings). */
export function removeChosen(select: HTMLElement, chosen: string): void {
  const chip = [...select.querySelectorAll<HTMLElement>('.ng-value')].find((value) => chosenText(value) === chosen);
  const remove = chip?.querySelector<HTMLElement>('.ng-value-icon, button');
  if (!remove) throw new Error(`"${chosen}" is not chosen in the select, or cannot be removed`);
  remove.click();
}
