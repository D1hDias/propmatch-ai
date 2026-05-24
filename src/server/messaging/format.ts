import 'server-only';

export interface PropertyForMessage {
  id: string;
  title?: string | null;
  propertyType: string;
  bedrooms?: number | null;
  bathrooms?: number | null;
  areaSqm?: number | null;
  parkingSpots?: number | null;
  neighborhood?: string | null;
  city: string;
  price: number | string;
  priceType: string; // 'sale' | 'rent'
  url: string;
  personalNote?: string | null;
}

export interface FormatMessageInput {
  clientName: string;
  brokerName: string;
  properties: PropertyForMessage[];
  /** Stub: MSG-3 will replace raw URLs with short links. */
  shortener?: (url: string) => string;
}

const TYPE_LABELS: Record<string, string> = {
  apartment: 'Apartamento',
  house: 'Casa',
  studio: 'Studio',
  penthouse: 'Cobertura',
  commercial: 'Comercial',
  warehouse: 'Galpão',
  land: 'Terreno',
  other: 'Imóvel',
};

function formatPrice(price: number | string, priceType: string): string {
  const num = typeof price === 'string' ? parseFloat(price) : price;
  const formatted = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  }).format(num);
  return priceType === 'rent' ? `${formatted}/mês` : formatted;
}

function specs(p: PropertyForMessage): string {
  const parts: string[] = [];
  if (p.bedrooms != null) parts.push(`${p.bedrooms} qto${p.bedrooms !== 1 ? 's' : ''}`);
  if (p.bathrooms != null) parts.push(`${p.bathrooms} bnh`);
  if (p.areaSqm != null) parts.push(`${Number(p.areaSqm).toFixed(0)} m²`);
  if (p.parkingSpots != null && p.parkingSpots > 0)
    parts.push(`${p.parkingSpots} vaga${p.parkingSpots !== 1 ? 's' : ''}`);
  return parts.join(' · ');
}

function location(p: PropertyForMessage): string {
  return p.neighborhood ? `${p.neighborhood}, ${p.city}` : p.city;
}

/**
 * Builds a PT-BR WhatsApp message listing selected properties for a client.
 * Short-link substitution is stubbed until MSG-3 is implemented.
 */
export function formatWhatsAppMessage(input: FormatMessageInput): string {
  const { brokerName, properties, shortener } = input;
  const shorten = shortener ?? ((url: string) => url);

  const lines: string[] = [
    `Olá, [NOME]! 👋`,
    `Separei alguns imóveis que combinam com o que você me passou:`,
    '',
  ];

  properties.forEach((p, i) => {
    const typeLabel = TYPE_LABELS[p.propertyType] ?? 'Imóvel';
    const priceStr = formatPrice(p.price, p.priceType);
    const specsStr = specs(p);
    const loc = location(p);
    const link = shorten(p.url);

    lines.push(`*${i + 1}. ${p.title ?? typeLabel} — ${loc}*`);
    if (specsStr) lines.push(`   ${specsStr}`);
    lines.push(`   💰 ${priceStr}`);
    lines.push(`   🔗 ${link}`);
    if (p.personalNote?.trim()) {
      lines.push(`   📝 ${p.personalNote.trim()}`);
    }
    lines.push('');
  });

  lines.push(
    `Me fale o que achou! Posso buscar mais opções se precisar.`,
    ``,
    `Abraços,`,
    brokerName,
  );

  return lines.join('\n');
}

export interface PartnerMessageInput {
  brokerName: string;
  property: PropertyForMessage;
  clientProfile: string; // brief description of the client's needs
  matchScore?: number;   // 0-100
}

/**
 * Builds a B2B WhatsApp message for contacting a partner broker about
 * a co-brokerage opportunity on a specific property.
 */
export function formatPartnerMessage(input: PartnerMessageInput): string {
  const { brokerName, property, clientProfile, matchScore } = input;
  const typeLabel = TYPE_LABELS[property.propertyType] ?? 'Imóvel';
  const priceStr = formatPrice(property.price, property.priceType);
  const specsStr = specs(property);
  const loc = location(property);
  const scoreStr = matchScore != null ? ` *(${matchScore}% de compatibilidade)*` : '';

  const lines: string[] = [
    `Olá! Tudo bem? 👋`,
    ``,
    `Sou corretor(a) e tenho um cliente com perfil que combina muito bem com o imóvel abaixo:`,
    ``,
    `*${property.title ?? typeLabel} — ${loc}*${scoreStr}`,
  ];

  if (specsStr) lines.push(`   ${specsStr}`);
  lines.push(`   💰 ${priceStr}`);
  lines.push(`   🔗 ${property.url}`);
  lines.push(``);
  lines.push(`*Perfil do meu cliente:*`);
  lines.push(clientProfile);
  lines.push(``);
  lines.push(`Teria interesse em conversarmos sobre uma parceria? Podemos dividir a comissão e fechar negócio juntos. 🤝`);
  lines.push(``);
  lines.push(`Att,`);
  lines.push(brokerName);

  return lines.join('\n');
}
