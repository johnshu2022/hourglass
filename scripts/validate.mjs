import { execFileSync } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDirectoryName = 'docs';
const publicDirectory = path.join(repositoryRoot, publicDirectoryName);
const errors = [];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolutePath));
    if (entry.isFile()) files.push(absolutePath);
  }
  return files;
}

function relative(file) {
  return path.relative(repositoryRoot, file).split(path.sep).join('/');
}

function fail(file, message) {
  errors.push(`${relative(file)}: ${message}`);
}

const requiredFiles = [
  '.nojekyll',
  'index.html',
  'entry.html',
  'payments.html',
  'settings.html',
  'styles.css',
  'daily-rounding.js',
  'shared.js',
  'dashboard.js',
  'entries.js',
  'settings.js',
  'payments.js',
  'build-version.txt'
];

const forbiddenRepositoryPaths = [
  '.github/workflows',
  'docs/_config.yml',
  'docs/Gemfile',
  'docs/Gemfile.lock',
  'docs/_layouts',
  'docs/_includes',
  'docs/_posts',
  'docs/assets/css/style.scss'
];

try {
  const rootNoJekyll = await stat(path.join(repositoryRoot, '.nojekyll'));
  if (!rootNoJekyll.isFile()) errors.push('.nojekyll: required path is not a file');
} catch {
  errors.push('.nojekyll: required repository-level Jekyll bypass file is missing');
}

for (const forbiddenPath of forbiddenRepositoryPaths) {
  try {
    await stat(path.join(repositoryRoot, forbiddenPath));
    errors.push(`${forbiddenPath}: remove this Jekyll or custom workflow path before publishing`);
  } catch {
    // The path is intentionally absent.
  }
}

for (const requiredFile of requiredFiles) {
  try {
    const details = await stat(path.join(publicDirectory, requiredFile));
    if (!details.isFile()) errors.push(`${publicDirectoryName}/${requiredFile}: required path is not a file`);
  } catch {
    errors.push(`${publicDirectoryName}/${requiredFile}: required file is missing`);
  }
}

const files = await walk(publicDirectory);
const htmlFiles = files.filter((file) => file.endsWith('.html'));
const javaScriptFiles = files.filter((file) => file.endsWith('.js'));

for (const file of javaScriptFiles) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (error) {
    fail(file, `JavaScript syntax check failed\n${String(error.stderr || error.message).trim()}`);
  }
}

for (const file of htmlFiles) {
  const html = await readFile(file, 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  if (duplicateIds.length) fail(file, `duplicate IDs: ${duplicateIds.join(', ')}`);

  if (!html.includes('http-equiv="Content-Security-Policy"')) fail(file, 'Content Security Policy is missing');
  if (!html.includes('name="referrer" content="no-referrer"')) fail(file, 'no-referrer policy is missing');
  if (/<script\b(?![^>]*\bsrc=)[^>]*>/i.test(html)) fail(file, 'inline script found');
  if (/\son[a-z]+\s*=/i.test(html)) fail(file, 'inline event handler found');

  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const reference = match[1];
    if (/^(?:#|data:|blob:|mailto:|tel:|https:)/i.test(reference)) continue;
    if (/^(?:javascript:|http:)/i.test(reference)) {
      fail(file, `unsafe reference: ${reference}`);
      continue;
    }
    if (reference.startsWith('/')) {
      fail(file, `root-relative path can break project GitHub Pages sites: ${reference}`);
      continue;
    }
    const cleanReference = reference.split('#')[0].split('?')[0];
    if (!cleanReference) continue;
    const target = path.resolve(path.dirname(file), cleanReference);
    if (!target.startsWith(publicDirectory + path.sep)) {
      fail(file, `reference escapes ${publicDirectoryName}: ${reference}`);
      continue;
    }
    try {
      await stat(target);
    } catch {
      fail(file, `missing local asset: ${reference}`);
    }
  }
}

const sensitivePatterns = [
  /(^|\/)\.env(?:\.|$)/i,
  /hourglass-full-backup-.*\.json$/i,
  /hourglass-time-entries-.*\.(?:csv|pdf)$/i,
  /(?:^|\/)(?:credentials?|secrets?)(?:\.|$)/i,
  /\.(?:key|pem|p12|pfx)$/i,
  /(?:^|\/)id_(?:rsa|ed25519)/i
];

for (const file of files) {
  const publicPath = relative(file);
  if (sensitivePatterns.some((pattern) => pattern.test(publicPath))) {
    fail(file, 'possible private export, credential, or secret must not be published');
  }
}

if (errors.length) {
  console.error(`Hourglass validation failed with ${errors.length} problem${errors.length === 1 ? '' : 's'}:`);
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log(`Hourglass validation passed: ${htmlFiles.length} HTML pages, ${javaScriptFiles.length} JavaScript files, ${files.length} published files.`);
