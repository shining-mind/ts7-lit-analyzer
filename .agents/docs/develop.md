# Source development requirements

## General style

- Follow the [Google JavaScript Style Guide](https://google.github.io/styleguide/jsguide.html) where applicable, together with the surrounding code's naming conventions, structure, and established patterns.
- Prefer clear, simple, readable code and descriptive names over clever or compressed implementations. Do not shorten names merely to reduce source size.
- Default to no comments. Add comments for non-obvious rationale or constraints, emphasizing why rather than what. If a comment would only narrate the code, improve its structure or names instead.
- Keep modules focused and public contracts explicit. Avoid unrelated refactoring.
- Keep fixtures and examples self-contained, reproducible, and free of private paths or services.

## TypeScript

- Keep strict compiler options enabled. Prefer `unknown` over `any` and `object` over `Object`.
- Prefer named type aliases to complex inline types.
- Use standard ESM and explicit `.js` extensions for relative TypeScript imports.
- Target `esnext` where compatible with the runtime and editor hosts; do not use TypeScript for downlevel compilation. Document host-specific exceptions.
- Use TypeScript only for types. Do not introduce enums, namespaces, parameter properties, or other runtime-only TypeScript constructs where standard JavaScript suffices.

## Lit and SCSS

- Follow Lit runtime semantics and existing component patterns; do not infer behavior from template syntax alone.
- Preserve reactive property types, attribute aliases, converter behavior, and metadata provenance in analyzer models.
- Keep SCSS templates and style regions mapped to their original source ranges, including interpolations and incomplete input.
- Follow the surrounding SCSS naming, nesting, custom-property, and `::part` conventions. Prefer simple selectors and avoid unnecessary specificity.
- Do not claim CSS formatting, folding, or validation parity unless the corresponding behavior and tests establish it.

## Private property prefixes

Apply these conventions only where property minification, subclassing, or cross-version sharing makes them applicable; do not impose browser-library minification conventions blindly on Node.js hosts.

- Prefix most TypeScript-`private` properties with `_` when they are intended for property minification.
- Prefix private properties shared between different library versions with `_$`. Register them in the host's stable-property mechanism where one exists so their minified names remain stable across releases. Use an internal annotation when TypeScript cannot mark them private for type reasons.
- Prefix private fields with `__` on exported classes intended for subclassing outside their defining package when package-level minification namespacing is required.

## Architecture and correctness

- Preserve the package boundaries between the analyzer core, TypeScript 7 semantic provider, CLI, and VS Code extension.
- Use the real TypeScript 7 checker for assignability. Source and target types must come from the same project and snapshot.
- Cache only within valid project and snapshot boundaries. Handle invalidation, stale results, and cancellation explicitly.
- Report unknown or unavailable type information as incomplete analysis, never as a successful check.
- Keep component discovery independent from missing-import analysis and optional manifest metadata.
- Declare every direct dependency in the consuming package and respect normal package exports.
- Do not add a dependency without confirming that the required capability is missing and recording why the dependency is appropriate.

## Tests and validation

- Add or update meaningful positive and negative tests for changed behavior when the applicable test workflow exists.
- Follow existing test conventions and compile TypeScript before running compiled tests.
- Test source ranges, unsaved changes, invalidation, and incomplete inputs where relevant.
- Run `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, and `pnpm test` when applicable.
- Verify package portability with packed artifacts when package metadata or dependencies change.
- Validate editor behavior in a real Extension Development Host. Do not substitute mocks for VS Code integration verification.
