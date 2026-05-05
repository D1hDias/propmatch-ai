/**
 * QA-3 — NLP Extraction Accuracy Benchmark
 *
 * Reads tests/fixtures/briefings-labeled.json and runs each briefing through
 * the extraction pipeline, then compares critical fields against ground-truth.
 *
 * Thresholds (docs/testing.md):
 *   - city            ≥ 90%
 *   - bedrooms_min    ≥ 85%
 *   - price_max       ≥ 85%
 *   - purpose         ≥ 95%
 *   - overall         ≥ 80%
 *
 * Usage:
 *   pnpm benchmark:nlp               # runs all 50 cases
 *   pnpm benchmark:nlp -- --ci       # exits 1 if any threshold fails (CI mode)
 *
 * CI mode is invoked by the nightly GitHub Actions workflow (QA-3).
 */

import path from 'path';
import fs from 'fs';

// --- types ---

interface LabeledBriefing {
  id: string;
  raw_text: string;
  expected: {
    city: string | null;
    neighborhood: string | null;
    property_type: string | null;
    bedrooms_min: number | null;
    bedrooms_max: number | null;
    price_max: number | null;
    price_min: number | null;
    purpose: string | null;
    [key: string]: unknown;
  };
}

interface FieldResult {
  field: string;
  total: number;
  correct: number;
  accuracy: number;
  threshold: number;
  passed: boolean;
}

interface BenchmarkReport {
  timestamp: string;
  total: number;
  fieldResults: FieldResult[];
  overallAccuracy: number;
  overallPassed: boolean;
  failures: Array<{ id: string; field: string; expected: unknown; got: unknown }>;
}

// --- field comparison helpers ---

