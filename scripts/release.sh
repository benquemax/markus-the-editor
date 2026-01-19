#!/bin/bash
#
# Markus Release Script
# =====================
#
# This script automates the release process for Markus:
# 1. Updates version in package.json
# 2. Runs tests and builds
# 3. Creates AppImage
# 4. Creates GitHub release with AppImage attached
# 5. Updates and publishes AUR package
#
# Usage:
#   ./scripts/release.sh <version> "<release_notes>"
#
# Example:
#   ./scripts/release.sh 0.2.0 "## What's New
#
#   - Feature X
#   - Bug fix Y
#   - Improvement Z"
#
# Prerequisites:
#   - gh (GitHub CLI) - authenticated
#   - git - configured for GitHub and AUR
#   - npm - Node.js package manager
#   - makepkg - Arch Linux package builder
#
# The mnt/markus-bin directory is used for AUR publishing.
# It will be cloned if it doesn't exist, or pulled if it does.
#

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
AUR_DIR="$PROJECT_ROOT/mnt/markus-bin"

#
# Helper functions
#
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

die() {
    log_error "$1"
    exit 1
}

#
# Validation functions
#
check_prerequisites() {
    log_info "Checking prerequisites..."

    command -v gh >/dev/null 2>&1 || die "gh (GitHub CLI) is not installed"
    command -v git >/dev/null 2>&1 || die "git is not installed"
    command -v npm >/dev/null 2>&1 || die "npm is not installed"
    command -v makepkg >/dev/null 2>&1 || die "makepkg is not installed (are you on Arch?)"

    # Check gh is authenticated
    gh auth status >/dev/null 2>&1 || die "gh is not authenticated. Run 'gh auth login'"

    log_info "All prerequisites satisfied"
}

check_clean_working_tree() {
    log_info "Checking for clean git working tree..."

    cd "$PROJECT_ROOT"

    if [ -n "$(git status --porcelain)" ]; then
        die "Working tree is not clean. Commit or stash changes first."
    fi

    log_info "Working tree is clean"
}

validate_version() {
    local version="$1"

    # Check version format (semver: X.Y.Z)
    if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        die "Invalid version format: $version (expected X.Y.Z)"
    fi

    # Check if tag already exists
    if git tag -l "v$version" | grep -q "v$version"; then
        die "Tag v$version already exists"
    fi
}

#
# Build functions
#
update_package_version() {
    local version="$1"
    log_info "Updating package.json version to $version..."

    cd "$PROJECT_ROOT"

    # Update version in package.json using npm
    npm version "$version" --no-git-tag-version --allow-same-version

    log_info "Version updated"
}

run_tests() {
    log_info "Running tests..."

    cd "$PROJECT_ROOT"
    npm test || die "Tests failed"

    log_info "All tests passed"
}

run_build() {
    log_info "Running build..."

    cd "$PROJECT_ROOT"
    npm run build || die "Build failed"

    log_info "Build completed"
}

run_typecheck() {
    log_info "Running typecheck..."

    cd "$PROJECT_ROOT"
    npm run typecheck || die "Typecheck failed"

    log_info "Typecheck passed"
}

run_lint() {
    log_info "Running lint..."

    cd "$PROJECT_ROOT"
    npm run lint || die "Lint failed"

    log_info "Lint passed"
}

build_appimage() {
    log_info "Building AppImage..."

    cd "$PROJECT_ROOT"

    # Clean previous release artifacts
    rm -rf release/

    # Build only AppImage (skip deb/pacman which have dependency issues)
    npx electron-builder --linux AppImage --publish=never || die "AppImage build failed"

    # Verify AppImage was created
    local appimage="$PROJECT_ROOT/release/Markus-$VERSION.AppImage"
    if [ ! -f "$appimage" ]; then
        die "AppImage not found at $appimage"
    fi

    log_info "AppImage built: $appimage"
}

#
# Release functions
#
commit_and_tag() {
    local version="$1"
    log_info "Committing version bump and creating tag v$version..."

    cd "$PROJECT_ROOT"

    git add package.json
    git commit -m "chore: Bump version to $version"
    git tag -a "v$version" -m "Release v$version"

    log_info "Created commit and tag v$version"
}

