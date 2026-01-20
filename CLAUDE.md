# Claude Code Project Instructions for Markus

## DRY Principle (Don't Repeat Yourself)

Apply DRY consistently throughout the codebase:
- When you notice similar code patterns appearing multiple times, extract them into helper functions
- This keeps the code modular and ensures bug fixes or improvements only need to be made in one place
- Example: The dialog helper functions in `electron/main.ts` ensure the Linux/GTK focus workaround is always applied, preventing regressions

## Code Comments Guidelines

### File-Level Comments
Every source file should have a comment at the top describing:
- The conceptual purpose of the file
- What role it plays in the overall architecture
- Key dependencies or relationships with other modules

### Line-Level Comments
Code-level comments should provide background information, not describe what the code does (the code itself shows that). Focus on:
- **Why** something is implemented a particular way
- Workarounds for library bugs or limitations
- Non-obvious design decisions
- Future improvement ideas (prefix with `TODO:` or `IDEA:`)
- Links to relevant issues, documentation, or discussions

Example:
```typescript
// Using base token name without _open/_close suffix because
// prosemirror-markdown automatically appends these suffixes
// when building token handlers
table: { ignore: true },
```

## Testing and Quality

### Mandatory Testing Policy

**Every implementation must include automated tests.** This is non-negotiable. Tests prevent regressions and ensure features aren't accidentally broken by future changes.

Guidelines for test coverage:
- **New features**: Add tests that verify the feature works as expected
- **Bug fixes**: Add a test that reproduces the bug and verifies the fix
- **Refactoring**: Ensure existing tests still pass; add tests if coverage is lacking
- **Schema/data changes**: Test parsing, serialization, and round-trip behavior
- **UI components**: Test key interactions and state changes

Choose the appropriate test type:
- **Unit tests**: For pure functions, utilities, and isolated logic
- **Integration tests**: For features involving multiple modules (e.g., markdown parsing + serialization)
- **Round-trip tests**: For data transformations (parse → modify → serialize → parse again)

### Automated Tests
- Tests are located in files with `.test.ts` suffix alongside source files
- Run tests with: `npm test`
- Run tests in watch mode: `npm test:watch`

### Pre-Completion Checklist

**Before pushing code or declaring a task complete, always run:**

```bash
npm run typecheck  # TypeScript type checking
npm run lint       # ESLint code linting
npm test           # Run all automated tests
npm run build      # Full production build
```

All four commands must pass without errors. A task is not complete until:
1. Tests are written for the new/changed functionality
2. All existing tests still pass
3. TypeScript compiles without errors
4. Linting passes (warnings are acceptable, errors are not)
5. Production build succeeds

**Note**: Do not run dev server commands (`npm run dev`, `npm run dev:full`, `npm run electron`) just to verify code validity. Use the above commands instead.

## Project Structure

- `docs/` - Documentation for conventions and patterns (read when beginning a task)
- `electron/` - Electron main process (main.ts, preload.ts, menu.ts, etc.)
- `src/` - React renderer process
  - `src/editor/` - ProseMirror editor core (schema, markdown parser, plugins)
  - `src/components/` - React UI components
  - `src/lib/` - Utility functions

## Tech Stack

- Electron 31+ (desktop shell)
- React 18 (UI)
- ProseMirror (rich text editing)
- TypeScript
- Vite (bundling)
- Tailwind CSS (styling)
- Vitest (testing)

## Deployment and Releases

### Release Workflow

Use the `/publish-new-version` command to start the release process. This will guide you through:

1. **Analyzing changes** - Review commits since the last release tag
2. **Determining version** - Choose appropriate semver bump (major/minor/patch)
3. **Writing release notes** - Create user-friendly changelog
4. **Running the release script** - Automate the entire release

### Release Script

The automated release script is at `scripts/release.sh`. It handles:
- Version update in package.json
- Running all quality checks (lint, typecheck, tests, build)
- Building AppImage
- Creating git tag and pushing to GitHub
- Creating GitHub release with AppImage attached
- Updating and publishing to AUR

Usage:
```bash
./scripts/release.sh <version> "<release_notes>"
```

### Distribution Channels

- **GitHub Releases**: AppImage downloads at https://github.com/erkkimon/markus-the-editor/releases
- **AUR**: `markus-bin` package for Arch Linux users

### AUR Package

The AUR package files are maintained in two locations:
- `aur/PKGBUILD` - Source of truth in main repo (updated by release script)
- `mnt/markus-bin/` - Cloned AUR repo for publishing (managed by release script)
