(function () {
  'use strict';

  const H = window.Hourglass;
  const form = document.getElementById('shift-form');
  const breakList = document.getElementById('break-list');
  const template = document.getElementById('break-template');
  const message = document.getElementById('form-message');
  const monthFilter = document.getElementById('month-filter');
  const validationFilter = document.getElementById('validation-filter');
  const breakMinutesInput = document.getElementById('break-minutes');
  const importFile = document.getElementById('import-file');
  const importMessage = document.getElementById('import-message');
  const deleteDialog = document.getElementById('delete-dialog');
  const pdfDialog = document.getElementById('pdf-dialog');
  const pdfStartDate = document.getElementById('pdf-start-date');
  const pdfEndDate = document.getElementById('pdf-end-date');
  const pdfJobFilter = document.getElementById('pdf-job-filter');
  const pdfMessage = document.getElementById('pdf-message');
  const settings = H.getSettings();
  const jobInput = document.getElementById('job');

  function populateJobOptions(selected) {
    jobInput.innerHTML = '';
    jobInput.appendChild(new Option('Unassigned', ''));
    settings.jobs.forEach(function (job) { jobInput.appendChild(new Option(job.name, job.name)); });
    if (selected && !settings.jobs.some(function (job) { return job.name === selected; })) {
      jobInput.appendChild(new Option(selected + ' (not in Settings)', selected));
    }
    jobInput.value = selected || '';
  }

  populateJobOptions(settings.defaultJob);

  document.getElementById('work-date').value = H.dateKey(new Date());
  monthFilter.value = H.dateKey(new Date()).slice(0, 7);
  // Show all months when using the dashboard's unverified-shift link.
  if (new URLSearchParams(window.location.search).get('validation') === 'pending') {
    monthFilter.value = '';
    validationFilter.value = 'pending';
  }

  function addBreak(values) {
    const fragment = template.content.cloneNode(true);
    const row = fragment.querySelector('.break-row');
    row.querySelector('.break-start').value = values && values.start || '';
    row.querySelector('.break-end').value = values && values.end || '';
    row.querySelector('.remove-break').addEventListener('click', function () {
      row.remove();
      updateCalculation();
    });
    row.querySelectorAll('input').forEach(function (input) { input.addEventListener('input', updateCalculation); });
    breakList.appendChild(fragment);
  }

  function readBreaks() {
    return Array.from(breakList.querySelectorAll('.break-row')).map(function (row) {
      return { start: row.querySelector('.break-start').value, end: row.querySelector('.break-end').value };
    }).filter(function (item) { return item.start || item.end; });
  }

  function readForm() {
    return {
      id: document.getElementById('shift-id').value || (Date.now().toString(36) + Math.random().toString(36).slice(2, 7)),
      job: jobInput.value,
      date: document.getElementById('work-date').value,
      clockIn: document.getElementById('clock-in').value,
      clockOut: document.getElementById('clock-out').value,
      breaks: readBreaks(),
      breakMinutesOverride: Number(breakMinutesInput.value) || 0,
      notes: document.getElementById('notes').value.trim()
    };
  }

  function updateCalculation() {
    document.getElementById('calculated-total').textContent = H.formatMinutes(H.shiftMinutes(readForm()));
  }

  function validate(shift) {
    if (!shift.date || !shift.clockIn || !shift.clockOut) return 'Enter the date, clock-in time, and clock-out time.';
    if (H.getNoWorkRecord(shift.date)) return 'Remove the no-work record for this date before adding a shift.';
    if (!H.elapsedMinutes(shift.clockIn, shift.clockOut)) return 'Clock-in and clock-out cannot be the same.';
    const incomplete = shift.breaks.some(function (item) { return !item.start || !item.end; });
    if (incomplete) return 'Complete both times for every break.';
    if (shift.breaks.length && shift.breakMinutesOverride) return 'Use either timed breaks or total break minutes, not both.';
    if (H.breakMinutes(shift) >= H.elapsedMinutes(shift.clockIn, shift.clockOut)) return 'Break time must be shorter than the shift.';
    const overlap = H.getShifts().some(function (item) {
      return item.id !== shift.id && (item.job || '') === (shift.job || '') && item.date === shift.date && item.clockIn === shift.clockIn && item.clockOut === shift.clockOut;
    });
    if (overlap) return 'An identical shift already exists for this date.';
    return '';
  }

  function resetForm() {
    form.reset();
    document.getElementById('shift-id').value = '';
    document.getElementById('work-date').value = H.dateKey(new Date());
    populateJobOptions(settings.defaultJob);
    breakList.innerHTML = '';
    breakMinutesInput.value = '';
    document.getElementById('form-title').textContent = 'Add a shift.';
    document.getElementById('save-button').textContent = 'Save shift';
    document.getElementById('cancel-edit').classList.add('hidden');
    message.textContent = '';
    updateCalculation();
  }

  function createNoWorkDetailRow(record) {
    const row = document.createElement('tr');
    row.className = 'shift-detail-row hidden';
    const cell = document.createElement('td');
    cell.colSpan = 7;
    const detail = document.createElement('div');
    detail.className = 'shift-detail no-work-detail';
    const timeline = document.createElement('div');
    timeline.className = 'shift-timeline';
    let recordedAt = 'Exact marking time was not recorded';
    if (record.createdAt) {
      const parsed = new Date(record.createdAt);
      if (!Number.isNaN(parsed.getTime())) recordedAt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(parsed);
    }
    timeline.appendChild(createTimelineItem('Marked as no work', H.formatDate(record.date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }), recordedAt));
    const summary = document.createElement('div');
    summary.className = 'shift-summary';
    [['Record type', 'No work'], ['Applies to', 'All jobs'], ['Net time', '0.00 hours']].forEach(function (item) {
      const block = document.createElement('div');
      const label = document.createElement('span'); label.textContent = item[0];
      const value = document.createElement('strong'); value.textContent = item[1];
      block.append(label, value); summary.appendChild(block);
    });
    detail.append(timeline, summary);
    cell.appendChild(detail);
    row.appendChild(cell);
    return row;
  }

  function appendNoWorkRow(record, tbody) {
    const row = document.createElement('tr');
    row.className = 'no-work-row';
    const date = document.createElement('td');
    const dateValue = document.createElement('strong');
    dateValue.textContent = H.formatDate(record.date, { month: 'short', day: 'numeric' });
    const weekday = document.createElement('span');
    weekday.textContent = H.formatDate(record.date, { weekday: 'long' });
    date.append(dateValue, weekday);
    const job = document.createElement('td');
    const jobName = document.createElement('strong'); jobName.textContent = 'All jobs';
    job.appendChild(jobName);
    const time = document.createElement('td'); time.textContent = '—';
    const breaks = document.createElement('td'); breaks.textContent = '—';
    const net = document.createElement('td');
    const netValue = document.createElement('strong'); netValue.textContent = '0.00';
    const netLabel = document.createElement('span'); netLabel.textContent = 'decimal hours';
    net.append(netValue, netLabel);
    const actions = document.createElement('td');
    actions.className = 'row-actions';
    const details = document.createElement('button');
    details.type = 'button'; details.className = 'text-button'; details.textContent = 'Details'; details.setAttribute('aria-expanded', 'false');
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'text-button danger'; remove.textContent = 'Delete';
    remove.addEventListener('click', function () { deleteNoWorkDay(record.id); });
    actions.append(details, remove);
    const validationCell = document.createElement('td');
    validationCell.textContent = '—'; // No-work records do not require validation.
    row.append(date, job, time, breaks, net, validationCell, actions);
    tbody.appendChild(row);
    const detailRow = createNoWorkDetailRow(record);
    tbody.appendChild(detailRow);
    details.addEventListener('click', function () {
      const expanded = details.getAttribute('aria-expanded') === 'true';
      details.setAttribute('aria-expanded', String(!expanded));
      details.textContent = expanded ? 'Details' : 'Hide details';
      detailRow.classList.toggle('hidden', expanded);
    });
  }

  function renderHistory() {
    const allShifts = H.getShifts();
    const monthShifts = allShifts.filter(function (shift) {
      return !monthFilter.value || shift.date.startsWith(monthFilter.value);
    });
    const validation = H.getValidationSummary(monthShifts);
    document.getElementById('validation-progress').textContent =
      validation.validated + ' of ' + validation.total + ' shifts validated · ' +
      validation.pending + (validation.pending === 1 ? ' needs review' : ' need review');
    const report = H.getReportingSummary(monthShifts, settings);
    const daily = report.dailyTotals;
    const dailyByKey = new Map(daily.map(function (day) { return [JSON.stringify([day.date, day.job]), day]; }));
    const shownDailyTotals = new Set();
    const exact = report.actualMinutes;
    const reported = report.reportedMinutes;
    const adjustment = report.adjustmentMinutes;
    document.getElementById('history-range-label').textContent = monthFilter.value ? 'Month’s reported hours' : 'All recorded hours';
    document.getElementById('history-reported-hours').textContent = H.formatMinutes(reported);
    document.getElementById('history-exact-hours').textContent = H.formatMinutes(exact);
    document.getElementById('history-adjustment').textContent = (adjustment > 0 ? '+' : adjustment < 0 ? '−' : '') + Math.abs(adjustment) + 'm';
    const dailyList = document.getElementById('history-daily-totals');
    dailyList.textContent = '';
    daily.forEach(function (day) {
      const row = document.createElement('div');
      row.className = 'daily-job-item';
      const heading = document.createElement('span');
      heading.textContent = H.formatDate(day.date, { month: 'short', day: 'numeric' }) + ' · ' + (day.job || 'Unassigned');
      const total = document.createElement('strong');
      total.textContent = H.formatMinutes(day.displayMinutes) + (day.roundingMode === 'daily' ? ' rounded daily' : ' exact daily');
      const original = document.createElement('small');
      original.textContent = 'Recorded ' + H.formatMinutes(day.actualMinutes);
      row.append(heading, total, original);
      dailyList.appendChild(row);
    });
    if (!daily.length) dailyList.textContent = 'No shifts recorded in this range.';
    const periodList = document.getElementById('history-job-totals');
    periodList.textContent = '';
    report.jobs.forEach(function (job) {
      const row = document.createElement('div');
      row.className = 'daily-job-item';
      const name = document.createElement('span');
      name.textContent = job.job || 'Unassigned';
      const value = document.createElement('strong');
      value.textContent = H.formatMinutes(job.reportedMinutes) + ' reported';
      const detail = document.createElement('small');
      detail.textContent = (job.roundingMode === 'period' ? 'Period' : job.roundingMode === 'daily' ? 'Daily' : 'Off') +
        ' · Exact ' + H.formatMinutes(job.actualMinutes) +
        ' · Adjustment ' + (job.adjustmentMinutes > 0 ? '+' : job.adjustmentMinutes < 0 ? '−' : '') + Math.abs(job.adjustmentMinutes) + 'm';
      row.append(name, value, detail);
      periodList.appendChild(row);
    });
    if (!report.jobs.length) periodList.textContent = 'No shifts recorded in this range.';
    const tbody = document.getElementById('history-body');
    const empty = document.getElementById('history-empty');
    const filtered = allShifts.map(function (shift) { return { type: 'shift', record: shift }; })
      .concat(validationFilter.value === 'all' ? H.getNoWorkRecords().map(function (record) { return { type: 'no-work', record: record }; }) : [])
      .filter(function (item) { return !monthFilter.value || item.record.date.startsWith(monthFilter.value); })
      .filter(function (item) {
        if (item.type !== 'shift' || validationFilter.value === 'all') return true;
        return validationFilter.value === 'verified' ? item.record.validated : !item.record.validated;
      })
      .sort(function (a, b) {
        const dateOrder = b.record.date.localeCompare(a.record.date);
        if (dateOrder) return dateOrder;
        if (a.type === 'shift' && b.type === 'shift') return H.compareShiftsNewestFirst(a.record, b.record);
        return a.type === 'shift' ? -1 : 1;
      });
    tbody.innerHTML = '';
    empty.classList.toggle('hidden', filtered.length > 0);
    document.getElementById('history-empty-title').textContent = validationFilter.value === 'pending'
      ? 'No shifts need review' : validationFilter.value === 'verified' ? 'No validated shifts found' : 'No records found';
    document.getElementById('history-empty-description').textContent = validationFilter.value === 'all'
      ? 'Add a shift, mark a no-work day, or choose another month.'
      : 'Choose another month or change the validation filter.';
    filtered.forEach(function (item) {
      if (item.type === 'no-work') {
        appendNoWorkRow(item.record, tbody);
        return;
      }
      const shift = item.record;
      const row = document.createElement('tr');
      const date = document.createElement('td');
      const dateValue = document.createElement('strong');
      dateValue.textContent = H.formatDate(shift.date, { month: 'short', day: 'numeric' });
      const weekday = document.createElement('span');
      weekday.textContent = H.formatDate(shift.date, { weekday: 'long' });
      date.append(dateValue, weekday);
      const job = document.createElement('td');
      const jobName = document.createElement('strong');
      jobName.textContent = H.getJobName(shift);
      job.appendChild(jobName);
      const time = document.createElement('td');
      time.textContent = H.formatTime12(shift.clockIn) + '–' + H.formatTime12(shift.clockOut);
      const breaks = document.createElement('td');
      const recordedBreakMinutes = H.breakMinutes(shift);
      breaks.textContent = recordedBreakMinutes > 0 ? H.formatMinutes(recordedBreakMinutes) : 'None';
      const net = document.createElement('td');
      const netValue = document.createElement('strong');
      const dayKey = JSON.stringify([shift.date, String(shift.job || '').trim()]);
      const day = dailyByKey.get(dayKey);
      const oneShiftDay = day && day.shiftCount === 1;
      const exactMinutes = H.shiftMinutes(shift);
      netValue.textContent = H.formatDecimalHours(oneShiftDay ? day.displayMinutes : exactMinutes);
      const netLabel = document.createElement('span');
      netLabel.textContent = oneShiftDay && day.roundingEnabled ? 'rounded daily hours' :
        oneShiftDay ? 'exact daily hours' : 'exact shift hours';
      net.append(netValue, netLabel);
      if (oneShiftDay && day.roundingEnabled) {
        const original = document.createElement('small');
        original.className = 'net-exact-note';
        original.textContent = 'Exact ' + H.formatDecimalHours(exactMinutes) + ' hours';
        net.appendChild(original);
      } else if (day && day.shiftCount > 1 && !shownDailyTotals.has(dayKey)) {
        // Show the rounded day total once; do not distribute it across shifts.
        const dayTotal = document.createElement('small');
        dayTotal.className = 'net-exact-note';
        dayTotal.textContent = 'Daily total ' + H.formatDecimalHours(day.displayMinutes) + ' hours' +
          (day.roundingEnabled ? ' (rounded)' : ' (exact)');
        net.appendChild(dayTotal);
        shownDailyTotals.add(dayKey);
      }
      const actions = document.createElement('td');
      actions.className = 'row-actions';
      const details = document.createElement('button');
      details.type = 'button'; details.className = 'text-button'; details.textContent = 'Details';
      details.setAttribute('aria-expanded', 'false');
      const edit = document.createElement('button');
      edit.type = 'button'; edit.className = 'text-button'; edit.textContent = 'Edit';
      edit.addEventListener('click', function () { editShift(shift.id); });
      const remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'text-button danger'; remove.textContent = 'Delete';
      remove.addEventListener('click', function () { deleteShift(shift.id); });
      actions.append(details, edit, remove);
      const validationCell = document.createElement('td');
      validationCell.className = 'validation-cell';
      const validationLabel = document.createElement('label');
      validationLabel.className = 'shift-validation-label';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = shift.validated;
      checkbox.setAttribute('aria-label', 'Validate shift for ' + H.formatDate(shift.date) +
        ', ' + H.getJobName(shift) + ', ' + H.formatTime12(shift.clockIn) + ' to ' + H.formatTime12(shift.clockOut));
      const labelText = document.createElement('span');
      labelText.textContent = shift.validated ? 'Validated' : 'Needs review';
      validationLabel.append(checkbox, labelText);
      validationCell.appendChild(validationLabel);
      if (shift.validatedAt) {
        const stamp = document.createElement('small');
        stamp.className = 'validation-timestamp';
        stamp.textContent = 'Checked ' + new Intl.DateTimeFormat(undefined, {
          year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
        }).format(new Date(shift.validatedAt));
        validationCell.appendChild(stamp);
      }
      checkbox.addEventListener('change', function () {
        try { H.setShiftValidation(shift.id, checkbox.checked); renderHistory(); }
        catch (_error) { checkbox.checked = shift.validated; message.textContent = 'Verification could not be saved. Check browser storage.'; }
      });
      row.append(date, job, time, breaks, net, validationCell, actions);
      tbody.appendChild(row);
      const detailRow = createDetailRow(shift);
      tbody.appendChild(detailRow);
      details.addEventListener('click', function () {
        const expanded = details.getAttribute('aria-expanded') === 'true';
        details.setAttribute('aria-expanded', String(!expanded));
        details.textContent = expanded ? 'Details' : 'Hide details';
        detailRow.classList.toggle('hidden', expanded);
      });
    });
  }

  function formatTimestamp(timestamp, date, time) {
    if (timestamp) {
      const parsed = new Date(timestamp);
      if (!Number.isNaN(parsed.getTime())) {
        return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(parsed);
      }
    }
    return H.formatDate(date, { month: 'short', day: 'numeric', year: 'numeric' }) + ' at ' + H.formatTime12(time);
  }

  function createTimelineItem(label, value, meta) {
    const item = document.createElement('div');
    item.className = 'timeline-item';
    const marker = document.createElement('i');
    const copy = document.createElement('div');
    const heading = document.createElement('strong');
    heading.textContent = label;
    const detail = document.createElement('span');
    detail.textContent = value;
    copy.append(heading, detail);
    if (meta) {
      const extra = document.createElement('small');
      extra.textContent = meta;
      copy.appendChild(extra);
    }
    item.append(marker, copy);
    return item;
  }

  function formatPhotoDate(metadata) {
    if (metadata.capturedAt) {
      const match = metadata.capturedAt.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
      if (match) return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6])));
      return metadata.capturedAt;
    }
    return metadata.lastModified ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(metadata.lastModified)) : 'Not embedded';
  }

  function appendPhotoMetadata(figure, metadata) {
    if (!metadata) return;
    const list = document.createElement('dl');
    list.className = 'history-photo-metadata';
    const items = [
      ['Captured', formatPhotoDate(metadata)],
      ['Device', [metadata.make, metadata.model].filter(Boolean).join(' ') || 'Not embedded'],
      ['Image', metadata.width && metadata.height ? metadata.width + ' × ' + metadata.height : 'Unknown dimensions']
    ];
    if (metadata.gps) items.push(['Location', metadata.gps.latitude.toFixed(5) + ', ' + metadata.gps.longitude.toFixed(5)]);
    items.forEach(function (item) {
      const row = document.createElement('div');
      const term = document.createElement('dt'); term.textContent = item[0];
      const value = document.createElement('dd'); value.textContent = item[1];
      row.append(term, value); list.appendChild(row);
    });
    figure.appendChild(list);
  }

  function createDetailRow(shift) {
    const row = document.createElement('tr');
    row.className = 'shift-detail-row hidden';
    const cell = document.createElement('td');
    cell.colSpan = 7;
    const detail = document.createElement('div');
    detail.className = 'shift-detail';

    if (shift.image) {
      const figure = document.createElement('figure');
      figure.className = 'shift-photo';
      const image = document.createElement('img');
      image.src = shift.image;
      image.alt = 'Image saved with the ' + H.formatDate(shift.date) + ' shift';
      image.loading = 'lazy';
      const caption = document.createElement('figcaption');
      caption.textContent = 'Shift image';
      figure.append(image, caption);
      appendPhotoMetadata(figure, shift.imageMetadata);
      detail.appendChild(figure);
    }

    const timeline = document.createElement('div');
    timeline.className = 'shift-timeline';
    timeline.appendChild(createTimelineItem('Clocked in', formatTimestamp(shift.clockInTimestamp, shift.date, shift.clockIn)));
    if (shift.breaks && shift.breaks.length) {
      shift.breaks.forEach(function (item, index) {
        const range = formatTimestamp(item.startedAt, shift.date, item.start) + ' – ' + formatTimestamp(item.endedAt, shift.date, item.end);
        timeline.appendChild(createTimelineItem('Break ' + (index + 1), range, H.formatMinutes(H.elapsedMinutes(item.start, item.end))));
      });
    } else if (H.breakMinutes(shift) > 0) {
      timeline.appendChild(createTimelineItem('Recorded break total', H.formatMinutes(H.breakMinutes(shift)), 'Exact break timestamps were not recorded'));
    }
    timeline.appendChild(createTimelineItem('Clocked out', formatTimestamp(shift.clockOutTimestamp, shift.date, shift.clockOut)));
    detail.appendChild(timeline);

    const summary = document.createElement('div');
    summary.className = 'shift-summary';
    const summaryItems = [
      ['Job', H.getJobName(shift)],
      ['Total breaks', H.formatMinutes(H.breakMinutes(shift))],
      ['Net time', H.formatDecimalHours(H.shiftMinutes(shift)) + ' hours']
    ];
    summaryItems.forEach(function (item) {
      const block = document.createElement('div');
      const label = document.createElement('span'); label.textContent = item[0];
      const value = document.createElement('strong'); value.textContent = item[1];
      block.append(label, value); summary.appendChild(block);
    });
    if (shift.notes) {
      const note = document.createElement('p');
      note.className = 'shift-note';
      note.textContent = shift.notes;
      summary.appendChild(note);
    }
    detail.appendChild(summary);
    cell.appendChild(detail);
    row.appendChild(cell);
    return row;
  }

  function editShift(id) {
    const shift = H.getShifts().find(function (item) { return item.id === id; });
    if (!shift) return;
    if (H.getPaymentForShift(id)) {
      message.textContent = 'This shift is linked to a payment. Edit or delete that payment before changing the shift.';
      return;
    }
    document.getElementById('shift-id').value = shift.id;
    populateJobOptions(shift.job || '');
    document.getElementById('work-date').value = shift.date;
    document.getElementById('clock-in').value = shift.clockIn;
    document.getElementById('clock-out').value = shift.clockOut;
    document.getElementById('notes').value = shift.notes || '';
    breakMinutesInput.value = shift.breakMinutesOverride || '';
    breakList.innerHTML = '';
    (shift.breaks || []).forEach(addBreak);
    document.getElementById('form-title').textContent = 'Edit shift.';
    document.getElementById('save-button').textContent = 'Update shift';
    document.getElementById('cancel-edit').classList.remove('hidden');
    updateCalculation();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function deleteShift(id) {
    if (H.getPaymentForShift(id)) {
      message.textContent = 'This shift is linked to a payment. Delete that payment before deleting the shift.';
      return;
    }
    if (!window.confirm('Delete this shift? This cannot be undone.')) return;
    H.saveShifts(H.getShifts().filter(function (item) { return item.id !== id; }));
    renderHistory();
  }

  function deleteNoWorkDay(id) {
    if (!window.confirm('Delete this no-work record?')) return;
    H.deleteNoWorkRecord(id);
    renderHistory();
  }

  function exportCsv() {
    const shifts = H.getShifts().slice().sort(function (a, b) { return a.date.localeCompare(b.date); });
    if (!shifts.length) {
      message.textContent = 'Add at least one shift before exporting.';
      return;
    }
    const escape = function (value) {
      let safe = String(value == null ? '' : value);
      if (/^[=+\-@\t\r]/.test(safe)) safe = "'" + safe;
      return '"' + safe.replace(/"/g, '""') + '"';
    };
    const rows = [['Job', 'Date', 'Clock In', 'Clock Out', 'Break Minutes', 'Net Minutes', 'Net Hours', 'Notes']];
    shifts.forEach(function (shift) {
      const minutes = H.shiftMinutes(shift);
      rows.push([shift.job || '', shift.date, shift.clockIn, shift.clockOut, H.breakMinutes(shift), minutes, (minutes / 60).toFixed(2), shift.notes || '']);
    });
    const csv = rows.map(function (row) { return row.map(escape).join(','); }).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'hourglass-shifts-' + H.dateKey(new Date()) + '.csv'; link.click();
    URL.revokeObjectURL(url);
  }

  function currentMonthRange() {
    const month = monthFilter.value || H.dateKey(new Date()).slice(0, 7);
    const parts = month.split('-').map(Number);
    return {
      start: month + '-01',
      end: H.dateKey(new Date(parts[0], parts[1], 0))
    };
  }

  function openPdfExport() {
    const range = currentMonthRange();
    pdfStartDate.value = range.start;
    pdfEndDate.value = range.end;
    pdfJobFilter.textContent = '';
    pdfJobFilter.appendChild(new Option('All jobs', 'all'));
    const jobNames = [];
    const seenJobs = new Set();
    settings.jobs.forEach(function (job) {
      if (!seenJobs.has(job.name)) {
        seenJobs.add(job.name);
        jobNames.push(job.name);
      }
    });
    let hasUnassigned = false;
    H.getShifts().forEach(function (shift) {
      const jobName = String(shift.job || '').trim();
      if (!jobName) hasUnassigned = true;
      else if (!seenJobs.has(jobName)) {
        seenJobs.add(jobName);
        jobNames.push(jobName);
      }
    });
    jobNames.forEach(function (jobName) {
      pdfJobFilter.appendChild(new Option(jobName, 'job:' + jobName));
    });
    if (hasUnassigned) pdfJobFilter.appendChild(new Option('Unassigned', 'unassigned'));
    pdfJobFilter.value = 'all';
    pdfMessage.textContent = '';
    pdfDialog.showModal();
  }

  function exportPdf(event) {
    event.preventDefault();
    const startDate = pdfStartDate.value;
    const endDate = pdfEndDate.value;
    const jobChoice = pdfJobFilter.value;
    const jobLabel = jobChoice === 'all' ? 'All jobs' : (jobChoice === 'unassigned' ? 'Unassigned' : jobChoice.slice(4));
    if (!startDate || !endDate) {
      pdfMessage.textContent = 'Choose both a starting and ending date.';
      return;
    }
    if (startDate > endDate) {
      pdfMessage.textContent = 'The starting date must be before or the same as the ending date.';
      return;
    }
    const selected = H.getShifts().filter(function (shift) {
      if (shift.date < startDate || shift.date > endDate) return false;
      if (jobChoice === 'all') return true;
      if (jobChoice === 'unassigned') return !String(shift.job || '').trim();
      return String(shift.job || '') === jobLabel;
    });
    if (!selected.length) {
      pdfMessage.textContent = 'No shifts were recorded for ' + jobLabel + ' within that date range.';
      return;
    }
    const bytes = window.HourglassPdf.buildTimeEntriesPdf(selected, startDate, endDate, H, jobLabel);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const link = document.createElement('a');
    link.href = url;
    const jobSlug = jobLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'unassigned';
    link.download = 'hourglass-' + jobSlug + '-' + startDate + '-to-' + endDate + '.pdf';
    link.click();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    pdfDialog.close();
    message.textContent = selected.length + (selected.length === 1 ? ' shift' : ' shifts') + ' exported to PDF for ' + jobLabel + '.';
  }

  function parseCsv(text) {
    if (text.length > 2 * 1024 * 1024) throw new Error('The CSV is larger than the 2 MB import limit.');
    const rows = [];
    let row = [], field = '', quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (quoted) {
        if (character === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
        else if (character === '"') quoted = false;
        else field += character;
      } else if (character === '"') quoted = true;
      else if (character === ',') { row.push(field.trim()); field = ''; }
      else if (character === '\n') {
        row.push(field.trim());
        if (row.some(Boolean)) rows.push(row);
        if (rows.length > 5001) throw new Error('The CSV contains more than 5,000 shifts. Import it in smaller files.');
        row = []; field = '';
      }
      else if (character !== '\r') field += character;
    }
    row.push(field.trim());
    if (row.some(Boolean)) rows.push(row);
    if (rows.length > 5001) throw new Error('The CSV contains more than 5,000 shifts. Import it in smaller files.');
    return rows;
  }

  function normalizeHeader(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function findColumn(headers, names) {
    const normalized = headers.map(normalizeHeader);
    return normalized.findIndex(function (header) { return names.includes(header); });
  }

  function normalizeDate(value) {
    const trimmed = String(value || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return H.dateKey(H.parseLocalDate(trimmed)) === trimmed ? trimmed : '';
    }
    const match = trimmed.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
    if (!match) return '';
    const normalized = match[3] + '-' + match[1].padStart(2, '0') + '-' + match[2].padStart(2, '0');
    return H.dateKey(H.parseLocalDate(normalized)) === normalized ? normalized : '';
  }

  function normalizeTime(value) {
    const trimmed = String(value || '').trim().toUpperCase();
    const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/);
    if (!match) return '';
    let hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (minutes > 59 || hours > (match[3] ? 12 : 23) || hours < (match[3] ? 1 : 0)) return '';
    if (match[3] === 'AM' && hours === 12) hours = 0;
    if (match[3] === 'PM' && hours !== 12) hours += 12;
    return String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0');
  }

  function importCsv(text) {
    const rows = parseCsv(text);
    if (rows.length < 2) throw new Error('The CSV does not contain any time-card rows.');
    const headers = rows[0];
    const columns = {
      job: findColumn(headers, ['job', 'employer', 'company', 'workplace']),
      date: findColumn(headers, ['date', 'workdate', 'shiftdate']),
      clockIn: findColumn(headers, ['clockin', 'intime', 'start', 'starttime']),
      clockOut: findColumn(headers, ['clockout', 'outtime', 'end', 'endtime']),
      breakMinutes: findColumn(headers, ['breakminutes', 'unpaidbreakminutes', 'breakduration', 'breakmins']),
      notes: findColumn(headers, ['notes', 'note', 'description'])
    };
    if (columns.date < 0 || columns.clockIn < 0 || columns.clockOut < 0) {
      throw new Error('CSV headers must include Date, Clock In, and Clock Out. Break Minutes and Notes are optional.');
    }
    const shifts = H.getShifts();
    let imported = 0, skipped = 0;
    rows.slice(1).forEach(function (row, index) {
      const date = normalizeDate(row[columns.date]);
      const clockIn = normalizeTime(row[columns.clockIn]);
      const clockOut = normalizeTime(row[columns.clockOut]);
      if (!date || !clockIn || !clockOut || !H.elapsedMinutes(clockIn, clockOut) || H.getNoWorkRecord(date)) { skipped += 1; return; }
      const importedJob = columns.job >= 0 ? String(row[columns.job] || '').trim().slice(0, 80) : settings.defaultJob;
      const duplicate = shifts.some(function (item) { return (item.job || '') === importedJob && item.date === date && item.clockIn === clockIn && item.clockOut === clockOut; });
      if (duplicate) { skipped += 1; return; }
      const breakValue = columns.breakMinutes >= 0 ? Math.max(0, Number(row[columns.breakMinutes]) || 0) : 0;
      shifts.push({
        id: 'import-' + Date.now().toString(36) + '-' + index,
        job: importedJob,
        date: date,
        clockIn: clockIn,
        clockOut: clockOut,
        breaks: [],
        breakMinutesOverride: breakValue,
        notes: columns.notes >= 0 ? String(row[columns.notes] || '').slice(0, 240) : ''
      });
      imported += 1;
    });
    if (!imported) throw new Error('No new valid shifts were found. Check the date/time format or remove duplicates.');
    H.saveShifts(shifts);
    renderHistory();
    message.textContent = imported + (imported === 1 ? ' shift imported.' : ' shifts imported.') + (skipped ? ' ' + skipped + ' row(s) skipped.' : '');
  }

  document.getElementById('add-break').addEventListener('click', function () { addBreak(); });
  document.getElementById('clock-in').addEventListener('input', updateCalculation);
  document.getElementById('clock-out').addEventListener('input', updateCalculation);
  breakMinutesInput.addEventListener('input', updateCalculation);
  document.getElementById('cancel-edit').addEventListener('click', resetForm);
  document.getElementById('export-csv').addEventListener('click', exportCsv);
  document.getElementById('export-pdf').addEventListener('click', openPdfExport);
  document.getElementById('cancel-pdf').addEventListener('click', function () { pdfDialog.close(); });
  document.getElementById('pdf-form').addEventListener('submit', exportPdf);
  document.getElementById('import-csv').addEventListener('click', function () { importFile.click(); });
  importFile.addEventListener('change', function () {
    const file = importFile.files && importFile.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      importMessage.textContent = 'Choose a CSV file that is 2 MB or smaller.';
      importFile.value = '';
      return;
    }
    const reader = new FileReader();
    reader.addEventListener('load', function () {
      try {
        importCsv(String(reader.result || ''));
        importMessage.textContent = message.textContent;
        message.textContent = '';
      } catch (error) { importMessage.textContent = error.message; }
      importFile.value = '';
    });
    reader.addEventListener('error', function () { importMessage.textContent = 'The selected CSV could not be read.'; });
    reader.readAsText(file);
  });
  document.getElementById('delete-all').addEventListener('click', function () {
    if (!H.getShifts().length && !H.getNoWorkRecords().length) { message.textContent = 'There is no recorded time to delete.'; return; }
    deleteDialog.showModal();
  });
  document.getElementById('confirm-delete').addEventListener('click', function () {
    H.saveShifts([]);
    H.clearPayments();
    H.clearNoWorkRecords();
    resetForm();
    renderHistory();
    message.textContent = 'All recorded time data was deleted.';
  });
  monthFilter.addEventListener('change', renderHistory);
  validationFilter.addEventListener('change', renderHistory);
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    const shift = readForm();
    const error = validate(shift);
    if (error) { message.textContent = error; return; }
    const shifts = H.getShifts();
    const index = shifts.findIndex(function (item) { return item.id === shift.id; });
    let reviewWasCleared = false;
    if (index >= 0) {
      const previous = shifts[index];
      shift.image = previous.image || '';
      shift.imageMetadata = previous.imageMetadata || null;
      shift.clockInTimestamp = previous.clockInTimestamp || '';
      shift.clockOutTimestamp = previous.clockOutTimestamp || '';
      shift.breaks = shift.breaks.map(function (item, breakIndex) {
        const oldBreak = (previous.breaks || [])[breakIndex];
        if (oldBreak && oldBreak.start === item.start && oldBreak.end === item.end) {
          return Object.assign({}, item, { startedAt: oldBreak.startedAt || '', endedAt: oldBreak.endedAt || '' });
        }
        return item;
      });
      reviewWasCleared = previous.validated && (
        previous.job !== shift.job || previous.date !== shift.date ||
        previous.clockIn !== shift.clockIn || previous.clockOut !== shift.clockOut ||
        previous.breakMinutesOverride !== shift.breakMinutesOverride ||
        JSON.stringify(previous.breaks.map(function (b) { return [b.start, b.end]; })) !==
        JSON.stringify(shift.breaks.map(function (b) { return [b.start, b.end]; }))
      );
      shifts[index] = shift;
    } else shifts.push(shift);
    H.saveShifts(shifts);
    resetForm();
    monthFilter.value = shift.date.slice(0, 7);
    renderHistory();
    message.textContent = reviewWasCleared ? 'Shift saved. Validation cleared because hours changed.' : 'Shift saved.';
  });

  renderHistory();
  updateCalculation();
})();
