/** For specs: what an element says, as a person reads it: its text with the spaces between words made one, and none around. */
export function textOf(element: Element | null | undefined): string {
  return element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}
