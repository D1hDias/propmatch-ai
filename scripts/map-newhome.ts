import 'server-only';
import FirecrawlApp from '@mendable/firecrawl-js';

async function main() {
  const apiKey = process.env.FIRECRAWL_API_KEY!;
  const apiUrl = process.env.FIRECRAWL_API_URL;
  const fc = new FirecrawlApp({ apiKey, apiUrl });

  console.log('Mapping https://www.imoveisnewhome.com.br ...');
  const result = await fc.map('https://www.imoveisnewhome.com.br', { limit: 100 });
  const links: string[] = (result.links ?? []).map((l: string | { url: string }) =>
    typeof l === 'string' ? l : l.url
  );

  console.log(`Total links: ${links.length}`);
  console.log('\n--- Listing/search pages ---');
  const listingHints = /imoveis|venda|aluguel|locacao|busca|search|resultados|lista|compra/i;
  const listing = links.filter(l => listingHints.test(l));
  listing.forEach(l => console.log(' ', l));

  console.log('\n--- Property detail pages (sample) ---');
  const propHints = /imovel|anuncio|detalhe|property|ficha|-id-/i;
  const props = links.filter(l => propHints.test(l)).slice(0, 10);
  props.forEach(l => console.log(' ', l));

  console.log('\n--- All other links (first 20) ---');
  const other = links.filter(l => !listingHints.test(l) && !propHints.test(l)).slice(0, 20);
  other.forEach(l => console.log(' ', l));
}

main().catch(console.error);
