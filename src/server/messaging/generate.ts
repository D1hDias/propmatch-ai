import 'server-only';
import { callLLM } from '@/server/lib/llm';
import { MODELS } from '@/server/lib/models';
import { logger } from '@/server/lib/logger';
import {
  formatWhatsAppMessage,
  formatPartnerMessage,
  type FormatMessageInput,
  type PartnerMessageInput,
  type PropertyForMessage,
} from './format';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPrice(price: number | string, priceType: string): string {
  const num = typeof price === 'string' ? parseFloat(price) : price;
  const formatted = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  }).format(num);
  return priceType === 'rent' ? `${formatted}/mês` : formatted;
}

function propertyContext(p: PropertyForMessage, shortLink: string): string {
  const parts: string[] = [];
  if (p.title) parts.push(`Título: ${p.title}`);
  const loc = p.neighborhood ? `${p.neighborhood}, ${p.city}` : p.city;
  parts.push(`Localização: ${loc}`);
  if (p.bedrooms != null) parts.push(`Quartos: ${p.bedrooms}`);
  if (p.bathrooms != null) parts.push(`Banheiros: ${p.bathrooms}`);
  if (p.areaSqm != null) parts.push(`Área: ${Number(p.areaSqm).toFixed(0)} m²`);
  if (p.parkingSpots != null && p.parkingSpots > 0) parts.push(`Vagas: ${p.parkingSpots}`);
  parts.push(`Preço: ${formatPrice(p.price, p.priceType)}`);
  parts.push(`Link: ${shortLink}`);
  if (p.personalNote?.trim()) parts.push(`Observação do corretor: ${p.personalNote.trim()}`);
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Client message
// ---------------------------------------------------------------------------

export interface GenerateClientMessageInput extends FormatMessageInput {
  clientCriteriaSummary?: string; // e.g. "2+ quartos, até R$2.5M, Gávea, compra"
  shortLinks: Map<string, string>;  // original url → short url
}

export async function generateClientMessageLLM(
  input: GenerateClientMessageInput,
): Promise<string> {
  const { brokerName, properties, clientCriteriaSummary, shortLinks } = input;

  const propertiesBlock = properties
    .map((p, i) => {
      const link = shortLinks.get(p.url) ?? p.url;
      return `Imóvel ${i + 1}:\n${propertyContext(p, link)}`;
    })
    .join('\n\n');

  const criteriaLine = clientCriteriaSummary
    ? `\nCritérios da busca do cliente: ${clientCriteriaSummary}`
    : '';

  const prompt = `Você é ${brokerName}, corretor(a) de imóveis profissional no Brasil. Escreva uma mensagem de WhatsApp apresentando os imóveis abaixo para um cliente.${criteriaLine}

${propertiesBlock}

Instruções:
- Escreva em português brasileiro, tom caloroso e profissional
- Use formatação WhatsApp: *negrito* para o título de cada imóvel
- Inicie EXATAMENTE com: "Oi, [NOME], tudo bem? " — não substitua [NOME], deixe exatamente assim; deixe duas linhas em branco após essa linha
- Na sequência, escreva EXATAMENTE: "Separei alguns imóveis que eventualmente podem fazer sentido pra você. Dá uma olhada abaixo e caso goste de algum, apenas me informe a numeração pra que eu possa verificar a disponibilidade."
- Depois da introdução, escreva EXATAMENTE "Seleção:" em uma linha própria, seguida de uma linha em branco
- Para cada imóvel, siga este formato:
  ✨ *[Tipo] de [área] m² em [Bairro] - [Cidade]*
  [Um parágrafo curto e atraente destacando 1 ou 2 diferenciais do imóvel para o perfil do cliente]
  Preço: [valor formatado em BRL]
  🔗 [link do imóvel, ou "(Sem link fornecido)" caso não haja]
  [linha em branco]
- Se houver "Observação do corretor" para um imóvel, incorpore-a naturalmente no parágrafo descritivo
- Não invente especificações que não foram fornecidas
- Finalize a mensagem EXATAMENTE com:
  "Seguimos à disposição.

  Um abraço,
  ${brokerName}"
- Retorne APENAS o texto da mensagem, sem explicações adicionais`;

  const response = await callLLM({
    model: MODELS.whatsAppMessage,
    prompt,
    maxTokens: 1200,
    timeoutMs: 20_000,
    maxAttempts: 2,
  });

  return response.content[0]?.text?.trim() ?? '';
}

// ---------------------------------------------------------------------------
// Partner message
// ---------------------------------------------------------------------------

export interface GeneratePartnerMessageInput extends PartnerMessageInput {
  shortLink: string;
}

export async function generatePartnerMessageLLM(
  input: GeneratePartnerMessageInput,
): Promise<string> {
  const { brokerName, property, clientProfile, shortLink } = input;

  const propCtx = propertyContext(property, shortLink);

  const prompt = `Você é ${brokerName}, corretor(a) de imóveis profissional no Brasil. Escreva uma mensagem de WhatsApp para enviar ao corretor(a) responsável pelo imóvel abaixo, propondo uma parceria de venda conjunta.

Imóvel:
${propCtx}

Perfil do seu cliente: ${clientProfile}

Instruções:
- Escreva em português brasileiro, tom profissional e direto
- Use formatação WhatsApp: *negrito* para o nome/endereço do imóvel
- Mencione brevemente o perfil do seu cliente e por que ele combina com o imóvel
- Proponha divisão de comissão de forma natural (sem citar percentuais — deixe para negociar)
- Seja conciso: máximo 150 palavras
- Assine com "Att," e seu nome (${brokerName})
- Retorne APENAS o texto da mensagem, sem explicações adicionais`;

  const response = await callLLM({
    model: MODELS.whatsAppMessage,
    prompt,
    maxTokens: 500,
    timeoutMs: 15_000,
    maxAttempts: 2,
  });

  return response.content[0]?.text?.trim() ?? '';
}

// ---------------------------------------------------------------------------
// Public generators with static fallback
// ---------------------------------------------------------------------------

export async function generateClientMessage(
  input: GenerateClientMessageInput,
): Promise<string> {
  try {
    const text = await generateClientMessageLLM(input);
    if (text) return text;
    logger.warn('LLM returned empty client message — falling back to template');
  } catch (err) {
    logger.warn('LLM client message generation failed — falling back to template', {
      error: String(err),
    });
  }
  return formatWhatsAppMessage({
    clientName: input.clientName,
    brokerName: input.brokerName,
    properties: input.properties,
    shortener: (url) => input.shortLinks.get(url) ?? url,
  });
}

export async function generatePartnerMessage(
  input: GeneratePartnerMessageInput,
): Promise<string> {
  try {
    const text = await generatePartnerMessageLLM(input);
    if (text) return text;
    logger.warn('LLM returned empty partner message — falling back to template');
  } catch (err) {
    logger.warn('LLM partner message generation failed — falling back to template', {
      error: String(err),
    });
  }
  return formatPartnerMessage({
    brokerName: input.brokerName,
    property: input.property,
    clientProfile: input.clientProfile,
  });
}
