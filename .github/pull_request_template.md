<!--
PR title must be: <type>(<scope>): Imperative summary
  e.g. feat(reporting): reject a daily report with a reason

- <type>: feat | fix | perf | refactor | test | docs | style | build | ci | chore | revert
- <scope>: the area changed, lowercase, matching history: reporting, worksite, shared, db, config,
  docker, api, specs, product. Leave it out when the change has no single area.
- The squash-merge commit subject is taken from this title. Base branch: main.
-->

## Summary
- Brief description of the change and key context the reviewer should know.

## Change Made
- Main changes in this PR.

## Testing
- ✅ npm run check
- ✅ npm run test:all
- ❌ add any skipped checks with context.

## Notes
- Known issues, technical limitations, migrations (name the `prisma/migrations/` folder), or rollout details.
