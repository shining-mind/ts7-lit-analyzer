import {LitElement} from 'lit-element';
import {customElement, property} from 'lit-element/decorators.js';

@customElement('fixture-legacy-lit')
export class FixtureLegacyLitElement extends LitElement {
  @property({type: Boolean})
  enabled = false;
}
