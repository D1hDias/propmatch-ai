-- SRC-12/SRC-15: Add portal_x and partner_b to PropertySource enum
-- ALTER TYPE ... ADD VALUE is irreversible in Postgres — but removing
-- these values requires no data migration (no rows use them yet).

ALTER TYPE "PropertySource" ADD VALUE IF NOT EXISTS 'portal_x';
ALTER TYPE "PropertySource" ADD VALUE IF NOT EXISTS 'partner_b';
