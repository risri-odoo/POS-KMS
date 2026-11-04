// Adapted from HAIP apps/dashboard/src/components/ui/Skeleton.tsx (commit 928c2f6).
// Copyright 2026 Telivity. Licensed under the Apache License, Version 2.0; see ../../LICENSE.haip.
// Modified for StayX: SkeletonPage removed; rounded renamed for Tailwind 4.

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-skeleton rounded-sm bg-telivity-mid-grey/20 ${className}`} aria-hidden="true" />;
}

export function SkeletonCard() {
  return (
    <div className="rounded-xl bg-white p-5 shadow-sm">
      <Skeleton className="mb-3 h-4 w-24" />
      <Skeleton className="mb-2 h-8 w-16" />
      <Skeleton className="h-3 w-32" />
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="overflow-hidden rounded-xl bg-white shadow-sm">
      <div className="flex gap-4 border-b border-gray-100 bg-telivity-teal/5 px-4 py-3">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-4 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 border-b border-gray-50 px-4 py-3">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}
