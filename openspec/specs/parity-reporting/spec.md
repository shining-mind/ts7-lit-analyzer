# parity-reporting Specification

## Purpose

Defines an auditable record of legacy fixtures, coverage gaps, and known accuracy limitations without implying TS7 parity.

## Requirements

### Requirement: Traceable matrix entries

Every rule and feature row SHALL reference an existing local fixture, a pinned upstream file, or `no upstream fixture`, and SHALL have an explicit legacy and TS7 status. Placeholder paths MUST NOT be used.

#### Scenario: Audit all matrix rows

- **WHEN** all 23 rule rows and every feature row are checked
- **THEN** each reference resolves to a real source or an explicit absence marker and each status reflects available evidence

### Requirement: Explicit rule coverage gaps

The matrix SHALL explain why `no-invalid-attribute-name`, `no-invalid-tag-name`, and `no-invalid-css` lack local baseline tests and why all three `no-invalid-boolean-binding` scenarios are skipped.

#### Scenario: Missing upstream rule tests

- **WHEN** a reader inspects any of the three rules without upstream rule tests
- **THEN** the row states `no upstream fixture` and `pending` rather than linking to a nonexistent local test

#### Scenario: Unimplemented boolean rule

- **WHEN** a reader inspects `no-invalid-boolean-binding`
- **THEN** the record states that the rule ID and scenarios exist but the legacy implementation is absent and all three scenarios are skipped

### Requirement: Scoped legacy accuracy audit

The document SHALL list evidenced false positives and false negatives found in the existing baseline scenarios and pinned upstream tests, or state that none were identified within that audit scope. It MUST NOT claim that none exist.

#### Scenario: Record an accuracy discrepancy

- **WHEN** the audit identifies a false positive or false negative
- **THEN** the document links its fixture, expected behavior, actual legacy behavior, and supporting TypeScript or Lit semantics

#### Scenario: No discrepancy identified

- **WHEN** the audit finds no evidenced discrepancy in its defined scope
- **THEN** the document records that result together with the audit scope and remaining uncertainty
