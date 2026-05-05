import 'server-only';
import argon2 from 'argon2';

// Parameters from docs/security.md
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MiB
  timeCost: 3,       // iterations
  parallelism: 4,
  hashLength: 32,
};

function getPepper(): string {
  return process.env.ARGON2_PEPPER ?? '';
}

export async function hashPassword(plaintext: string): Promise<string> {
  return argon2.hash(plaintext + getPepper(), ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, plaintext: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plaintext + getPepper());
  } catch {
    return false;
  }
}
