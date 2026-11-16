# Canon Studio P2 staging acceptance checklist

## Functional

- [ ] Load main branch for an existing owner world, and automatically create main for a new staging world.
- [ ] An editor can add sources, save a draft, and explicitly promote a claim to canon.
- [ ] Viewer can read/export but cannot edit claims or reviews; unauthorized user sees no records.
- [ ] Unsupported predicates and unknown article IDs are rejected by app validation and database checks.
- [ ] A claim cannot link to an article/source in another world; a branch cannot reference another world.
- [ ] Rename a codex slug and ensure its stable UUID links keep facts visible and editable.
- [ ] An article referenced by a canon assertion is not silently deleted.
- [ ] Remembrance after death passes; explicit participation after death fails; an event extending past death fails.
- [ ] Intentionally exclusive overlapping claims produce a reviewable finding; nonexclusive claims do not.
- [ ] Disposition rationale persists, survives a reload, and becomes stale when the claim changes.
- [ ] Branches isolate alternate histories from main canon.
- [ ] Local-only mode is conspicuously labeled; cloud schema failure never falls back to local storage.
- [ ] Export JSON contains only canon data, is world-scoped, and downloads successfully.

## Visual and accessibility

- [ ] All nine themes render Codex Studio and Canon Studio without unreadable text.
- [ ] Every sidebar icon and label is colored independently, including Canon Studio.
- [ ] WCAG AA text contrast ≥4.5:1 for normal text; control boundary contrast ≥3:1 on new workspaces.
- [ ] Keyboard Tab navigation, focus rings, dialog controls, and narrow mobile layouts work.
- [ ] No clipped toolbar controls or horizontal page overflow at 390, 768, and 1440 pixel widths.
- [ ] Parchment, Glacier Light and Dawnlight are tested as thoroughly as dark themes.

## Safety and release

- [ ] Staging database backup/restore rehearsed before SQL migration.
- [ ] All expected RLS policies and foreign keys checked in staging.
- [ ] Full Vitest and Next.js build pass after regenerating the lockfile.
- [ ] Browser smoke and visual regression tests completed in a functioning browser environment.
- [ ] No production changes without explicit approval.