push_to_github() {
    local version="$1"
    log_info "Pushing to GitHub..."

    cd "$PROJECT_ROOT"

    git push origin main
    git push origin "v$version"

    log_info "Pushed commits and tag to GitHub"
}

create_github_release() {
    local version="$1"
    local notes="$2"
    local appimage="$PROJECT_ROOT/release/Markus-$version.AppImage"

    log_info "Creating GitHub release v$version..."

    cd "$PROJECT_ROOT"

    gh release create "v$version" \
        --title "Markus v$version" \
        --notes "$notes" \
        "$appimage"

    log_info "GitHub release created: https://github.com/erkkimon/markus-the-editor/releases/tag/v$version"
}

#
# AUR functions
#
setup_aur_repo() {
    log_info "Setting up AUR repository..."

    mkdir -p "$PROJECT_ROOT/mnt"

    if [ -d "$AUR_DIR/.git" ]; then
        log_info "AUR repo exists, pulling latest..."
        cd "$AUR_DIR"
        git pull origin master
    else
        log_info "Cloning AUR repo..."
        cd "$PROJECT_ROOT/mnt"
        rm -rf markus-bin
        git clone ssh://aur@aur.archlinux.org/markus-bin.git
    fi

    log_info "AUR repo ready"
}

update_pkgbuild() {
    local version="$1"
    local sha256="$2"

    log_info "Updating PKGBUILD..."

    cd "$PROJECT_ROOT"

    # Update version in aur/PKGBUILD
    sed -i "s/^pkgver=.*/pkgver=$version/" aur/PKGBUILD
    sed -i "s/^pkgrel=.*/pkgrel=1/" aur/PKGBUILD
    sed -i "s/^sha256sums=.*/sha256sums=('$sha256')/" aur/PKGBUILD

    # Commit PKGBUILD update to main repo
    git add aur/PKGBUILD
    git commit -m "chore: Update PKGBUILD for v$version"
    git push origin main

    log_info "PKGBUILD updated"
}

publish_to_aur() {
    local version="$1"

    log_info "Publishing to AUR..."

    # Copy PKGBUILD to AUR repo
    cp "$PROJECT_ROOT/aur/PKGBUILD" "$AUR_DIR/"

    # Generate .SRCINFO
    cd "$AUR_DIR"
    makepkg --printsrcinfo > .SRCINFO

    # Commit and push
    git add PKGBUILD .SRCINFO
    git commit -m "Update to version $version"
    git push origin master

    log_info "Published to AUR: https://aur.archlinux.org/packages/markus-bin"
}

#
# Main
#
main() {
    # Check arguments
    if [ $# -lt 2 ]; then
        echo "Usage: $0 <version> \"<release_notes>\""
        echo ""
        echo "Example:"
        echo "  $0 0.2.0 \"## What's New"
        echo ""
        echo "  - Feature X"
        echo "  - Bug fix Y\""
        exit 1
    fi

    VERSION="$1"
    RELEASE_NOTES="$2"

    echo "========================================"
    echo "  Markus Release Script"
    echo "  Version: $VERSION"
    echo "========================================"
    echo ""

    # Pre-flight checks
    check_prerequisites
    check_clean_working_tree
    validate_version "$VERSION"

    # Update version and run quality checks
    update_package_version "$VERSION"
    run_lint
    run_typecheck
    run_tests
    run_build

    # Build distributable
    build_appimage

    # Calculate sha256sum
    APPIMAGE="$PROJECT_ROOT/release/Markus-$VERSION.AppImage"
    SHA256=$(sha256sum "$APPIMAGE" | cut -d' ' -f1)
    log_info "AppImage SHA256: $SHA256"

    # Git operations
    commit_and_tag "$VERSION"
    push_to_github "$VERSION"

    # GitHub release
    create_github_release "$VERSION" "$RELEASE_NOTES"

    # AUR release
    setup_aur_repo
    update_pkgbuild "$VERSION" "$SHA256"
    publish_to_aur "$VERSION"

    echo ""
    echo "========================================"
    echo "  Release v$VERSION completed!"
    echo "========================================"
    echo ""
    echo "GitHub: https://github.com/erkkimon/markus-the-editor/releases/tag/v$VERSION"
    echo "AUR:    https://aur.archlinux.org/packages/markus-bin"
    echo ""
}

main "$@"
