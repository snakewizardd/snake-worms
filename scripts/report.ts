// Rebuilds report.md for a saved match from its match.jsonl: node scripts/report.ts arena-logs/<match-folder>
import { writeReport } from '../arena-host/report.ts';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node scripts/report.ts arena-logs/<match-folder>');
  process.exit(1);
}
console.log(`wrote ${writeReport(dir)}`);
