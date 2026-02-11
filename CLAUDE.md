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

### Automated Tests
- Tests are located in files with `.test.ts` suffix alongside source files
- Run tests with: `npm test`
- Run tests in watch mode: `npm test:watch`
- **Important**: Add tests for new implementations to prevent regressions

### Code Quality Commands
Before considering work complete, run:
- `npm run typecheck` - TypeScript type checking
- `npm run lint` - ESLint code linting
- `npm run build` - Full production build

**Note**: Do not run dev server commands (`npm run dev`, `npm run dev:full`, `npm run electron`) just to verify code validity. Use the above commands instead.

## Project Structure

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
4. **Bumping version** - Update package.json
5. **Creating tag** - Push annotated tag with release notes

### GitHub Actions Automation

Once the tag is pushed, GitHub Actions (`.github/workflows/release.yml`) automatically:

1. Builds AppImage on Linux runner
2. Builds DMG on macOS runner
3. Builds NSIS installer on Windows runner
4. Creates GitHub Release with all platform artifacts
5. Updates Homebrew tap (`benquemax/homebrew-markus-the-editor`)
6. Updates AUR package (`markus-bin`)
7. Updates Scoop bucket (`benquemax/scoop-markus-the-editor`)

Required repository secrets:
- `HOMEBREW_TAP_TOKEN` - GitHub PAT with repo access to homebrew-markus-the-editor
- `AUR_SSH_PRIVATE_KEY` - SSH private key registered with AUR
- `SCOOP_BUCKET_TOKEN` - GitHub PAT with repo access to scoop-markus-the-editor

### Distribution Channels

- **GitHub Releases**: https://github.com/benquemax/markus-the-editor/releases
- **Homebrew (macOS)**: `brew tap benquemax/markus-the-editor && brew install --cask markus`
- **AUR (Arch Linux)**: `yay -S markus-bin`
- **Scoop (Windows)**: `scoop bucket add markus https://github.com/benquemax/scoop-markus-the-editor && scoop install markus`

### AUR Package

The AUR package files are maintained in:
- `aur/PKGBUILD` - Source of truth in main repo (updated by GitHub Actions)
