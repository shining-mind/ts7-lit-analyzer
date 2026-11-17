import {html} from 'lit';
import '@material/web/button/filled-button.js';
import '@material/web/dialog/dialog.js';

import '../lit-metadata-element.js';
import '../vanilla-metadata-element.js';

function onSelect(event: Event): string {
  return event.type;
}

export const composedPage = html`
  <md-dialog>
    <div slot="headline">Dialog title</div>
    <div slot="content">
      <fixture-vanilla-metadata heading="Nested"></fixture-vanilla-metadata>
      <fixture-lit-metadata
        .selectedValue=${'a'}
        @lit-select=${onSelect}
      ></fixture-lit-metadata>
    </div>
    <div slot="actions">
      <md-filled-button>OK</md-filled-button>
    </div>
  </md-dialog>
`;
