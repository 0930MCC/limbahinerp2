import React from 'react';

export function SkeletonBox({
  className = '',
}: {
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={`skeleton-shimmer rounded-md ${className}`}
    />
  );
}

export function TableSkeleton({
  columns = 6,
  rows = 6,
}: {
  columns?: number;
  rows?: number;
}) {
  return (
    <div
      className="bg-white border border-slate-200 rounded-lg overflow-hidden"
      role="status"
      aria-label="Loading table data"
    >
      <div className="border-b border-slate-200 bg-slate-50/70 px-4 py-3 grid gap-4" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {Array.from({ length: columns }).map((_, idx) => (
          <SkeletonBox key={idx} className="h-3.5 w-20" />
        ))}
      </div>
      <div className="divide-y divide-slate-100">
        {Array.from({ length: rows }).map((_, rowIdx) => (
          <div
            key={rowIdx}
            className="px-4 py-3.5 grid gap-4 items-center"
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: columns }).map((__, colIdx) => (
              <SkeletonBox
                key={colIdx}
                className={colIdx === 0 ? 'h-4 w-24' : 'h-4 w-full max-w-[140px]'}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading dashboard">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="bg-white border border-slate-200 rounded-lg p-5 space-y-3"
          >
            <SkeletonBox className="h-3.5 w-28" />
            <SkeletonBox className="h-7 w-36" />
            <SkeletonBox className="h-3 w-24" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <SkeletonBox className="h-5 w-48" />
          <SkeletonBox className="h-60 w-full" />
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <SkeletonBox className="h-5 w-40" />
          <div className="space-y-3 pt-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <SkeletonBox key={i} className="h-10 w-full" />
            ))}
          </div>
        </div>
      </div>

      <TableSkeleton columns={5} rows={4} />
    </div>
  );
}

export function LayerSkeleton() {
  return (
    <div className="space-y-5 p-6" role="status" aria-label="Loading details">
      <div className="space-y-2">
        <SkeletonBox className="h-4 w-28" />
        <SkeletonBox className="h-7 w-56" />
      </div>
      <div className="border-t border-slate-200 pt-5 space-y-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="grid grid-cols-3 gap-4 items-center">
            <SkeletonBox className="h-3.5 w-24" />
            <SkeletonBox className="h-4 col-span-2 w-full max-w-[240px]" />
          </div>
        ))}
      </div>
    </div>
  );
}