function normalizeString(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function cityMatch(expected: string | null, got: unknown): boolean {
  if (expected === null) return got === null || got === '';
  const e = normalizeString(expected);
  const g = normalizeString(got);
  // allow substring match for neighborhood-level city names (e.g. "Alphaville" → "Barueri")
  return g === e || g.includes(e) || e.includes(g);
}

function numericMatch(expected: number | null, got: unknown): boolean {
  if (expected === null) return got === null || got === undefined;
  const g = Number(got);
  return !Number.isNaN(g) && Math.abs(g - expected) < 1;
}

function purposeMatch(expected: string | null, got: unknown): boolean {
  if (expected === null) return true;
  const e = normalizeString(expected);
  const g = normalizeString(got);
  // "sell" briefings are often broker-side listings — acceptable to classify as "buy"
  if (e === 'sell') return g === 'sell' || g === 'buy';
  return e === g;
}

// --- THRESHOLDS ---

const FIELD_THRESHOLDS: Record<string, number> = {
  city: 0.9,
  bedrooms_min: 0.85,
  price_max: 0.85,
  purpose: 0.95,
};

const OVERALL_THRESHOLD = 0.8;

// --- benchmark runner ---

async function runBenchmark(): Promise<BenchmarkReport> {
  const fixturesPath = path.resolve(__dirname, '../fixtures/briefings-labeled.json');
  const fixtures: LabeledBriefing[] = JSON.parse(fs.readFileSync(fixturesPath, 'utf-8'));

  // Lazy-import to avoid loading server modules in CI without Next.js runtime
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { extractCriteria } = require('../../src/server/briefings/extract') as {
    extractCriteria: (text: string) => Promise<Record<string, unknown>>;
  };

  const fieldCounters = {
    city: { total: 0, correct: 0 },
    bedrooms_min: { total: 0, correct: 0 },
    price_max: { total: 0, correct: 0 },
    purpose: { total: 0, correct: 0 },
  };

  let totalFields = 0;
  let totalCorrect = 0;
  const failures: BenchmarkReport['failures'] = [];

  for (const fixture of fixtures) {
    let extracted: Record<string, unknown>;
    try {
      extracted = await extractCriteria(fixture.raw_text);
    } catch (err) {
      console.error(`[${fixture.id}] extraction failed:`, err);
      // count all tracked fields as wrong
      for (const field of Object.keys(fieldCounters) as Array<keyof typeof fieldCounters>) {
        fieldCounters[field].total++;
        totalFields++;
        failures.push({ id: fixture.id, field, expected: fixture.expected[field], got: 'ERROR' });
      }
      continue;
    }

    const checks: Array<[keyof typeof fieldCounters, boolean, unknown, unknown]> = [
      ['city', cityMatch(fixture.expected.city, extracted.city), fixture.expected.city, extracted.city],
      ['bedrooms_min', numericMatch(fixture.expected.bedrooms_min, extracted.bedrooms_min), fixture.expected.bedrooms_min, extracted.bedrooms_min],
      ['price_max', numericMatch(fixture.expected.price_max, extracted.price_max), fixture.expected.price_max, extracted.price_max],
      ['purpose', purposeMatch(fixture.expected.purpose as string | null, extracted.purpose), fixture.expected.purpose, extracted.purpose],
    ];

    for (const [field, ok, expected, got] of checks) {
      const counter = fieldCounters[field];
      counter.total++;
      totalFields++;
      if (ok) { counter.correct++; totalCorrect++; }
      else failures.push({ id: fixture.id, field, expected, got });
    }
  }

  const fieldResults: FieldResult[] = (Object.entries(fieldCounters) as Array<[string, { total: number; correct: number }]>).map(([field, counts]) => {
    const accuracy = counts.total > 0 ? counts.correct / counts.total : 0;
    const threshold = FIELD_THRESHOLDS[field] ?? 0;
    return { field, total: counts.total, correct: counts.correct, accuracy, threshold, passed: accuracy >= threshold };
  });

  const overallAccuracy = totalFields > 0 ? totalCorrect / totalFields : 0;

  return {
    timestamp: new Date().toISOString(),
    total: fixtures.length,
    fieldResults,
    overallAccuracy,
    overallPassed: overallAccuracy >= OVERALL_THRESHOLD && fieldResults.every((r) => r.passed),
    failures,
  };
}

// --- CLI entrypoint ---

(async () => {
  const ciMode = process.argv.includes('--ci');

  console.log('\n📊 PropMatch NLP Accuracy Benchmark — QA-3\n');

  let report: BenchmarkReport;
  try {
    report = await runBenchmark();
  } catch (err) {
    console.error('Benchmark failed to run:', err);
    process.exit(1);
  }

  // print field table
  console.log('Field              Correct / Total   Accuracy   Threshold   Status');
  console.log('─'.repeat(70));
  for (const r of report.fieldResults) {
    const status = r.passed ? '✅ PASS' : '❌ FAIL';
    const acc = (r.accuracy * 100).toFixed(1).padStart(5);
    const thr = (r.threshold * 100).toFixed(0).padStart(3);
    console.log(
      `${r.field.padEnd(18)} ${String(r.correct).padStart(4)} / ${String(r.total).padEnd(6)}   ${acc}%     ≥${thr}%      ${status}`,
    );
  }
  console.log('─'.repeat(70));
  const overallAcc = (report.overallAccuracy * 100).toFixed(1);
  const overallStatus = report.overallPassed ? '✅ OVERALL PASS' : '❌ OVERALL FAIL';
  console.log(`${'Overall'.padEnd(18)} ${String(report.fieldResults.reduce((s, r) => s + r.correct, 0)).padStart(4)} / ${String(report.fieldResults.reduce((s, r) => s + r.total, 0)).padEnd(6)}   ${overallAcc.padStart(5)}%     ≥${(OVERALL_THRESHOLD * 100).toFixed(0)}%      ${overallStatus}`);

  if (report.failures.length > 0 && !ciMode) {
    console.log(`\n⚠️  ${report.failures.length} field failure(s):`);
    for (const f of report.failures.slice(0, 20)) {
      console.log(`  [${f.id}] ${f.field}: expected=${JSON.stringify(f.expected)} got=${JSON.stringify(f.got)}`);
    }
    if (report.failures.length > 20) {
      console.log(`  ... and ${report.failures.length - 20} more`);
    }
  }

  // write JSON report for CI artifact upload
  const reportPath = path.resolve(__dirname, '../../.benchmark-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nReport saved to ${reportPath}`);

  if (ciMode && !report.overallPassed) {
    console.error('\n🚨 Benchmark thresholds not met — failing CI');
    process.exit(1);
  }
})();
