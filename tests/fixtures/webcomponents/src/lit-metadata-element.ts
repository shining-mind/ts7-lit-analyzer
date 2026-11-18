import {LitElement} from 'lit';
import {customElement, property} from 'lit/decorators.js';

/**
 * A Lit element with documented metadata.
 * @slot - Default content.
 * @slot actions - Actions content.
 * @csspart control - Control part.
 * @cssprop [--lit-color=blue] - Control color.
 * @fires {CustomEvent<string>} lit-select - Selected.
 */
@customElement('fixture-lit-metadata')
export class FixtureLitMetadataElement extends LitElement {
  @property({type: String, attribute: 'selected-value'})
  selectedValue = '';
}
