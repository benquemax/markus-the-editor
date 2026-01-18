# AUR Package for Markus

This directory contains the PKGBUILD for publishing Markus to the Arch User Repository (AUR).

## Prerequisites

1. Create a GitHub release with the AppImage attached
2. Update the `sha256sums` in PKGBUILD (or keep as 'SKIP' for testing)

## Publishing to AUR

### First-time setup

1. Create an AUR account at https://aur.archlinux.org/
2. Add your SSH public key to your AUR account
3. Clone the AUR package (or create new):
   ```bash
   git clone ssh://aur@aur.archlinux.org/markus-bin.git
   ```

### Uploading/Updating

1. Copy PKGBUILD to the AUR repo:
   ```bash
   cp PKGBUILD /path/to/markus-bin/
   ```

2. Generate .SRCINFO:
   ```bash
   cd /path/to/markus-bin
   makepkg --printsrcinfo > .SRCINFO
   ```

3. Commit and push:
   ```bash
   git add PKGBUILD .SRCINFO
   git commit -m "Update to version X.Y.Z"
   git push
   ```

## Testing locally

```bash
makepkg -si
```

## Creating a GitHub Release

Before publishing to AUR, create a GitHub release:

1. Tag the version:
   ```bash
   git tag -a v0.1.0 -m "Release v0.1.0"
   git push origin v0.1.0
   ```

2. Create release on GitHub and upload `release/Markus-0.1.0.AppImage`

3. Update PKGBUILD sha256sums:
   ```bash
   sha256sum release/Markus-0.1.0.AppImage
   ```
