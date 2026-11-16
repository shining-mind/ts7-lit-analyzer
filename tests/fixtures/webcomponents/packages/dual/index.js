export class DualElement extends HTMLElement {
  static observedAttributes = ['count'];

  _count = 0;

  get count() {
    return this._count;
  }

  set count(value) {
    this._count = value;
  }
}

customElements.define('fixture-dual', DualElement);
