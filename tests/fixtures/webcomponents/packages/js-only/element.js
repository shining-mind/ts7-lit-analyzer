export class JsOnlyElement extends HTMLElement {
  count = 0;
}

customElements.define('fixture-js-only', JsOnlyElement);
