'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { roundToQuarterHour, calculateDailyJobTotals, calculateReportingSummary } = require('../docs/daily-rounding.js');

const date = '2026-11-04';
const shift = (jobId, netMinutes, workday = date) => ({ date: workday, jobId, netMinutes });

test('nearest 15-minute thresholds: 7 down, 8 up', () => {
  assert.equal(roundToQuarterHour(7), 0);
  assert.equal(roundToQuarterHour(8), 15);
  assert.equal(roundToQuarterHour(22), 15);
  assert.equal(roundToQuarterHour(23), 30);
  assert.equal(roundToQuarterHour(480), 480);
});

test('two shifts combined BEFORE daily rounding', () => {
  const result = calculateDailyJobTotals([shift('construction', 188), shift('construction', 248)], {construction: true});
  assert.deepEqual(result[0], {date, jobId:'construction', actualMinutes:436, shiftCount:2,
    displayMinutes:435, adjustmentMinutes:-1, roundingEnabled:true, roundingMode:'daily'});
});

test('rounding is per-job, not across jobs', () => {
  const result = calculateDailyJobTotals([shift('construction',436), shift('maintenance',248)], {construction:true,maintenance:true});
  assert.equal(result.find(r=>r.jobId==='construction').displayMinutes,435);
  assert.equal(result.find(r=>r.jobId==='maintenance').displayMinutes,255);
});

test('disabled and unknown jobs retain actual minutes', () => {
  const result = calculateDailyJobTotals([shift('a',488),shift('b',488)], {a:false});
  assert.deepEqual(result.map(r=>r.displayMinutes),[488,488]);
});

test('different dates never get combined', () => {
  const result = calculateDailyJobTotals([shift('a',8,'2026-11-04'),shift('a',8,'2026-11-05')], {a:true});
  assert.deepEqual(result.map(r=>r.displayMinutes),[15,15]);
});

test('caller supplies net minutes after breaks; calculation never deducts twice', () => {
  const result = calculateDailyJobTotals([shift('a',480-30)], {a:true});
  assert.equal(result[0].actualMinutes,450);
  assert.equal(result[0].displayMinutes,450);
});

test('does not mutate original shift data or settings', () => {
  const shifts = Object.freeze([Object.freeze(shift('a',488))]);
  const settings = Object.freeze({a:true});
  calculateDailyJobTotals(shifts, settings);
  assert.deepEqual(shifts,[shift('a',488)]);
  assert.deepEqual(settings,{a:true});
});

test('rejects invalid data rather than inventing time', () => {
  assert.throws(()=>calculateDailyJobTotals([shift('a',-1)]),TypeError);
  assert.throws(()=>calculateDailyJobTotals([shift('a',2.5)]),TypeError);
  assert.throws(()=>calculateDailyJobTotals([shift('a',8,'2026-02-30')]),TypeError);
});

test('zero minutes remain zero', () => {
  assert.equal(calculateDailyJobTotals([shift('a',0)],{a:true})[0].displayMinutes,0);
});


test('period mode leaves daily rows exact while rounding the combined job once', () => {
  const list = [shift('LCC', 337, '2026-11-05'),shift('LCC', 231,'2026-11-07'),
    shift('LCC',188,'2026-11-08'),shift('LCC',165,'2026-11-10'),shift('LCC',232,'2026-11-11')];
  const summary = calculateReportingSummary(list, { LCC: 'period' });
  assert.equal(summary.actualMinutes, 1153);
  assert.equal(summary.reportedMinutes, 1155);
  assert.equal(summary.adjustmentMinutes, 2);
  assert.deepEqual(summary.dailyTotals.map(day => day.displayMinutes),[337,231,188,165,232]);
  assert.ok(summary.dailyTotals.every(day => day.roundingMode === 'period' && !day.roundingEnabled));
  assert.equal(summary.jobs[0].reportedMinutes,1155);
});

test('daily mode for same LCC dates sums independently rounded days (19.00)', () => {
  const list = [337,231,188,165,232].map((netMinutes,i) => shift('LCC',netMinutes,`2026-11-${String(i+5).padStart(2,'0')}`));
  const summary = calculateReportingSummary(list, { LCC: 'daily' });
  assert.equal(summary.reportedMinutes,1140);
  assert.equal(summary.adjustmentMinutes,-13);
});

test('mixed modes: per-job rounding is independent and unassigned stays exact', () => {
  const list=[shift('A',8,'2026-11-01'),shift('A',8,'2026-11-02'),
    shift('B',8,'2026-11-01'),shift('B',8,'2026-11-02'),
    shift('C',8,'2026-11-01'),shift('C',8,'2026-11-02'),
    shift('unassigned',4,'2026-11-01')];
  const result=calculateReportingSummary(list,{A:'daily',B:'period',C:'off'});
  assert.equal(result.jobs.find(j=>j.jobId==='A').reportedMinutes,30);
  assert.equal(result.jobs.find(j=>j.jobId==='B').reportedMinutes,15);
  assert.equal(result.jobs.find(j=>j.jobId==='C').reportedMinutes,16);
  assert.equal(result.jobs.find(j=>j.jobId==='unassigned').reportedMinutes,4);
  assert.equal(result.reportedMinutes,65);
});

test('period adjustments depend on selected range, not all stored dates', () => {
  const list=[shift('A',8,'2026-11-01'),shift('A',8,'2026-11-02')];
  assert.equal(calculateReportingSummary(list,{A:'period'}).reportedMinutes,15);
  assert.equal(calculateReportingSummary(list.slice(0,1),{A:'period'}).reportedMinutes,15);
  assert.equal(calculateReportingSummary([], {A:'period'}).reportedMinutes,0);
});

test('multiple shifts are combined within job period and no input data is mutated', () => {
  const list=Object.freeze([Object.freeze(shift('A',5)),Object.freeze(shift('A',5)),Object.freeze(shift('A',5,'2026-11-05'))]);
  const modes=Object.freeze({A:'period'});
  const result=calculateReportingSummary(list,modes);
  assert.equal(result.reportedMinutes,15);
  assert.deepEqual(result.dailyTotals.map(d=>d.actualMinutes),[10,5]);
});
