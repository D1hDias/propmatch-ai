# ADR-0006: Source Adapter Interface for Multi-Source Search

**Status:** Accepted
**Date:** 2026-05-04
**Author:** Tech Lead, Scraping Engineer

## Context

PropMatch AI queries multiple property data sources to assemble a search result. MVP launches with two sources: a partner API (Source 1) and a scraped portal (Source 2). PRD §3.4 mandates a third source (Source 3) be contractually swap-ready as contingency for Source 2 — activatable via feature flag within 24h of Source 2 health degradation.

This is only possible if all sources implement a common interface. The interface must be designed in Sprint 1 (or very early Sprint 3 at the latest) to avoid each source's integration locking us into a different shape.

## Alternatives considered

### Alternative A: Common abstract base class with strict interface
- Pro: Sources are interchangeable; feature-flag swaps are real.
- Pro: Test fixtures can substitute mock adapters trivially.
- Pro: New sources have a clear template to implement against.
- Con: Real APIs vary; some operations don't fit cleanly into one shape.

### Alternative B: Loose protocol — services all return some form of "list of properties"
- Pro: Maximally flexible.
- Con: search-svc has to special-case every source; no real interchangeability.
- Con: Source 3 contingency becomes aspirational, not real.

### Alternative C: Per-source service (each source is its own microservice)
- Pro: Maximum isolation.
- Con: Wildly over-architected for our scale.
- Con: Operational overhead.

## Decision

**Common abstract base class.** Define `SourceAdapter` in Python with three required methods: `search(criteria)`, `health_check()`, `normalize_listing(raw)`. Each concrete source implements the class. search-svc orchestrates them via a registry keyed by feature flag.

## Decision details

### Interface

```python
from abc import ABC, abstractmethod
from typing import AsyncIterator
from search.models import SearchCriteria, NormalizedListing, HealthStatus

class SourceAdapter(ABC):
    """
    Common interface every property data source implements.
    Source registry maps source IDs to adapter instances; feature flags
    determine which adapters are active for a given search.
    """

    source_id: str  # e.g., "partner_a", "portal_x", "partner_b"
    
    @abstractmethod
    async def search(self, criteria: SearchCriteria) -> AsyncIterator[NormalizedListing]:
        """
        Query the source for listings matching the criteria.
        
        - Must respect the source's rate limits.
        - Must time out after 5 seconds; partial results acceptable.
        - Must yield NormalizedListing instances, not raw source data.
        - Must propagate cancellation if the search-svc orchestrator cancels.
        """
        ...
    
    @abstractmethod
    async def health_check(self) -> HealthStatus:
        """
        Quick check that the source is reachable and returning sane data.
        
        - Must complete within 2 seconds.
        - Returns HealthStatus.OK / DEGRADED / DOWN.
        - Called every 60 seconds by the source health monitor.
        """
        ...
    
    @abstractmethod
    def normalize_listing(self, raw: dict) -> NormalizedListing:
        """
        Convert source-specific listing format to NormalizedListing.
        
        - Pure function; no I/O.
        - Used by tests with fixture data.
        """
        ...
```

### NormalizedListing

```python
@dataclass(frozen=True)
class NormalizedListing:
    source_id: str
    source_listing_id: str
    address: str
    city: str
    neighborhood: str | None
    latitude: float | None
    longitude: float | None
    price: Decimal
    bedrooms: int | None
    area_m2: Decimal | None
    amenities: list[str]
    description: str
    photos: list[str]  # URLs
    source_url: str
    fetched_at: datetime
```

### Source registry and feature flags

```python
SOURCE_REGISTRY: dict[str, type[SourceAdapter]] = {
    "partner_a": PartnerAAdapter,
    "portal_x": PortalXAdapter,
    "partner_b": PartnerBAdapter,  # Source 3 contingency
}

def active_sources() -> list[SourceAdapter]:
    """
    Return adapter instances for all sources currently enabled.
    Feature flags: source.partner_a.enabled, source.portal_x.enabled, source.partner_b.enabled
    """
    return [
        SOURCE_REGISTRY[sid]()
        for sid in SOURCE_REGISTRY
        if feature_flag(f"source.{sid}.enabled")
    ]
```

Activating Source 3 contingency is a single feature-flag flip: enable `source.partner_b.enabled`, optionally disable `source.portal_x.enabled`. No code change. No deploy. Targeted rollout possible (5% → 50% → 100%) for canary verification.

### Contract requirements (per PRD §3.4)

Every source partnership contract must support:
- 99% monthly uptime SLA.
- 60-day termination notice.
- Daily rate limit ≥ 10K queries.
- Filter set: city, neighborhood, bedrooms, price range, geo bounding box.

Adapters that cannot meet the contract are not registered. The contract template is held by the partnership lead.

### Pre-MVP delivery (per PRD §9.4 risk mitigation)

By Wk9, Source 3 (`partner_b`) must:
- Have a signed agreement.
- Have an implemented adapter.
- Pass adapter unit tests against staging endpoint.
- Pass health check from production search-svc with feature flag in disabled state (i.e., the adapter is loaded and tested but not serving traffic).

This makes the 24h activation SLA real, not aspirational.

## Consequences

### Positive
- Source 3 contingency is operationally real, not a slide.
- New sources have a clear template; integration time is bounded.
- Unit tests substitute mock adapters trivially.
- Feature flags enable canary rollouts, regional rollouts, A/B tests.

### Negative
- Some source-specific features won't fit the common interface (e.g., a portal's unique amenity vocabulary). Those are stored in `NormalizedListing.amenities` as best-effort strings; richer treatment is post-MVP.
- The interface is harder to evolve once multiple adapters implement it. Versioning the interface (v1, v2) is the planned path; we'll cross that bridge when we get there.

### Neutral
- The interface lives in `services/search-svc/src/search/sources/base.py`. Concrete adapters in `services/search-svc/src/search/sources/`.

## When to revisit

- If we expand to international markets and a new source has fundamentally different shape (e.g., commercial listings with different attributes).
- If the interface accumulates `Optional` fields to the point that it stops being meaningful.
- If we need streaming partial results across the interface (currently the AsyncIterator is per-source, not aggregated).

## References

- PRD §3.4 (Source 3 Contract Template)
- PRD §6.2, US-02 (Multi-source search AC6: Source 3 configurable as drop-in replacement)
- Sprint 3 tickets (forthcoming)
- `docs/ops/runbook-source-failover.md`
