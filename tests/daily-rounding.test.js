'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { roundToQuarterHour, calculateDailyJobTotals } = require('../docs/daily-rounding.js');

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
    displayMinutes:435, adjustmentMinutes:-1, roundingEnabled:true});
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
