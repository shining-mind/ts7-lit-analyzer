import {html} from 'lit';
import './counter-element.js';

export const valid = html`<counter-element .count=${2}></counter-element>`;
export const invalid = html`<counter-element
  .count=${'bad'}
></counter-element>`;
