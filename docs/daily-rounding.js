/* Hourglass rounding calculations. Pure functions: no storage or DOM access.
 * Daily mode rounds each job/date once; period mode rounds each job once over
 * exactly the shifts supplied for the report (after the report's filters).
 * Supports legacy true/false maps used by earlier Hourglass versions.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HourglassRounding = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const QUARTER_HOUR_MINUTES = 15;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const MODES = ['off', 'daily', 'period'];

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

  function modeForJob(modes, jobId) {
    const value = Object.prototype.hasOwnProperty.call(modes, jobId) ? modes[jobId] : 'off';
    if (value === true) return 'daily'; // Build 35/36 compatibility
    return MODES.includes(value) ? value : 'off';
  }

  function requireInputs(shifts, modes) {
    if (!Array.isArray(shifts)) throw new TypeError('shifts must be an array');
    if (!modes || typeof modes !== 'object' || Array.isArray(modes)) {
      throw new TypeError('rounding modes must be an object');
    }
  }

  /** Each shift: {date: local YYYY-MM-DD, jobId: string, netMinutes: integer}.
   * Returns one group per local date and job. Period-mode daily rows are exact.
   */
  function calculateDailyJobTotals(shifts, modesByJobId = {}) {
    requireInputs(shifts, modesByJobId);
    const groups = new Map();
    for (const shift of shifts) {
      if (!shift || !validDate(shift.date) || typeof shift.jobId !== 'string' || !shift.jobId ||
          !Number.isSafeInteger(shift.netMinutes) || shift.netMinutes < 0) {
        throw new TypeError('Each shift needs a valid date, jobId, and nonnegative integer netMinutes');
      }
      const key = JSON.stringify([shift.date, shift.jobId]);
      if (!groups.has(key)) groups.set(key, { date: shift.date, jobId: shift.jobId, actualMinutes: 0, shiftCount: 0 });
      const group = groups.get(key);
      const next = group.actualMinutes + shift.netMinutes;
      if (!Number.isSafeInteger(next)) throw new RangeError('Daily minutes exceeded safe integer range');
      group.actualMinutes = next;
      group.shiftCount += 1;
    }
    return [...groups.values()].map(function (group) {
      const roundingMode = modeForJob(modesByJobId, group.jobId);
      const roundingEnabled = roundingMode === 'daily';
      const displayMinutes = roundingEnabled ? roundToQuarterHour(group.actualMinutes) : group.actualMinutes;
      return { ...group, displayMinutes, adjustmentMinutes: displayMinutes - group.actualMinutes,
        roundingEnabled, roundingMode };
    }).sort((a, b) => a.date.localeCompare(b.date) || a.jobId.localeCompare(b.jobId));
  }

  /** The supplied shifts define ONE reporting period. Never round across jobs.
   * Daily-mode subtotals sum their daily rounded groups. Period-mode subtotals
   * round once from all exact minutes for that job within the selected range.
   */
  function calculateReportingSummary(shifts, modesByJobId = {}) {
    const dailyTotals = calculateDailyJobTotals(shifts, modesByJobId);
    const byJob = new Map();
    dailyTotals.forEach(function (day) {
      if (!byJob.has(day.jobId)) {
        byJob.set(day.jobId, { jobId: day.jobId, roundingMode: day.roundingMode,
          actualMinutes: 0, dailyDisplayMinutes: 0, shiftCount: 0 });
      }
      const entry = byJob.get(day.jobId);
      entry.actualMinutes += day.actualMinutes;
      entry.dailyDisplayMinutes += day.displayMinutes;
      entry.shiftCount += day.shiftCount;
      if (!Number.isSafeInteger(entry.actualMinutes) || !Number.isSafeInteger(entry.dailyDisplayMinutes)) {
        throw new RangeError('Reporting minutes exceeded safe integer range');
      }
    });
    const jobs = [...byJob.values()].map(function (entry) {
      const reportedMinutes = entry.roundingMode === 'period'
        ? roundToQuarterHour(entry.actualMinutes)
        : entry.dailyDisplayMinutes;
      return {
        jobId: entry.jobId, roundingMode: entry.roundingMode, shiftCount: entry.shiftCount,
        actualMinutes: entry.actualMinutes, reportedMinutes,
        adjustmentMinutes: reportedMinutes - entry.actualMinutes
      };
    }).sort((a, b) => a.jobId.localeCompare(b.jobId));
    const actualMinutes = jobs.reduce((sum, entry) => sum + entry.actualMinutes, 0);
    const reportedMinutes = jobs.reduce((sum, entry) => sum + entry.reportedMinutes, 0);
    if (!Number.isSafeInteger(actualMinutes) || !Number.isSafeInteger(reportedMinutes)) {
      throw new RangeError('Reporting minutes exceeded safe integer range');
    }
    return { dailyTotals, jobs, actualMinutes, reportedMinutes,
      adjustmentMinutes: reportedMinutes - actualMinutes };
  }

  return { QUARTER_HOUR_MINUTES, roundToQuarterHour, calculateDailyJobTotals, calculateReportingSummary };
});
