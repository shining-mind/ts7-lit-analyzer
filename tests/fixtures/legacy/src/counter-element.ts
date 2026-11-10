export class CounterElement extends HTMLElement {
  count = 1;
}

customElements.define('counter-element', CounterElement);
