(function () {
  'use strict';

  function ascii(value) {
    return String(value == null ? '' : value)
      .replace(/[–—]/g, '-')
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .normalize('NFKD')
      .replace(/[^\x20-\x7E]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function pdfString(value) {
    return '(' + ascii(value).replace(/([\\()])/g, '\\$1') + ')';
  }

  function wrap(value, width) {
    const words = ascii(value).split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    words.forEach(function (word) {
      while (word.length > width) {
        if (line) { lines.push(line); line = ''; }
        lines.push(word.slice(0, width));
        word = word.slice(width);
      }
      if (!line) line = word;
      else if (line.length + word.length + 1 <= width) line += ' ' + word;
      else { lines.push(line); line = word; }
    });
    if (line) lines.push(line);
    return lines.length ? lines : [''];
  }

  function line(text, bold, size) {
    return { text: text, font: bold ? 'F2' : 'F1', size: size || 10 };
  }

  // One report group represents one local date + job. Rounding is computed only
  // once for the whole group, never independently for its component shifts.
  function groupBlock(day, shifts, H) {
    const heading = H.formatDate(day.date, { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' | ' + (day.job || 'Unassigned');
    const block = wrap(heading, 82).map(function (text) { return line(text, true, 11); });
    const singleShift = shifts.length === 1;

    shifts.forEach(function (shift) {
      const exactHours = H.formatDecimalHours(H.shiftMinutes(shift));
      const timeAndBreaks = H.formatTime12(shift.clockIn) + ' - ' + H.formatTime12(shift.clockOut) +
        ' | Breaks ' + H.formatMinutes(H.breakMinutes(shift));
      const detail = singleShift
        ? timeAndBreaks + ' | Net ' + H.formatDecimalHours(day.displayMinutes) + ' hours'
        : timeAndBreaks + ' | Exact net ' + exactHours + ' hours';
      wrap(detail, 94).forEach(function (text) { block.push(line(text)); });
      // The exact underlying duration stays visible and is never rewritten.
      if (singleShift && day.roundingEnabled) block.push(line('Exact ' + exactHours + ' hours', false, 9));
      if (shift.notes) wrap('Notes: ' + shift.notes, 94).forEach(function (text) { block.push(line(text)); });
      if (shift.image) block.push(line('Image attached to the browser record.', false, 9));
    });

    // With multiple shifts, the individual durations above must remain exact;
    // otherwise the same daily rounding adjustment could be counted twice.
    if (!singleShift) {
      const dailyLabel = 'Daily net ' + H.formatDecimalHours(day.displayMinutes) + ' hours' +
        (day.roundingEnabled ? ' | Rounded from ' + H.formatDecimalHours(day.actualMinutes) + ' hours' : ' | Exact');
      wrap(dailyLabel, 90).forEach(function (text) { block.push(line(text, true, 10)); });
    }
    block.push(line(''));
    return block;
  }

  function paginate(shifts, H) {
    const maximumLines = 43;
    const totalMinutes = shifts.reduce(function (sum, shift) { return sum + H.shiftMinutes(shift); }, 0);
    const totalBreaks = shifts.reduce(function (sum, shift) { return sum + H.breakMinutes(shift); }, 0);
    const report = H.getReportingSummary(shifts);
    const days = report.dailyTotals;
    const reportedMinutes = report.reportedMinutes;
    const adjustment = report.adjustmentMinutes;
    const pages = [[]];
    function pushSummary(item) {
      if (pages[pages.length - 1].length >= maximumLines) pages.push([]);
      pages[pages.length - 1].push(item);
    }
    pushSummary(line('Report summary', true, 11));
    pushSummary(line(shifts.length + (shifts.length === 1 ? ' shift' : ' shifts') + ' | Total ' + H.formatDecimalHours(reportedMinutes) + ' hours | Breaks ' + H.formatMinutes(totalBreaks)));
    pushSummary(line('Exact net ' + H.formatDecimalHours(totalMinutes) + ' hours | Rounding adjustment ' + (adjustment > 0 ? '+' : '') + adjustment + ' min'));
    const hasPeriod = report.jobs.some(function (job) { return job.roundingMode === 'period'; });
    const hasDaily = report.jobs.some(function (job) { return job.roundingMode === 'daily'; });
    const methodology = hasPeriod && hasDaily
      ? 'Mixed methods: daily per job/date; period once per job for this selected report range.'
      : hasPeriod ? 'Reporting period: round each period-mode job once across this selected date range.'
        : hasDaily ? 'Daily: round each daily-mode job once per date; original times remain exact.'
          : 'No rounding: original clock times and net durations remain exact.';
    wrap(methodology, 88).forEach(function (text) { pushSummary(line(text, false, 9)); });
    report.jobs.forEach(function (job) {
      const modeName = job.roundingMode === 'daily' ? 'Daily' : job.roundingMode === 'period' ? 'Period' : 'Off';
      const description = (job.job || 'Unassigned') + ' | ' + modeName + ' | Exact ' +
        H.formatDecimalHours(job.actualMinutes) + ' hours | Reported ' +
        H.formatDecimalHours(job.reportedMinutes) + ' hours | Adjustment ' +
        (job.adjustmentMinutes > 0 ? '+' : '') + job.adjustmentMinutes + ' min';
      wrap(description, 90).forEach(function (text) { pushSummary(line(text, false, 9)); });
    });
    pushSummary(line(''));
    const shiftsByDay = new Map();
    shifts.forEach(function (shift) {
      const key = JSON.stringify([shift.date, String(shift.job || '').trim()]);
      if (!shiftsByDay.has(key)) shiftsByDay.set(key, []);
      shiftsByDay.get(key).push(shift);
    });
    days.forEach(function (day) {
      const key = JSON.stringify([day.date, day.job]);
      const groupShifts = shiftsByDay.get(key) || [];
      const block = groupBlock(day, groupShifts, H);
      let nextLine = 0;
      while (nextLine < block.length) {
        let page = pages[pages.length - 1];
        const remaining = block.length - nextLine;
        if (page.length && page.length + remaining > maximumLines && remaining <= maximumLines) {
          // Prefer keeping each date/job together on a fresh page.
          page = []; pages.push(page);
        } else if (page.length >= maximumLines - 2) {
          page = []; pages.push(page);
        }
        if (nextLine && !page.length) {
          page.push(line(H.formatDate(day.date) + ' | ' + (day.job || 'Unassigned') + ' (continued)', true, 11));
        }
        const capacity = maximumLines - page.length;
        if (!capacity) { pages.push([]); continue; }
        const part = block.slice(nextLine, nextLine + capacity);
        page.push.apply(page, part);
        nextLine += part.length;
      }
    });
    return pages;
  }

  function pageContent(lines, rangeLabel, jobLabel, pageNumber, pageCount) {
    const commands = [
      '0.08 0.10 0.12 rg',
      'BT /F2 18 Tf 44 750 Td ' + pdfString('Hourglass Time Entries') + ' Tj ET',
      'BT /F1 10 Tf 44 730 Td ' + pdfString(rangeLabel) + ' Tj ET',
      'BT /F1 10 Tf 44 714 Td ' + pdfString('Job: ' + jobLabel) + ' Tj ET',
      '0.75 0.85 0.25 RG 1.5 w 44 700 m 568 700 l S'
    ];
    let y = 680;
    lines.forEach(function (item) {
      if (item.text) commands.push('BT /' + item.font + ' ' + item.size + ' Tf 44 ' + y + ' Td ' + pdfString(item.text) + ' Tj ET');
      y -= 14;
    });
    commands.push('0.4 0.4 0.4 rg');
    commands.push('BT /F1 8 Tf 44 30 Td ' + pdfString('Generated by Hourglass') + ' Tj ET');
    commands.push('BT /F1 8 Tf 520 30 Td ' + pdfString(pageNumber + ' / ' + pageCount) + ' Tj ET');
    return commands.join('\n') + '\n';
  }

  function buildTimeEntriesPdf(shifts, startDate, endDate, H, jobLabel) {
    const sorted = shifts.slice().sort(function (a, b) { return a.date.localeCompare(b.date) || a.clockIn.localeCompare(b.clockIn); });
    const rangeLabel = 'Date range: ' + H.formatDate(startDate) + ' - ' + H.formatDate(endDate);
    const reportJob = ascii(jobLabel || 'All jobs').slice(0, 88) || 'All jobs';
    const pages = paginate(sorted, H);
    const objects = [];
    const pageObjectNumbers = [];
    objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
    objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>';
    pages.forEach(function (pageLines, index) {
      const pageObject = 5 + index * 2;
      const contentObject = pageObject + 1;
      const content = pageContent(pageLines, rangeLabel, reportJob, index + 1, pages.length);
      pageObjectNumbers.push(pageObject);
      objects[pageObject] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ' + contentObject + ' 0 R >>';
      objects[contentObject] = '<< /Length ' + content.length + ' >>\nstream\n' + content + 'endstream';
    });
    objects[2] = '<< /Type /Pages /Count ' + pages.length + ' /Kids [' + pageObjectNumbers.map(function (number) { return number + ' 0 R'; }).join(' ') + '] >>';

    let output = '%PDF-1.4\n%Hourglass\n';
    const offsets = [0];
    for (let number = 1; number < objects.length; number += 1) {
      offsets[number] = output.length;
      output += number + ' 0 obj\n' + objects[number] + '\nendobj\n';
    }
    const xrefOffset = output.length;
    output += 'xref\n0 ' + objects.length + '\n0000000000 65535 f \n';
    for (let number = 1; number < objects.length; number += 1) {
      output += String(offsets[number]).padStart(10, '0') + ' 00000 n \n';
    }
    output += 'trailer\n<< /Size ' + objects.length + ' /Root 1 0 R >>\nstartxref\n' + xrefOffset + '\n%%EOF\n';
    return new TextEncoder().encode(output);
  }

  window.HourglassPdf = { buildTimeEntriesPdf: buildTimeEntriesPdf };
})();
