export class DeclarationOnlyElement extends HTMLElement {
  label: string;
}

declare global {
  interface HTMLElementTagNameMap {
    'fixture-declaration-only': DeclarationOnlyElement;
  }
}
