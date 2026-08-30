# Brand Marketing Asset Themes Implementation

## Coverage

- The bright 4:5 published poster is now the bright poster source, preventing
  regeneration from restoring the obsolete portrait geometry.
- Approved dark poster and social source images are checked in alongside the
  existing bright sources. The dark poster remains the native `1122x1402`
  full-image generation and is copied without local image processing.
- The brand asset generator exports all four public theme-and-format assets.
- The icon and marketing check verifies their exact dimensions and that the
  public dark poster is byte-identical to its approved source.
- The PWA precache excludes both large poster exports, keeping the existing
  bright-poster cache policy aligned with its dark counterpart.
- The visual specification and Web maintainer README describe the current
  source, export, and rendering constraints.

## Validation

- Run `cd web && bun run brand-assets`.
- Run `cd web && bun run test:icons`.
- Run the standard Web checks for the changed script surface.
