// Build 38: individual shift validation and backwards-compatible persistence.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function launch() {
  const data = new Map();
  const localStorage = {
    get length() { return data.size; },
    key(n) { return [...data.keys()][n] ?? null; },
    getItem(k) { return data.has(k) ? data.get(k) : null; },
    setItem(k, v) { data.set(k, String(v)); },
    removeItem(k) { data.delete(k); }
  };
  const context = { window: null, localStorage, Intl, Date, Number, Math, Map, Set, JSON };
  context.window = context;
  vm.createContext(context);
  for (const file of ['daily-rounding.js', 'shared.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs', file), 'utf8'), context, { filename: file });
  }
  return { H: context.Hourglass, localStorage };
}

function sample(id, opts={}) {
  return Object.assign({ id, job:'LCC', date:'2026-11-11', clockIn:'13:00', clockOut:'17:00', breaks:[], breakMinutesOverride:0 }, opts);
}

test('existing saved shifts default to Needs review without altering exact hours or rounding', () => {
  const {H} = launch();
  H.saveSettings({jobs:[{name:'LCC',roundingMode:'period'}]});
  H.saveShifts([sample('1'), sample('2', {clockIn:'18:00',clockOut:'19:00'})]);
  assert.equal(H.getValidationSummary().pending, 2);
  for (const s of H.getShifts()) {
    assert.equal(s.validated,false);
    assert.equal(s.validatedAt,'');
  }
  assert.equal(H.getReportedMinutes(H.getShifts()),300);
});

test('two shifts on the same date validate independently and record a real ISO timestamp', () => {
  const {H} = launch();
  H.saveShifts([sample('1'),sample('2',{clockIn:'18:00',clockOut:'19:00'})]);
  const prior = Date.now();
  const checked = H.setShiftValidation('1',true);
  assert.equal(checked.validated,true);
  assert.ok(Date.parse(checked.validatedAt)>=prior-1000);
  assert.ok(Date.parse(checked.validatedAt)<=Date.now()+1000);
  assert.equal(H.getShifts().find(s=>s.id==='2').validated,false);
  assert.equal(H.getValidationSummary().validated,1);
  assert.equal(H.getValidationSummary().pending,1);
  assert.equal(H.setShiftValidation('1',true).validatedAt,checked.validatedAt,'repeat check does not move timestamp');
});

test('uncheck clears timestamp, and recheck stamps anew', () => {
  const {H}=launch();
  H.saveShifts([sample('x')]);
  H.setShiftValidation('x',true);
  const unchecked=H.setShiftValidation('x',false);
  assert.equal(unchecked.validated,false);
  assert.equal(unchecked.validatedAt,'');
  assert.equal(H.getValidationSummary().pending,1);
  assert.ok(H.setShiftValidation('x',true).validatedAt);
  assert.throws(()=>H.setShiftValidation('missing',true),/not found/i);
  assert.throws(()=>H.setShiftValidation('x','true'),/true or false/i);
});

test('changing worked-time fields invalidates review, even if caller carries old timestamp', () => {
  const changes=[
    {date:'2026-11-10'}, {job:'Another'}, {clockIn:'13:01'}, {clockOut:'17:02'},
    {breakMinutesOverride:10}, {breaks:[{start:'14:00',end:'14:10'}]}
  ];
  for(const change of changes){
    const {H}=launch();
    H.saveShifts([sample('x')]);
    H.setShiftValidation('x',true);
    H.saveShifts([Object.assign({},H.getShifts()[0],change)]);
    const after=H.getShifts()[0];
    assert.equal(after.validated,false,JSON.stringify(change));
    assert.equal(after.validatedAt,'',JSON.stringify(change));
  }
});

