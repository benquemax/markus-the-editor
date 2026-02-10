# Publish New Version Workflow

You are being asked to publish a new version of Markus. Follow these steps carefully.

## Step 0: Switch to Latest Main

The release must be based on the `main` branch. The local environment is typically on a feature branch or `dev`, and the latest changes are often merged to `main` via pull request on GitHub. Always start by switching to `main` and pulling the latest:

```bash
git stash        # if you have uncommitted work
git checkout main
git pull origin main
```

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

Before releasing, verify:

1. You are on the `main` branch
2. Working tree is clean (no uncommitted changes)
3. All tests pass: `npm test`
4. Lint passes: `npm run lint`
5. Typecheck passes: `npm run typecheck`
6. Build succeeds: `npm run build`

## Step 5: Bump Version and Create Tag

1. Update version in package.json:
```bash
npm version <version> --no-git-tag-version
```

2. Commit the version bump:
```bash
git add package.json
git commit -m "chore: Bump version to <version>"
```

3. Create an annotated tag with the release notes:
```bash
git tag -a v<version> -m "<release_notes>"
```

4. Push commit and tag:
```bash
git push origin main
git push origin v<version>
```

## What Happens Next (Automated)

Once you push the tag, GitHub Actions automatically:

1. Builds AppImage on Linux
2. Builds DMG on macOS
3. Creates GitHub Release with both artifacts
4. Updates Homebrew tap (benquemax/homebrew-markus-the-editor)
5. Updates AUR package (markus-bin)

## After Release

The release will be available at:
- GitHub: https://github.com/benquemax/markus-the-editor/releases
- Homebrew: `brew tap benquemax/markus-the-editor && brew install --cask markus`
- AUR: `yay -S markus-bin`

## Required GitHub Secrets

For the automation to work, these secrets must be configured in the repository:

- `HOMEBREW_TAP_TOKEN`: GitHub PAT with repo access to homebrew-markus-the-editor
- `AUR_SSH_PRIVATE_KEY`: SSH private key registered with AUR
