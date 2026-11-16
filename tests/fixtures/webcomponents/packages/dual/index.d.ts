export class DualElement extends HTMLElement {
  get count(): string;
  set count(value: string);
}

declare global {
  interface HTMLElementTagNameMap {
    'fixture-dual': DualElement;
  }
}
