/**
 * Pure functions for partner-site selection logic.
 * Extracted here so unit tests don't require a React/DOM environment.
 */

export interface PartnerSiteForSelection {
  id: string;
  listingCount: number;
  propertyUrlPatterns: string[];
  listingUrlPatterns: string[];
  discoveryStrategy: string;
  consecutiveFailures?: number;
}

/** True when the site has a crawl profile but no indexed stock → live scraping. */
export function isLiveSite(site: PartnerSiteForSelection): boolean {
  return (
    site.listingCount === 0 &&
    (site.propertyUrlPatterns.length > 0 ||
      site.listingUrlPatterns.length > 0 ||
      !!site.discoveryStrategy)
  );
}

export interface SelectionAnalysis {
  indexedCount: number;
  liveCount: number;
  noProfileCount: number;
  estimatedTime: string;
}

/** Counts indexed / live / no-profile among the currently selected sites. */
export function selectionAnalysis(
  sites: PartnerSiteForSelection[],
  selectedIds: string[],
): SelectionAnalysis {
  const selected = sites.filter((s) => selectedIds.includes(s.id));
  const indexedCount = selected.filter((s) => s.listingCount > 0).length;
  const liveCount = selected.filter(
    (s) =>
      s.listingCount === 0 &&
      (s.propertyUrlPatterns.length > 0 ||
        s.listingUrlPatterns.length > 0 ||
        !!s.discoveryStrategy),
  ).length;
  const noProfileCount = selected.filter(
    (s) =>
      s.listingCount === 0 &&
      s.propertyUrlPatterns.length === 0 &&
      s.listingUrlPatterns.length === 0 &&
      !s.discoveryStrategy,
  ).length;
  const estimatedTime = liveCount > 0 || noProfileCount > 0 ? '~30–60s' : '~5s';
  return { indexedCount, liveCount, noProfileCount, estimatedTime };
}

/**
 * Returns the new selectedIds after toggling `id`.
 *
 * Rules enforced:
 * - Cannot exceed `maxSelectable` (if set).
 * - At most 1 live-scraping site at a time.
 *
 * Returns the current array unchanged when a rule blocks the addition.
 */
export function toggleSelectionIds(
  id: string,
  sites: PartnerSiteForSelection[],
  selectedIds: string[],
  maxSelectable?: number,
): string[] {
  if (selectedIds.includes(id)) {
    return selectedIds.filter((sid) => sid !== id);
  }
  if (maxSelectable !== undefined && selectedIds.length >= maxSelectable) {
    return selectedIds;
  }
  const target = sites.find((s) => s.id === id);
  if (target && isLiveSite(target)) {
    const alreadyHasLive = sites.some(
      (s) => selectedIds.includes(s.id) && isLiveSite(s),
    );
    if (alreadyHasLive) return selectedIds;
  }
  return [...selectedIds, id];
}

/**
 * Returns the new selectedIds after a "select all / deselect all" toggle
 * over the given `visibleIds` list.
 *
 * - If all visible are selected → deselects all (returns []).
 * - Otherwise adds visible ones up to `maxSelectable`.
 */
export function toggleSelectAllIds(
  visibleIds: string[],
  selectedIds: string[],
  maxSelectable?: number,
): string[] {
  const allSelected = visibleIds.every((id) => selectedIds.includes(id));
  if (allSelected) return [];
  const toAdd = visibleIds.filter((id) => !selectedIds.includes(id));
  const slots =
    maxSelectable !== undefined ? maxSelectable - selectedIds.length : toAdd.length;
  return [...selectedIds, ...toAdd.slice(0, Math.max(0, slots))];
}
