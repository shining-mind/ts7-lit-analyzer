import {html} from 'lit';

import '../current-lit-element.js';
import '../vanilla-metadata-element.js';

export const simplePage = html`
  <fixture-vanilla-metadata heading="Hello"></fixture-vanilla-metadata>
  <fixture-current-lit .count=${1} current-count="2"></fixture-current-lit>
`;
