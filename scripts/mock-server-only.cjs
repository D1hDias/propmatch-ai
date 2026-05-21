// Mock para server-only ao rodar scripts tsx fora do Next.js
require.cache[require.resolve('server-only')] = {
  id: 'server-only',
  filename: 'server-only',
  loaded: true,
  exports: {},
  paths: [],
  parent: null,
  children: [],
};
