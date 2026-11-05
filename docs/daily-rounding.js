/* Hourglass: experimental daily, per-job quarter-hour rounding.
 * Pure calculation only. Does not read or write browser storage.
 * Works in a browser (window.HourglassRounding) and Node.js (require).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HourglassRounding = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const QUARTER_HOUR_MINUTES = 15;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  function validDate(date) {
    if (typeof date !== 'string' || !DATE_RE.test(date)) return false;
    const [year, month, day] = date.split('-').map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
  }

  function roundToQuarterHour(minutes) {
    if (!Number.isSafeInteger(minutes) || minutes < 0) {
      throw new TypeError('minutes must be a nonnegative safe integer');
    }
    const remainder = minutes % QUARTER_HOUR_MINUTES;
    return remainder < 8 ? minutes - remainder : minutes + (QUARTER_HOUR_MINUTES - remainder);
  }

  /**
   * @param {Array<{date: string, jobId: string, netMinutes: number}>} shifts
   *   Each item represents net working minutes (unpaid breaks already deducted).
   *   Dates must be local YYYY-MM-DD workday labels supplied by the caller.
   * @param {Record<string, boolean>} roundingByJobId
   *   Only jobs explicitly set to true are rounded. Other jobs remain exact.
   * @returns {Array<{date:string,jobId:string,actualMinutes:number,displayMinutes:number,adjustmentMinutes:number,roundingEnabled:boolean,shiftCount:number}>}
   */
  function calculateDailyJobTotals(shifts, roundingByJobId = {}) {
    if (!Array.isArray(shifts)) throw new TypeError('shifts must be an array');
    if (roundingByJobId === null || typeof roundingByJobId !== 'object' || Array.isArray(roundingByJobId)) {
      throw new TypeError('roundingByJobId must be an object');
    }
    const groups = new Map();
    for (const shift of shifts) {
      if (!shift || !validDate(shift.date) || typeof shift.jobId !== 'string' || !shift.jobId ||
          !Number.isSafeInteger(shift.netMinutes) || shift.netMinutes < 0) {
        throw new TypeError('Each shift needs a valid date, jobId, and nonnegative integer netMinutes');
      }
      const key = JSON.stringify([shift.date, shift.jobId]);
      if (!groups.has(key)) groups.set(key, {date: shift.date, jobId: shift.jobId, actualMinutes: 0, shiftCount: 0});
      const group = groups.get(key);
      const next = group.actualMinutes + shift.netMinutes;
      if (!Number.isSafeInteger(next)) throw new RangeError('Daily minutes exceeded safe integer range');
      group.actualMinutes = next;
      group.shiftCount += 1;
    }
    return [...groups.values()].map(group => {
      const roundingEnabled = Object.prototype.hasOwnProperty.call(roundingByJobId, group.jobId) && roundingByJobId[group.jobId] === true;
      const displayMinutes = roundingEnabled ? roundToQuarterHour(group.actualMinutes) : group.actualMinutes;
      return {
        ...group,
        displayMinutes,
        adjustmentMinutes: displayMinutes - group.actualMinutes,
        roundingEnabled
      };
    }).sort((a, b) => a.date.localeCompare(b.date) || a.jobId.localeCompare(b.jobId));
  }

  return { QUARTER_HOUR_MINUTES, roundToQuarterHour, calculateDailyJobTotals };
});
