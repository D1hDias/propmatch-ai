import '@testing-library/jest-dom';
import { vi } from 'vitest';

// server-only is a Next.js build-time guard; mock it so server modules
// can be imported and unit-tested outside the Next.js runtime.
vi.mock('server-only', () => ({}));
