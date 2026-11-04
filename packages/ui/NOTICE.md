# Third-party notices

## HAIP

Parts of this package are adapted from HAIP's staff dashboard (`apps/dashboard`, commit `928c2f6`).

Copyright 2026 Telivity. Licensed under the Apache License, Version 2.0. The full text is in [LICENSE.haip](LICENSE.haip).

| File here | Adapted from | Changes |
|---|---|---|
| `src/components/AppShell.tsx` | `components/layout/AppLayout.tsx`, `Sidebar.tsx`, `Header.tsx` | Router, auth, i18n, property switcher, search, help and notifications removed. Nav passed as props. Disabled nav items, banner slot, fixed-height mode and sidebar-free layout added |
| `src/components/Badge.tsx` | `components/ui/StatusBadge.tsx` | i18n removed. Order statuses, high-contrast mode and large size added |
| `src/components/Modal.tsx` | `components/ui/Modal.tsx` | i18n replaced by a prop. `ConfirmModal` added |
| `src/components/Skeleton.tsx` | `components/ui/Skeleton.tsx` | `SkeletonPage` removed |
| `src/components/Toast.tsx` | `components/ui/Toast.tsx` | `ToastView` and `ToastStack` exported. Sticky mode added |
| `src/theme.css` | `tailwind.config.ts` | Rewritten as Tailwind 4 tokens, with Tailwind 3 defaults pinned |

The other components were written for StayX, using the class patterns HAIP repeats across its pages.

The Apache licence doesn't cover Telivity's or HAIP's names or logos, so neither is used in the StayX interface.

## Packages

- `lucide-react`: ISC licence
- `@fontsource/montserrat`: SIL Open Font License 1.1
