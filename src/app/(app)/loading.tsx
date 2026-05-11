export default function AppLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header skeleton */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-7 w-36 skeleton rounded-lg" />
          <div className="h-4 w-52 skeleton rounded" />
        </div>
        <div className="h-9 w-32 skeleton rounded-lg" />
      </div>

      {/* Content skeleton — card grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="h-44 skeleton" />
            <div className="p-4 space-y-3">
              <div className="h-5 w-24 skeleton rounded" />
              <div className="h-4 w-full skeleton rounded" />
              <div className="h-3 w-3/4 skeleton rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
