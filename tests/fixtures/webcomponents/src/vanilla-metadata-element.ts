/**
 * A vanilla element with documented metadata.
 * @summary Vanilla metadata fixture.
 * @slot - Default content.
 * @slot header - Header content.
 * @csspart label - Label part.
 * @cssprop [--vanilla-color=red] - Text color.
 * @fires {Event} vanilla-change - Changed.
 */
export class FixtureVanillaMetadataElement extends HTMLElement {
  static observedAttributes = ['heading'];

  get heading(): string {
    return this.getAttribute('heading') ?? '';
  }

  set heading(value: string) {
    this.setAttribute('heading', value);
  }
}

customElements.define(
  'fixture-vanilla-metadata',
  FixtureVanillaMetadataElement
);
