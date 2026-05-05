import 'server-only';
import type { HealthStatus, NormalizedListing, SearchCriteria, SourceAdapter } from '../types';

/**
 * Mock adapter — used in unit tests and local dev when real scrapers are disabled.
 * Returns deterministic fake listings based on criteria.
 * Activated by setting SOURCE_MOCK=true env var.
 */
export const mockAdapter: SourceAdapter = {
  name: 'mock',

  async search(criteria: SearchCriteria): Promise<NormalizedListing[]> {
    const priceMax = criteria.priceMax ?? (criteria.purpose === 'rent' ? 5000 : 800000);
    const bedrooms = criteria.bedroomsMin ?? 2;
    const neighborhood = criteria.neighborhood ?? 'Vila Mariana';

    return [1, 2, 3, 4, 5].map((i) => ({
      source: 'mock' as const,
      externalId: `mock-${i}`,
      url: `https://mock.propmatch.local/imovel/mock-${i}`,
      title: `Apartamento ${bedrooms} quartos em ${neighborhood} — Mock ${i}`,
      description: `Excelente apartamento com ${bedrooms} quartos em ${neighborhood}. Portaria 24h, academia, piscina. Pet friendly. Área de serviço.`,
      photos: [
        `https://via.placeholder.com/400x300?text=Mock+${i}`,
        `https://via.placeholder.com/400x300?text=Mock+${i}+B`,
      ],
      address: `Rua Mock ${i * 100}, ${neighborhood}, ${criteria.city}`,
      neighborhood,
      city: criteria.city,
      state: 'SP',
      propertyType: criteria.propertyType ?? 'apartment',
      bedrooms,
      bathrooms: 1 + (i % 2),
      areaSqm: 60 + i * 10,
      parkingSpots: i % 3 === 0 ? 0 : 1,
      price: Math.round(priceMax * (0.7 + i * 0.06)),
      priceType: criteria.purpose === 'rent' ? 'rent' : 'sale',
      furnished: i % 2 === 0,
      amenities: ['portaria 24h', 'academia', 'piscina'],
      extractedAmenities: {
        portaria24h: true,
        portariaVirtual: false,
        petFriendly: true,
        academia: true,
        piscina: true,
        churrasqueira: false,
        salaoFestas: false,
        playground: false,
        quadraEsportiva: false,
        elevador: true,
        varanda: i % 2 === 0,
        varandaGourmet: false,
        garden: false,
        duplex: false,
        triplex: false,
        cobertura: false,
        areaServico: true,
        deposito: false,
        arCondicionado: false,
        aquecimentoSolar: false,
        energiaSolar: false,
        generador: false,
        infraCabeamento: false,
        acessibilidade: false,
        vistaMar: false,
        vistaLagoa: false,
      },
      geohash7: '6gyf4rz',
      lat: -23.5489 + i * 0.001,
      lng: -46.6388 + i * 0.001,
      scrapedAt: new Date().toISOString(),
    }));
  },

  async healthCheck(): Promise<HealthStatus> {
    return {
      source: 'mock',
      healthy: true,
      successRate: 1,
      lastCheckedAt: new Date().toISOString(),
    };
  },
};
