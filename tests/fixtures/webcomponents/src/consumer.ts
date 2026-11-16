import {DeclarationOnlyElement} from '@fixture/declaration-only';
import {DualElement} from '@fixture/dual';
// @ts-expect-error -- The JS-only fixture intentionally has no declarations.
import {JsOnlyElement} from '@fixture/js-only';
import {MdDialog} from '@material/web/dialog/dialog.js';

import {FixtureCurrentLitElement} from './current-lit-element.js';
import {FixtureLegacyLitElement} from './legacy-lit-element.js';
import {FixtureVanillaElement} from './vanilla-element.js';

const declarationOnly = new DeclarationOnlyElement();
declarationOnly.label = 'declared';

const dual = new DualElement();
dual.count = 'declaration wins';

const jsOnly = new JsOnlyElement();
jsOnly.count = 1;

const dialog = new MdDialog();
dialog.noFocusTrap = true;

const current = new FixtureCurrentLitElement();
current.count = 1;

const legacy = new FixtureLegacyLitElement();
legacy.enabled = true;

const vanilla = new FixtureVanillaElement();
vanilla.heading = 'Hello';
