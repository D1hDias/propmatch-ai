import { faker } from '@faker-js/faker/locale/pt_BR';

export interface UserFactory {
  name: string;
  email: string;
  password: string;
  phone: string;
  lgpd_consent: true;
}

export function makeUser(overrides: Partial<UserFactory> = {}): UserFactory {
  return {
    name: faker.person.fullName(),
    email: faker.internet.email().toLowerCase(),
    password: faker.internet.password({ length: 12, memorable: false }),
    phone: `+5511${faker.string.numeric(9)}`,
    lgpd_consent: true,
    ...overrides,
  };
}

export interface AgencyFactory {
  name: string;
  seat_count: number;
}

export function makeAgency(overrides: Partial<AgencyFactory> = {}): AgencyFactory {
  return {
    name: `${faker.company.name()} Imóveis`,
    seat_count: faker.number.int({ min: 1, max: 20 }),
    ...overrides,
  };
}
