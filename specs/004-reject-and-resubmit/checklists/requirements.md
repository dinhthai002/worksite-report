# Specification Quality Checklist: Reject and resubmit a daily report

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-11-26
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- No markers. The plan's two questions for clarify (maximum reason length; where the Foreman sees the reason) have stated defaults in the spec's Assumptions, for `/speckit-clarify` to confirm or change.
- The spec names no technology, endpoints, headers or status codes. The domain method, use case, endpoint, `.http` walkthrough and README changes from the implementation plan's Step 4 are inputs for `/speckit-plan`.
- Every test in the plan's Step 4 "Tests" table maps to a scenario or requirement: BR-8 blank reason (US1-3, FR-002); BR-10 approved cannot be rejected (US3-4, FR-008); BR-6 author edits a `REJECTED` report, others cannot (US2-2, US2-5, FR-012); BR-11 rejection transition with actor, time and reason (US1-1, FR-004); BR-12 (US3-1 to US3-3, FR-009); TST-11 table (unchanged: the lifecycle already allows `SUBMITTED` to `REJECTED` and back); BR-15 approve against reject (US4-1, FR-019); UC-1 to UC-4 in sequence (US2-7, US5); permissions across approve and reject (US3, feature 003 US3); progress unchanged before final approval (US2-6, FR-015).
- Plan exit criteria map to: PRD example row by row (US5, FR-022, SC-001); walkthrough by hand (US6, FR-024, FR-025, SC-009); implementation goals 1 to 3 (FR-023, SC-008).
- Document conflicts are stated in the spec's Assumptions, not resolved silently: UC-4's "Applies" line omits BR-10; a rejected report on a worksite closed later cannot be resubmitted.