test('note-only updates keep validation even when older edit forms omit metadata', () => {
  const {H}=launch();
  H.saveShifts([sample('x')]);
  H.setShiftValidation('x',true);
  const before=H.getShifts()[0];
  const oldCaller=sample('x',{notes:'Inspection complete'});
  H.saveShifts([oldCaller]);
  const after=H.getShifts()[0];
  assert.equal(after.validated,true);
  assert.equal(after.validatedAt,before.validatedAt);
  assert.equal(after.notes,'Inspection complete');
  H.saveShifts([Object.assign({},after,{image:'data:image/png;base64,AAA='})]);
  assert.equal(H.getShifts()[0].validated,true);
});

test('full JSON backup/restore keeps per-profile validation data and legacy shifts unverified', () => {
  const {H}=launch();
  H.saveShifts([sample('v'),sample('old',{clockIn:'18:00',clockOut:'19:00'})]);
  H.setShiftValidation('v',true);
  const original=H.getShifts();
  const second=H.createProfile('Second');
  H.setActiveProfile(second.id);
  H.saveShifts([sample('other')]);
  H.setActiveProfile('default');
  const backup=H.createFullBackup();
  assert.equal(backup.profiles.length,2);
  assert.equal(backup.profiles[0].shifts[0].validatedAt,original[0].validatedAt);
  assert.equal(H.validateFullBackup(backup).profiles[0].shifts[0].validated,true);
  H.saveShifts([]);
  H.restoreFullBackup(backup);
  assert.equal(H.getShifts()[0].validated,true);
  assert.equal(H.getShifts()[0].validatedAt,original[0].validatedAt);
  assert.equal(H.getShifts()[1].validated,false);
  H.setActiveProfile(second.id);
  assert.equal(H.getValidationSummary().pending,1);
  // Old-format exports without verification fields stay compatible.
  const legacy=H.createFullBackup();
  for(const profile of legacy.profiles) {
    for(const s of profile.shifts) { delete s.validated; delete s.validatedAt; }
  }
  H.restoreFullBackup(legacy);
  H.setActiveProfile('default');
  assert.equal(H.getValidationSummary().validated,0);
});

test('validation remains independent of payment and does not leak into PDFs', () => {
  const {H}=launch();
  H.saveSettings({jobs:[{name:'LCC',hourlyWage:60,roundingMode:'daily'}]});
  H.saveShifts([sample('x',{clockOut:'17:08'})]);
  H.setShiftValidation('x',true);
  const before=H.getShifts()[0];
  const pay=H.savePayment({job:'LCC',paymentDate:'2026-11-12',periodStart:'2026-11-11',periodEnd:'2026-11-11',shiftIds:['x'],paycheckGross:248,netReceived:248});
  assert.equal(pay.expectedGross,248);
  assert.equal(H.getReportedMinutes(H.getShifts()),255);
  assert.equal(H.getShifts()[0].validatedAt,before.validatedAt);
  const context={window:{},TextEncoder,Intl};vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/pdf-export.js'),'utf8'),context);
  const pdf=new TextDecoder().decode(context.window.HourglassPdf.buildTimeEntriesPdf(H.getShifts(),'2026-11-11','2026-11-11',H,'LCC'));
  assert.doesNotMatch(pdf,/Validated|Needs review|Checked /i);
});

test('public pages wire validation controls and dashboard link with cache-busted scripts',()=>{
  const entries=fs.readFileSync(path.join(__dirname,'../docs/entry.html'),'utf8');
  const dashboard=fs.readFileSync(path.join(__dirname,'../docs/index.html'),'utf8');
  const entryJs=fs.readFileSync(path.join(__dirname,'../docs/entries.js'),'utf8');
  assert.match(entries,/id="validation-filter"/);
  assert.match(entries,/id="validation-progress"/);
  assert.match(entries,/<th>Validation<\/th>/);
  assert.match(entries,/entries\.js\?v=38/);
  assert.match(dashboard,/entry\.html\?validation=pending#history/);
  assert.match(dashboard,/dashboard\.js\?v=38/);
  assert.match(entryJs,/H\.setShiftValidation\(shift\.id, checkbox\.checked\)/);
});
