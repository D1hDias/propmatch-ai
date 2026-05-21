export interface PropertyTypeOption {
  value: string;
  label: string;
  category: 'residential' | 'commercial' | 'land';
}

export const PROPERTY_TYPES: PropertyTypeOption[] = [
  // Residencial
  { value: 'apartment', label: 'Apartamento', category: 'residential' },
  { value: 'house', label: 'Casa', category: 'residential' },
  { value: 'penthouse', label: 'Cobertura', category: 'residential' },
  { value: 'garden', label: 'Garden', category: 'residential' },
  { value: 'studio', label: 'Studio', category: 'residential' },
  { value: 'loft', label: 'Loft', category: 'residential' },
  { value: 'kitnet', label: 'Kitnet', category: 'residential' },
  { value: 'flat', label: 'Flat', category: 'residential' },
  { value: 'apart_hotel', label: 'Apart-hotel', category: 'residential' },
  { value: 'duplex', label: 'Duplex', category: 'residential' },
  { value: 'triplex', label: 'Triplex', category: 'residential' },
  { value: 'condo_house', label: 'Casa de condomínio', category: 'residential' },
  { value: 'semi_detached', label: 'Casa geminada', category: 'residential' },
  { value: 'mansion', label: 'Mansão', category: 'residential' },
  { value: 'farm', label: 'Fazenda', category: 'residential' },
  { value: 'rural', label: 'Sítio', category: 'residential' },
  { value: 'chacara', label: 'Chácara', category: 'residential' },
  // Terrenos
  { value: 'residential_land', label: 'Terreno residencial', category: 'land' },
  { value: 'commercial_land', label: 'Terreno comercial', category: 'land' },
  // Comercial
  { value: 'commercial_room', label: 'Sala comercial', category: 'commercial' },
  { value: 'store', label: 'Loja', category: 'commercial' },
  { value: 'corporate_floor', label: 'Andar corporativo', category: 'commercial' },
  { value: 'warehouse', label: 'Galpão', category: 'commercial' },
  { value: 'commercial_building', label: 'Prédio comercial', category: 'commercial' },
  { value: 'hotel', label: 'Hotel/Pousada', category: 'commercial' },
  { value: 'clinic', label: 'Clínica', category: 'commercial' },
  { value: 'office', label: 'Consultório', category: 'commercial' },
  { value: 'garage', label: 'Box/Garagem', category: 'commercial' },
];

export const RESIDENTIAL_TYPES = PROPERTY_TYPES.filter((t) => t.category === 'residential');
export const COMMERCIAL_TYPES = PROPERTY_TYPES.filter((t) => t.category === 'commercial');
export const LAND_TYPES = PROPERTY_TYPES.filter((t) => t.category === 'land');
