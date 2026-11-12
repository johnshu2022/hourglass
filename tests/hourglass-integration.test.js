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

test('legacy boolean migrations preserve daily; new explicit mode supports per-job selection', () => {
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
  assert.equal(read.jobs[0].roundingMode, 'off');
  assert.equal(read.jobs[1].roundingMode, 'off');
  read.jobs[0].roundingMode = 'daily';
  H.saveSettings(read);
  assert.equal(H.getSettings().jobs[0].roundDailyToQuarterHour, true);
  assert.equal(H.getSettings().jobs[0].roundingMode, 'daily');
  H.saveSettings({ jobs: [{name:'Cafe', roundDailyToQuarterHour:true}] });
  assert.equal(H.getSettings().jobs[0].roundingMode, 'daily', 'old boolean true migrates to daily');
  H.saveSettings({ jobs: [{name:'Cafe', roundDailyToQuarterHour:true, roundingMode:'period'}] });
  assert.equal(H.getSettings().jobs[0].roundingMode, 'period', 'new setting wins over old boolean');
  assert.equal(H.getSettings().jobs[0].roundDailyToQuarterHour, false);
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


test('period mode reproduces November 5-11 screenshot without rounding each day', () => {
  const { H } = launch();
  H.saveSettings({jobs:[{name:'LCC',roundingMode:'period'}]});
  const shifts=[shift('5','LCC','2026-11-05','11:54','17:31'),
    shift('7','LCC','2026-11-07','13:00','16:51'),
    shift('8','LCC','2026-11-08','14:57','18:05'),
    shift('10','LCC','2026-11-10','14:15','17:00'),
    shift('11','LCC','2026-11-11','13:14','17:06')];
  H.saveShifts(shifts);
  const report=H.getReportingSummary(H.getShifts());
  assert.equal(report.actualMinutes,1153);
  assert.equal(report.reportedMinutes,1155);
  assert.equal(report.adjustmentMinutes,2);
  assert.deepEqual(Array.from(report.dailyTotals.map(d=>d.displayMinutes)),[337,231,188,165,232]);
  assert.equal(H.getReportedMinutes(H.getShifts()),1155);
  H.saveSettings({jobs:[{name:'LCC',roundingMode:'daily'}]});
  assert.equal(H.getReportedMinutes(H.getShifts()),1140);
  H.saveSettings({jobs:[{name:'LCC',roundingMode:'off'}]});
  assert.equal(H.getReportedMinutes(H.getShifts()),1153);
  assert.equal(H.getShifts()[0].clockIn, '11:54');
});

test('mixed jobs in selected range keep independent rounding and exact pay', () => {
  const { H } = launch();
  H.saveSettings({jobs:[{name:'Daily',roundingMode:'daily', hourlyWage:60},
    {name:'Period',roundingMode:'period', hourlyWage:60}]});
  const list=[shift('1','Daily','2026-11-01','09:00','09:08'),
    shift('2','Daily','2026-11-02','09:00','09:08'),
    shift('3','Period','2026-11-01','09:00','09:08'),
    shift('4','Period','2026-11-02','09:00','09:08'),
    shift('5','','2026-11-01','09:00','09:04')];
  H.saveShifts(list);
  const report=H.getReportingSummary(H.getShifts());
  assert.equal(report.reportedMinutes,49); // Daily 30 + Period 15 + Unassigned 4
  assert.equal(report.actualMinutes,36);
  assert.equal(H.getReportedMinutes(list.slice(0,3)),45); // Daily 30 + Period 15
  const payment=H.savePayment({job:'Period',paymentDate:'2026-11-03',periodStart:'2026-11-01',periodEnd:'2026-11-02',shiftIds:['3','4'],paycheckGross:16,netReceived:16});
  assert.equal(payment.expectedGross,16);
});

test('full backup preserves period mode and restores original clock times', () => {
  const { H } = launch();
  H.saveSettings({jobs:[{name:'LCC',roundingMode:'period'}]});
  H.saveShifts([shift('id','LCC','2026-11-11','13:14','17:06')]);
  const backup=H.createFullBackup();
  assert.equal(backup.profiles[0].settings.jobs[0].roundingMode,'period');
  assert.equal(H.validateFullBackup(backup).profiles[0].settings.jobs[0].roundingMode,'period');
  H.saveSettings({jobs:[]}); H.saveShifts([]);
  H.restoreFullBackup(backup);
  assert.equal(H.getSettings().jobs[0].roundingMode,'period');
  assert.equal(H.getShifts()[0].clockOut,'17:06');
});

test('PDF reporting period mode shows exact daily rows and one period adjustment', () => {
  const { H } = launch();
  H.saveSettings({jobs:[{name:'LCC',roundingMode:'period'}]});
  const list=[shift('5','LCC','2026-11-05','11:54','17:31'),
    shift('7','LCC','2026-11-07','13:00','16:51'),
    shift('8','LCC','2026-11-08','14:57','18:05'),
    shift('10','LCC','2026-11-10','14:15','17:00'),
    shift('11','LCC','2026-11-11','13:14','17:06')];
  const ctx={window:{},TextEncoder,Intl}; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/pdf-export.js'),'utf8'),ctx);
  const doc=new TextDecoder().decode(ctx.window.HourglassPdf.buildTimeEntriesPdf(list,'2026-11-05','2026-11-11',H,'LCC'));
  assert.match(doc,/5 shifts \| Total 19\.25 hours/);
  assert.match(doc,/Exact net 19\.22 hours \| Rounding adjustment \+2 min/);
  assert.match(doc,/Period \| Exact 19\.22 hours \| Reported 19\.25 hours \| Adjustment \+2 min/);
  assert.match(doc,/Net 5\.62 hours/);
  assert.match(doc,/Net 3\.85 hours/);
  assert.doesNotMatch(doc,/Net 5\.50 hours/);
});

test('PDF all-jobs summary labels both daily and period methods', () => {
  const { H } = launch();
  H.saveSettings({jobs:[{name:'A',roundingMode:'daily'},{name:'B',roundingMode:'period'}]});
  const list=[shift('a','A','2026-11-04','09:00','09:08'),
    shift('b','B','2026-11-04','09:00','09:08'),
    shift('c','B','2026-11-05','09:00','09:08')];
  const ctx={window:{},TextEncoder,Intl}; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/pdf-export.js'),'utf8'),ctx);
  const doc=new TextDecoder().decode(ctx.window.HourglassPdf.buildTimeEntriesPdf(list,'2026-11-04','2026-11-05',H,'All jobs'));
  assert.match(doc,/Mixed methods/);
  assert.match(doc,/A \| Daily/);
  assert.match(doc,/B \| Period/);
  assert.match(doc,/Total 0\.50 hours/);
});

test('PDF paginates many distinct jobs while preserving each job rounding summary', () => {
  const { H } = launch();
  const jobs = Array.from({length:60}, (_,i) => ({name:'Job'+String(i).padStart(2,'0'),roundingMode:i%2?'period':'daily'}));
  H.saveSettings({jobs});
  const shifts = jobs.map((job,i) => shift(String(i),job.name,'2026-11-04','09:00','09:08'));
  const ctx={window:{},TextEncoder,Intl}; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/pdf-export.js'),'utf8'),ctx);
  const doc=new TextDecoder().decode(ctx.window.HourglassPdf.buildTimeEntriesPdf(shifts,'2026-11-04','2026-11-04',H,'All jobs'));
  assert.match(doc,/Job00 \| Daily/);
  assert.match(doc,/Job59 \| Period/);
  assert.match(doc,/Nov 4, 2026 \| Job59/);
  assert.match(doc,/\/Count [2-9]/);
});


test('PDF does not disclose saved shift notes or photo attachment indicators', () => {
  const { H } = launch();
  H.saveSettings({ jobs: [{ name: 'LCC', roundingMode: 'period' }] });
  const first = Object.assign(
    shift('quick', 'LCC', '2026-11-11', '13:14', '17:06'),
    { notes: 'Recorded with Quick Clock', image: 'data:image/png;base64,AAA=' }
  );
  const second = Object.assign(
    shift('manual', 'LCC', '2026-11-11', '18:00', '18:15'),
    { notes: 'User-entered confidential memo' }
  );
  H.saveShifts([first, second]);
  const stored = H.getShifts();
  assert.equal(stored[0].notes, 'Recorded with Quick Clock');
  assert.ok(stored[0].image, 'saved photo remains in source record');
  assert.equal(stored[1].notes, 'User-entered confidential memo');
  const ctx = { window: {}, TextEncoder, Intl };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/pdf-export.js'), 'utf8'), ctx);
  const report = new TextDecoder().decode(ctx.window.HourglassPdf.buildTimeEntriesPdf(
    stored, '2026-11-11', '2026-11-11', H, 'LCC'
  ));
  assert.doesNotMatch(report, /Notes:/i);
  assert.doesNotMatch(report, /Recorded with Quick Clock/i);
  assert.doesNotMatch(report, /confidential memo/i);
  assert.doesNotMatch(report, /Image attached/i);
  assert.doesNotMatch(report, /data:image/i);
  assert.match(report, /Nov 11, 2026 \| LCC/);
  assert.match(report, /Daily net /);
  assert.match(report, /Breaks 0h 00m/);
});
