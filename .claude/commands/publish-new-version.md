# Publish New Version Workflow

You are being asked to publish a new version of Markus. Follow these steps carefully.

## Step 1: Analyze Changes Since Last Release

Run the following to understand what has changed:

```bash
# Get the last release tag
git describe --tags --abbrev=0

# See all commits since that tag
git log $(git describe --tags --abbrev=0)..HEAD --oneline

# See the full diff
git diff $(git describe --tags --abbrev=0)..HEAD --stat
```

## Step 2: Determine Version Bump

Based on the changes, determine the appropriate version bump following semver:

- **MAJOR** (X.0.0): Breaking changes, incompatible API changes
- **MINOR** (0.X.0): New features, backwards compatible
- **PATCH** (0.0.X): Bug fixes, minor improvements

Current version can be found in package.json.

## Step 3: Write Release Notes

Create release notes in markdown format. Structure them like:

```
## What's New

- Feature: Description of new feature
- Fix: Description of bug fix
- Improvement: Description of improvement
```

Be concise but informative. Group related changes together.

## Step 4: Pre-flight Checks

Before running the release script, verify:

1. You are on the `main` branch
2. Working tree is clean (no uncommitted changes)
3. All tests pass: `npm test`
4. Build succeeds: `npm run build`
5. GitHub CLI is authenticated: `gh auth status`

## Step 5: Run the Release Script

Execute the release script with version and notes:

```bash
./scripts/release.sh <version> "<release_notes>"
```

Example:
```bash
./scripts/release.sh 0.2.0 "## What's New

- Feature: Added dark mode support
- Fix: Fixed save dialog appearing behind window
- Improvement: Better keyboard shortcuts"
```

## What the Script Does

1. Updates version in package.json
2. Runs lint, typecheck, tests, and build
3. Creates AppImage in release/ directory
4. Commits version bump and creates git tag
5. Pushes to GitHub
6. Creates GitHub release with AppImage attached
7. Updates and publishes to AUR (markus-bin)

## After Release

The release will be available at:
- GitHub: https://github.com/erkkimon/markus-the-editor/releases
- AUR: https://aur.archlinux.org/packages/markus-bin

Users can install via:
- AppImage: Download and run directly
- AUR: `yay -S markus-bin` or `paru -S markus-bin`
