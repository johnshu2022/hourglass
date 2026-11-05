// Integration coverage for the public browser APIs and existing backup/payment schema.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function launch() {
  const data = new Map();
  const localStorage = {
    get length() { return data.size; },
    key(index) { return [...data.keys()][index] ?? null; },
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); }
  };
  const context = { localStorage, Intl, Date, Number, Math, Map, Set, JSON };
  context.window = context;
  vm.createContext(context);
  for (const file of ['daily-rounding.js', 'shared.js']) {
    const source = fs.readFileSync(path.join(__dirname, '../docs', file), 'utf8');
    vm.runInContext(source, context, { filename: file });
  }
  return { H: context.Hourglass, data, localStorage };
}

const shift = (id, job, date, clockIn, clockOut, breakMinutesOverride=0) =>
  ({ id, job, date, clockIn, clockOut, breakMinutesOverride });

test('legacy jobs default to exact minutes; true boolean enables rounding only on that job', () => {
  const { H } = launch();
  const settings = {
    hourlyWage: 0, currency: 'USD', weekStartsOn: 'sunday',
    jobs: [{ name: 'Cafe', hourlyWage: 20, weekStartsOn: 'sunday' },
      { name: 'Office', hourlyWage: 40, roundDailyToQuarterHour: 'true' }],
    defaultJob: 'Cafe'
  };
  H.saveSettings(settings);
  const read = H.getSettings();
  assert.equal(read.jobs[0].roundDailyToQuarterHour, false);
  assert.equal(read.jobs[1].roundDailyToQuarterHour, false, 'string true is not accepted');
  read.jobs[0].roundDailyToQuarterHour = true;
  H.saveSettings(read);
  assert.equal(H.getSettings().jobs[0].roundDailyToQuarterHour, true);
});

test('multiple shifts round only after grouping by date and job, after breaks', () => {
  const { H } = launch();
  H.saveSettings({ jobs: [
    { name: 'Cafe', hourlyWage: 20, roundDailyToQuarterHour: true },
    { name: 'Office', hourlyWage: 40, roundDailyToQuarterHour: false }
  ] });
  H.saveShifts([
    shift('a', 'Cafe', '2026-11-04', '09:00', '09:05'),
    shift('b', 'Cafe', '2026-11-04', '13:00', '13:05'),
    shift('c', 'Office', '2026-11-04', '08:00', '08:06'),
    shift('d', 'Cafe', '2026-11-05', '10:00', '10:15', 7),
    shift('e', '', '2026-11-04', '11:00', '11:04')
  ]);
  const shifts = H.getShifts();
  const totals = H.getDailyJobTotals(shifts);
  const cafeFirst = totals.find(day => day.job === 'Cafe' && day.date === '2026-11-04');
  assert.equal(cafeFirst.actualMinutes, 10);
  assert.equal(cafeFirst.displayMinutes, 15);
  assert.equal(cafeFirst.shiftCount, 2);
  assert.equal(totals.find(day => day.job === 'Cafe' && day.date === '2026-11-05').displayMinutes, 15);
  assert.equal(totals.find(day => day.job === 'Office').displayMinutes, 6);
  assert.equal(totals.find(day => day.job === '').displayMinutes, 4);
  assert.equal(H.getReportedMinutes(shifts), 40);
  assert.equal(shifts.reduce((sum, s) => sum + H.shiftMinutes(s), 0), 28);
  assert.equal(H.getReportedMinutes(shifts.filter(s => s.date === '2026-11-04')), 25);
});

test('full backup/restore preserves per-job rounding without changing any original shifts', () => {
  const { H } = launch();
  H.saveSettings({ jobs: [{ name: 'Cafe', hourlyWage: 25, roundDailyToQuarterHour: true }] });
  H.saveShifts([shift('one', 'Cafe', '2026-11-04', '12:00', '12:08')]);
  const before = H.createFullBackup();
  assert.equal(before.profiles[0].settings.jobs[0].roundDailyToQuarterHour, true);
  const validated = H.validateFullBackup(before);
  assert.equal(validated.profiles[0].settings.jobs[0].roundDailyToQuarterHour, true);
  H.saveSettings({ jobs: [] });
  H.saveShifts([]);
  H.restoreFullBackup(before);
  assert.equal(H.getSettings().jobs[0].roundDailyToQuarterHour, true);
  assert.equal(H.getShifts()[0].clockOut, '12:08');
  assert.equal(H.getReportedMinutes(H.getShifts()), 15);
});

test('payment expected gross uses exact minutes even when the report rounds a day up', () => {
  const { H } = launch();
  H.saveSettings({ jobs: [{ name: 'Cafe', hourlyWage: 60, roundDailyToQuarterHour: true }] });
  H.saveShifts([shift('one', 'Cafe', '2026-11-04', '12:00', '12:04'), shift('two', 'Cafe', '2026-11-04', '13:00', '13:04')]);
  assert.equal(H.getReportedMinutes(H.getShifts()), 15);
  const payment = H.savePayment({ job: 'Cafe', paymentDate: '2026-11-05', periodStart: '2026-11-04', periodEnd: '2026-11-04', shiftIds: ['one', 'two'], paycheckGross: 8, netReceived: 8 });
  assert.equal(payment.expectedGross, 8);
  assert.equal(H.getShiftsAwaitingPayment().length, 0);
});

test('all rounding can be disabled without changing stored shift durations', () => {
  const { H } = launch();
  H.saveSettings({ jobs: [{ name: 'Cafe', roundDailyToQuarterHour: true }] });
  H.saveShifts([shift('one', 'Cafe', '2026-11-04', '09:00', '09:08')]);
  assert.equal(H.getReportedMinutes(H.getShifts()), 15);
  H.saveSettings({ jobs: [{ name: 'Cafe', roundDailyToQuarterHour: false }] });
  assert.equal(H.getReportedMinutes(H.getShifts()), 8);
  assert.equal(H.shiftMinutes(H.getShifts()[0]), 8);
});

