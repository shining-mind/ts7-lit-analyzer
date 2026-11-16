import {LitElement} from 'lit';
import {customElement, property} from 'lit/decorators.js';

@customElement('fixture-current-lit')
export class FixtureCurrentLitElement extends LitElement {
  @property({type: Number, attribute: 'current-count'})
  count = 0;
}
