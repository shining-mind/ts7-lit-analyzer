export class FixtureVanillaElement extends HTMLElement {
  static observedAttributes = ['heading'];

  get heading(): string {
    return this.getAttribute('heading') ?? '';
  }

  set heading(value: string) {
    this.setAttribute('heading', value);
  }
}

customElements.define('fixture-vanilla', FixtureVanillaElement);