test('PDF report shows rounded daily net and smaller exact value for single-shift days', () => {
  const { H } = launch();
  H.saveSettings({ jobs: [{ name: 'Cafe', hourlyWage: 15, roundDailyToQuarterHour: true }] });
  H.saveShifts([shift('one', 'Cafe', '2026-11-04', '12:00', '12:08')]);
  const pdfContext = { window: {}, TextEncoder, Intl };
  vm.createContext(pdfContext);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/pdf-export.js'), 'utf8'), pdfContext);
  const bytes = pdfContext.window.HourglassPdf.buildTimeEntriesPdf(H.getShifts(), '2026-11-04', '2026-11-04', H, 'Cafe');
  const result = new TextDecoder().decode(bytes);
  assert.match(result, /Total 0\.25 hours/);
  assert.match(result, /Exact net 0\.13 hours/);
  assert.match(result, /\| Net 0\.25 hours/);
  assert.match(result, /Exact 0\.13 hours/);
  assert.match(result, /rounding adjustment \+7 min/i);
});

test('PDF reproduces the example four rounded LCC days and the reported sum', () => {
  const { H } = launch();
  H.saveSettings({ jobs: [{ name: 'LCC', roundDailyToQuarterHour: true }] });
  const shifts = [
    shift('oct31', 'LCC', '2026-10-31', '11:50', '16:06'), // 4h 16m -> 4.25
    shift('nov02', 'LCC', '2026-11-02', '11:41', '17:21'), // 5h 40m -> 5.75
    shift('nov03', 'LCC', '2026-11-03', '11:19', '16:47'), // 5h 28m -> 5.50
    shift('nov04', 'LCC', '2026-11-04', '12:13', '16:29')  // 4h 16m -> 4.25
  ];
  const daily = H.getDailyJobTotals(shifts);
  assert.deepEqual(Array.from(daily.map(d => d.displayMinutes)), [255, 345, 330, 255]);
  assert.equal(daily.reduce((n, d) => n + d.displayMinutes, 0), 1185);
  const pdfContext = { window: {}, TextEncoder, Intl };
  vm.createContext(pdfContext);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/pdf-export.js'), 'utf8'), pdfContext);
  const document = new TextDecoder().decode(pdfContext.window.HourglassPdf.buildTimeEntriesPdf(shifts, '2026-10-31', '2026-11-04', H, 'LCC'));
  assert.match(document, /4 shifts \| Total 19\.75 hours/);
  assert.match(document, /Exact net 19\.67 hours \| Rounding adjustment \+5 min/);
  for (const net of ['4.25', '5.75', '5.50']) {
    assert.match(document, new RegExp('Net ' + net.replace('.', '\\.') + ' hours'));
  }
  assert.equal((document.match(/Net 4\.25 hours/g) || []).length, 2);
  assert.equal((document.match(/Exact 4\.27 hours/g) || []).length, 2);
  assert.match(document, /Exact 5\.67 hours/);
  assert.match(document, /Exact 5\.47 hours/);
});

test('PDF shows one daily rounded total for multiple shifts and keeps each shift exact', () => {
  const { H } = launch();
  H.saveSettings({ jobs: [
    { name: 'LCC', roundDailyToQuarterHour: true },
    { name: 'Other', roundDailyToQuarterHour: false }
  ] });
  const shifts = [
    shift('a', 'LCC', '2026-11-04', '09:00', '09:05'),
    shift('b', 'LCC', '2026-11-04', '10:00', '10:05'),
    shift('c', 'Other', '2026-11-04', '11:00', '11:06')
  ];
  const pdfContext = { window: {}, TextEncoder, Intl };
  vm.createContext(pdfContext);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/pdf-export.js'), 'utf8'), pdfContext);
  const document = new TextDecoder().decode(pdfContext.window.HourglassPdf.buildTimeEntriesPdf(shifts, '2026-11-04', '2026-11-04', H, 'All jobs'));
  assert.match(document, /3 shifts \| Total 0\.35 hours/);
  assert.match(document, /Daily net 0\.25 hours \| Rounded from 0\.17 hours/);
  assert.equal((document.match(/Daily net 0\.25 hours/g) || []).length, 1);
  assert.equal((document.match(/Exact net 0\.08 hours/g) || []).length, 2);
  assert.match(document, /Net 0\.10 hours/);
  assert.doesNotMatch(document, /Net 0\.25 hours.*Net 0\.25 hours/);
});

test('PDF paginates many shifts from the same day without losing daily summary', () => {
  const { H } = launch();
  H.saveSettings({ jobs: [{ name: 'LCC', roundDailyToQuarterHour: true }] });
  const shifts = Array.from({ length: 60 }, (_, index) =>
    shift(String(index), 'LCC', '2026-11-04', '09:00', '09:05')
  );
  const pdfContext = { window: {}, TextEncoder, Intl };
  vm.createContext(pdfContext);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/pdf-export.js'), 'utf8'), pdfContext);
  const document = new TextDecoder().decode(pdfContext.window.HourglassPdf.buildTimeEntriesPdf(shifts, '2026-11-04', '2026-11-04', H, 'LCC'));
  assert.match(document, /Daily net 5\.00 hours \| Rounded from 5\.00 hours/);
  assert.equal((document.match(/Exact net 0\.08 hours/g) || []).length, 60);
  assert.ok(document.includes(String.raw`\(continued\)`));
  assert.match(document, /\/Count [2-9]/);
});
