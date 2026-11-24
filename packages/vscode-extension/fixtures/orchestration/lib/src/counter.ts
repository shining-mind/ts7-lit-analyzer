export class CounterElement extends HTMLElement {
  count: number = 0;
}

customElements.define('x-counter', CounterElement);
