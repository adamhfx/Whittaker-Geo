# Whittaker Geo branding

The public product name is **Whittaker Geo**. The GitHub repository, deployment
service names, and existing session-storage and authentication cookie keys retain
their original technical identifiers so saved drafts and sign-in return paths work.

`public/whittaker-geo-logo.svg` is the website wordmark.
`public/whittaker-geo-icon.svg` is its compact W emblem for navigation and browser icons.
Both contain vector paths traced from the approved artwork, with clean navy/olive
fills and transparent backgrounds. The wordmark outlines are embedded, so rendering
does not depend on an installed font. Display with `object-fit: contain` to preserve
the complete artwork at all sizes and browser zoom levels.

The original image-generated PNGs remain available as source references and for
external services that require raster artwork. The website uses SVGs throughout
to avoid the PNGs' rough, partially transparent edges.

`app/brand.css` owns the shared navy (#002d43), olive (#596238), and neutral palette.
Workspace, sales, and administration styles reference those tokens. Primary actions
use navy; olive provides secondary emphasis and the second cash-flow chart series.
Success, warning, and error states retain their semantic colors.

The compact icon prompt: Extract only the approved logo's layered W emblem, preserve
its geometry, colors and orientation, remove the wordmark, and center it on a square
transparent canvas without extra text, symbols, effects or a background.
