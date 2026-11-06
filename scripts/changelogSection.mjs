import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Returns the body of the "## <version>" section of a changelog, or null if there is none.
export const changelogSection = (changelog, version) => {
  const lines = changelog.split(/\r?\n/);
  const heading = (line) => line.startsWith('## ');
  const start = lines.findIndex((line) => heading(line) && line.slice(3).trim().split(/\s+/)[0] === version);
  if (start === -1) return null;
  const next = lines.findIndex((line, i) => i > start && heading(line));
  return lines.slice(start + 1, next === -1 ? undefined : next).join('\n').trim();
};

// Usage: node scripts/changelogSection.mjs 0.1.0 [CHANGELOG.md]
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [version, file = 'CHANGELOG.md'] = process.argv.slice(2);
  const section = version ? changelogSection(readFileSync(file, 'utf8'), version) : null;
  if (!section) {
    console.error(`No "## ${version}" section found in ${file}`);
    process.exit(1);
  }
  console.log(section);
}
