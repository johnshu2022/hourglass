const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../docs/entry.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../docs/styles.css'), 'utf8');
test('original month calendar remains native and in the Shift History action toolbar', () => {
  const actions = html.match(/<div class="history-actions">([\s\S]*?)<\/div>/)?.[1];
  assert.ok(actions);
  assert.match(actions, /<input type="month" id="month-filter">/);
  assert.doesNotMatch(actions, /id="validation-filter"/);
  assert.equal((html.match(/id="month-filter"/g) || []).length, 1);
  assert.match(html, /<input id="work-date" type="date" required>/);
});
test('validation filtering remains available in a separate control row', () => {
  assert.match(html, /class="validation-toolbar"/);
  const tool = html.match(/<div class="validation-toolbar">([\s\S]*?)<\/label>/)?.[1];
  assert.ok(tool);
  assert.match(tool, /id="validation-progress"/);
  assert.match(tool, /id="validation-filter"/);
  assert.match(css, /\.validation-toolbar/);
});
