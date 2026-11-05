(function () {
  'use strict';

  const H = window.Hourglass;
  const shifts = H.getShifts();
  const settings = H.getSettings();
  const now = new Date();
  const today = H.dateKey(now);
  const monthPrefix = today.slice(0, 7);

  function startOfWorkweek(date, weekStartsOn) {
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const startDay = Math.max(0, dayNames.indexOf(weekStartsOn));
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    start.setDate(start.getDate() - ((start.getDay() - startDay + 7) % 7));
    return start;
  }

  function timeValue(date) {
    return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
  }

  function findActiveBreak(breaks) {
    const items = Array.isArray(breaks) ? breaks : [];
    for (let index = items.length - 1; index >= 0; index -= 1) {
      if (!items[index].end) return items[index];
    }
    return null;
  }

  let activeShift = H.getActiveShift();
  if (activeShift && activeShift.date !== today) {
    H.clearActiveShift();
    activeShift = null;
  }

  const quickJob = document.getElementById('quick-job');
  quickJob.appendChild(new Option('Unassigned', ''));
  settings.jobs.forEach(function (job) { quickJob.appendChild(new Option(job.name, job.name)); });
  quickJob.value = activeShift && activeShift.job || settings.defaultJob || '';

  const photoInput = document.getElementById('clock-photo-input');
  const photoPreview = document.getElementById('clock-photo-preview');
  const photoPlaceholder = document.getElementById('clock-photo-placeholder');
  const photoMessage = document.getElementById('clock-photo-message');
  const removePhotoButton = document.getElementById('remove-clock-photo');
  const choosePhotoButton = document.getElementById('choose-clock-photo');
  const zoomPhotoButton = document.getElementById('zoom-clock-photo');
  const photoTrigger = document.getElementById('clock-photo-trigger');
  const photoMetadata = document.getElementById('clock-photo-metadata');
  const zoomDialog = document.getElementById('image-zoom-dialog');
  const zoomedPhoto = document.getElementById('zoomed-clock-photo');

  function formatFileSize(bytes) {
    if (!bytes) return 'Unknown size';
    if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function formatCapturedAt(metadata) {
    if (metadata.capturedAt) {
      const match = metadata.capturedAt.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
      if (match) {
        const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6]));
        return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
      }
      return metadata.capturedAt;
    }
    if (metadata.lastModified) return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(metadata.lastModified));
    return 'Not embedded';
  }

  function addMetadataItem(label, value) {
    const row = document.createElement('div');
    const term = document.createElement('dt');
    const description = document.createElement('dd');
    term.textContent = label;
    description.textContent = value;
    row.append(term, description);
    photoMetadata.appendChild(row);
  }

  function renderPhotoMetadata() {
    const metadata = H.getClockPhotoMetadata();
    photoMetadata.textContent = '';
    if (!metadata) {
      addMetadataItem('Status', 'No image selected');
      return;
    }
    addMetadataItem('File', metadata.fileName || 'Shift image');
    addMetadataItem('Captured', formatCapturedAt(metadata));
    addMetadataItem('Device', [metadata.make, metadata.model].filter(Boolean).join(' ') || 'Not embedded');
    addMetadataItem('Image', (metadata.width && metadata.height ? metadata.width + ' × ' + metadata.height + ' · ' : '') + formatFileSize(metadata.fileSize));
    if (metadata.gps) addMetadataItem('Location', metadata.gps.latitude.toFixed(5) + ', ' + metadata.gps.longitude.toFixed(5));
  }

  function renderClockPhoto() {
    const dataUrl = H.getClockPhoto();
    photoPreview.classList.toggle('hidden', !dataUrl);
    photoPlaceholder.classList.toggle('hidden', Boolean(dataUrl));
    removePhotoButton.classList.toggle('hidden', !dataUrl);
    zoomPhotoButton.classList.toggle('hidden', !dataUrl);
    const locked = Boolean(activeShift && dataUrl);
    choosePhotoButton.classList.toggle('hidden', locked);
    removePhotoButton.classList.toggle('hidden', !dataUrl || locked);
    photoTrigger.setAttribute('aria-label', dataUrl ? 'View the selected image at full size' : 'Choose a required image from this device');
    if (dataUrl) photoPreview.src = dataUrl;
    else photoPreview.removeAttribute('src');
    renderPhotoMetadata();
  }

  function chooseClockPhoto() {
    photoInput.click();
  }

  function openPhotoZoom() {
    const dataUrl = H.getClockPhoto();
    if (!dataUrl) return;
    zoomedPhoto.src = dataUrl;
    zoomDialog.showModal();
  }

  photoTrigger.addEventListener('click', function () {
    if (H.getClockPhoto()) openPhotoZoom();
    else chooseClockPhoto();
  });
  choosePhotoButton.addEventListener('click', chooseClockPhoto);
  zoomPhotoButton.addEventListener('click', openPhotoZoom);
  document.getElementById('close-image-zoom').addEventListener('click', function () { zoomDialog.close(); });
  zoomDialog.addEventListener('click', function (event) { if (event.target === zoomDialog) zoomDialog.close(); });
  removePhotoButton.addEventListener('click', function () {
    H.clearClockPhoto();
    photoMessage.textContent = 'Image removed.';
    renderClockPhoto();
  });
  photoInput.addEventListener('change', function () {
    const file = photoInput.files && photoInput.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      photoMessage.textContent = 'Choose an image file.';
      photoInput.value = '';
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      photoMessage.textContent = 'Choose an image smaller than 10 MB.';
      photoInput.value = '';
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.addEventListener('load', async function () {
      const maximum = 1200;
      const scale = Math.min(1, maximum / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      context.fillStyle = '#121a23';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      try {
        const metadata = await window.HourglassImageMetadata.extract(file, image);
        let quality = 0.82;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);
        while (dataUrl.length > 1450000 && quality > 0.46) {
          quality -= 0.09;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }
        H.saveClockPhoto(dataUrl);
        H.saveClockPhotoMetadata(metadata);
        photoMessage.textContent = 'Image and available metadata saved.';
        renderClockPhoto();
      } catch (_error) {
        H.clearClockPhoto();
        photoMessage.textContent = 'This browser does not have enough local storage for that image.';
      }
      URL.revokeObjectURL(objectUrl);
      photoInput.value = '';
    });
    image.addEventListener('error', function () {
      URL.revokeObjectURL(objectUrl);
      photoInput.value = '';
      photoMessage.textContent = 'That image could not be opened.';
    });
    image.src = objectUrl;
  });
  renderClockPhoto();

  function renderQuickClock() {
    const current = new Date();
    if (activeShift && activeShift.date !== H.dateKey(current)) {
      H.clearActiveShift();
      activeShift = null;
    }
    document.getElementById('live-clock').textContent = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(current);
    document.getElementById('live-date').textContent = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(current);
    const title = document.getElementById('quick-clock-title');
    const status = document.getElementById('clock-status');
    const elapsed = document.getElementById('elapsed-time');
    const action = document.getElementById('clock-action');
    const breakAction = document.getElementById('break-action');
    const noWorkAction = document.getElementById('no-work-action');
    const noWorkToday = Boolean(H.getNoWorkRecord(H.dateKey(current)));
    quickJob.disabled = Boolean(activeShift) || noWorkToday;
    noWorkAction.classList.toggle('hidden', Boolean(activeShift));
    noWorkAction.classList.toggle('undo', noWorkToday);
    noWorkAction.textContent = noWorkToday ? 'Undo no work' : 'No Work Today';
    action.disabled = noWorkToday;
    if (!activeShift) {
      title.textContent = noWorkToday ? 'No work today' : 'Not clocked in';
      status.textContent = noWorkToday ? 'Today is marked as a non-working day.' : 'Use Quick Clock to record today’s shift.';
      elapsed.classList.add('hidden');
      action.textContent = 'Clock in';
      action.classList.remove('clock-out');
      breakAction.classList.add('hidden');
      return;
    }
    const activeBreak = findActiveBreak(activeShift.breaks);
    title.textContent = activeBreak ? 'Currently on break' : 'Currently clocked in';
    status.textContent = activeBreak ? 'Break started at ' + H.formatTime12(activeBreak.start) : 'Clocked in at ' + H.formatTime12(activeShift.clockIn);
    const elapsedMilliseconds = Math.max(0, current.getTime() - new Date(activeShift.startedAt).getTime());
    const elapsedSeconds = Math.floor(elapsedMilliseconds / 1000);
    const hours = String(Math.floor(elapsedSeconds / 3600)).padStart(2, '0');
    const minutes = String(Math.floor(elapsedSeconds % 3600 / 60)).padStart(2, '0');
    const seconds = String(elapsedSeconds % 60).padStart(2, '0');
    elapsed.textContent = hours + ':' + minutes + ':' + seconds + ' elapsed';
    elapsed.classList.remove('hidden');
    action.textContent = 'Clock out';
    action.classList.add('clock-out');
    breakAction.textContent = activeBreak ? 'End break' : 'Start break';
    breakAction.classList.remove('hidden');
    breakAction.classList.toggle('break-running', Boolean(activeBreak));
  }

  document.getElementById('break-action').addEventListener('click', function () {
    if (!activeShift) return;
    const current = new Date();
    activeShift.breaks = activeShift.breaks || [];
    const activeBreak = findActiveBreak(activeShift.breaks);
    if (activeBreak) {
      activeBreak.end = timeValue(current);
      activeBreak.endedAt = current.toISOString();
    } else {
      activeShift.breaks.push({ start: timeValue(current), end: '', startedAt: current.toISOString() });
    }
    H.saveActiveShift(activeShift);
    renderQuickClock();
  });

  window.addEventListener('hourglass:no-work-changed', function () {
    renderClockPhoto();
    renderQuickClock();
    photoMessage.textContent = H.getNoWorkRecord(today) ? 'Today is marked as no work.' : 'The no-work status was removed.';
  });

  document.getElementById('clock-action').addEventListener('click', function () {
    const current = new Date();
    const currentDateKey = H.dateKey(current);
    if (H.getNoWorkRecord(currentDateKey)) return;
    const clockPhoto = H.getClockPhoto();
    if (!clockPhoto) {
      photoMessage.textContent = 'Add the required image before using Quick Clock.';
      document.getElementById('clock-status').textContent = 'A shift image is required to clock in or out.';
      photoTrigger.focus();
      return;
    }
    if (!activeShift) {
      activeShift = { date: currentDateKey, job: quickJob.value, clockIn: timeValue(current), startedAt: current.toISOString(), breaks: [] };
      H.saveActiveShift(activeShift);
      renderQuickClock();
      renderClockPhoto();
      return;
    }
    const activeBreak = findActiveBreak(activeShift.breaks);
    if (activeBreak) {
      activeBreak.end = timeValue(current);
      activeBreak.endedAt = current.toISOString();
    }
    const shifts = H.getShifts();
    const completedShift = {
      id: 'clock-' + Date.now().toString(36),
      date: activeShift.date,
      job: activeShift.job || '',
      clockIn: activeShift.clockIn,
      clockOut: timeValue(current),
      clockInTimestamp: activeShift.startedAt,
      clockOutTimestamp: current.toISOString(),
      breaks: activeShift.breaks || [],
      breakMinutesOverride: 0,
      notes: 'Recorded with Quick Clock',
      image: clockPhoto,
      imageMetadata: H.getClockPhotoMetadata()
    };
    shifts.push(completedShift);
    try {
      H.saveShifts(shifts);
    } catch (_error) {
      document.getElementById('clock-status').textContent = 'The shift could not be saved. Remove an older image or shift and try again.';
      return;
    }
    H.clearActiveShift();
    H.clearClockPhoto();
    window.location.reload();
  });

  renderQuickClock();
  window.setInterval(renderQuickClock, 1000);

  const dayShifts = shifts.filter(function (shift) { return shift.date === today; });
  const weekShifts = shifts.filter(function (shift) {
    const shiftDate = H.parseLocalDate(shift.date);
    const weekStart = startOfWorkweek(now, H.getShiftWeekStartsOn(shift, settings));
    return shiftDate >= weekStart && shiftDate <= now;
  });
  const monthShifts = shifts.filter(function (shift) { return shift.date.startsWith(monthPrefix); });
  const awaitingShifts = H.getShiftsAwaitingPayment();

  function total(list) {
    return H.getReportedMinutes(list, settings);
  }
  function exactTotal(list) {
    return list.reduce(function (sum, shift) { return sum + H.shiftMinutes(shift); }, 0);
  }

  document.getElementById('today-label').textContent = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(now);
  document.getElementById('day-total').textContent = H.formatMinutes(total(dayShifts));
  document.getElementById('week-total').textContent = H.formatMinutes(total(weekShifts));
  document.getElementById('month-total').textContent = H.formatMinutes(total(monthShifts));
  document.getElementById('awaiting-total').textContent = H.formatMinutes(exactTotal(awaitingShifts));
  document.getElementById('day-detail').textContent = dayShifts.length ? dayShifts.length + (dayShifts.length === 1 ? ' shift recorded' : ' shifts recorded') : (H.getNoWorkRecord(today) ? 'Marked as no work today' : 'No hours recorded');
  document.getElementById('week-detail').textContent = weekShifts.length + (weekShifts.length === 1 ? ' shift' : ' shifts');
  document.getElementById('month-detail').textContent = monthShifts.length + (monthShifts.length === 1 ? ' shift' : ' shifts');
  document.getElementById('awaiting-detail').textContent = awaitingShifts.length ? awaitingShifts.length + (awaitingShifts.length === 1 ? ' shift not linked to a payment' : ' shifts not linked to a payment') : 'Every shift is linked to a payment';
  const awaitingPay = awaitingShifts.reduce(function (sum, shift) {
    return sum + H.shiftMinutes(shift) / 60 * H.getShiftHourlyWage(shift, settings);
  }, 0);
  const hasConfiguredWage = settings.hourlyWage > 0 || settings.jobs.some(function (job) { return job.hourlyWage > 0; });
  document.getElementById('awaiting-pay').textContent = hasConfiguredWage ? H.formatCurrency(awaitingPay, settings.currency) + ' estimated gross pay' : 'Set your wages in Settings';

  const weekJobFilter = document.getElementById('week-job-filter');
  weekJobFilter.appendChild(new Option('All jobs', 'all'));
  const chartJobNames = [];
  const seenChartJobs = new Set();
  settings.jobs.forEach(function (job) {
    if (!seenChartJobs.has(job.name)) {
      seenChartJobs.add(job.name);
      chartJobNames.push(job.name);
    }
  });
  let hasUnassignedChartShifts = false;
  shifts.forEach(function (shift) {
    const name = String(shift.job || '').trim();
    if (!name) hasUnassignedChartShifts = true;
    else if (!seenChartJobs.has(name)) {
      seenChartJobs.add(name);
      chartJobNames.push(name);
    }
  });
  chartJobNames.forEach(function (name) { weekJobFilter.appendChild(new Option(name, 'job:' + name)); });
  if (hasUnassignedChartShifts) weekJobFilter.appendChild(new Option('Unassigned', 'unassigned'));

  const chart = document.getElementById('week-chart');
  function renderWeekChart() {
    const choice = weekJobFilter.value;
    const selectedOption = weekJobFilter.options[weekJobFilter.selectedIndex];
    const selectedLabel = selectedOption ? selectedOption.text : 'All jobs';
    const chartShifts = shifts.filter(function (shift) {
      if (choice === 'all') return true;
      if (choice === 'unassigned') return !String(shift.job || '').trim();
      return String(shift.job || '') === choice.slice(4);
    });
    const days = [];
    for (let offset = 6; offset >= 0; offset -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
      const key = H.dateKey(date);
      const minutes = total(chartShifts.filter(function (shift) { return shift.date === key; }));
      days.push({ date: date, minutes: minutes });
    }
    const maximum = Math.max(480, ...days.map(function (item) { return item.minutes; }));
    chart.textContent = '';
    chart.setAttribute('aria-label', 'Hours worked in the last seven days for ' + selectedLabel);
    days.forEach(function (item) {
      const column = document.createElement('div');
      column.className = 'chart-column';
      const value = document.createElement('span');
      value.className = 'chart-value';
      value.textContent = item.minutes ? H.formatDecimalHours(item.minutes) + 'h' : '—';
      const track = document.createElement('div');
      track.className = 'chart-track';
      const bar = document.createElement('i');
      bar.style.height = (item.minutes ? Math.max(8, item.minutes / maximum * 100) : 0) + '%';
      track.appendChild(bar);
      const label = document.createElement('span');
      label.textContent = new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(item.date).slice(0, 2);
      column.append(value, track, label);
      chart.appendChild(column);
    });
  }
  weekJobFilter.addEventListener('change', renderWeekChart);
  renderWeekChart();

  const recent = document.getElementById('recent-shifts');
  const sorted = shifts.slice().sort(H.compareShiftsNewestFirst).slice(0, 4);
  if (!sorted.length) {
    recent.innerHTML = '<div class="empty-state"><strong>No shifts yet</strong><span>Your latest shifts will appear here.</span></div>';
  } else {
    sorted.forEach(function (shift) {
      const item = document.createElement('div');
      item.className = 'recent-item';
      const details = document.createElement('div');
      const date = document.createElement('strong');
      date.textContent = H.formatDate(shift.date, { weekday: 'short', month: 'short', day: 'numeric' });
      const time = document.createElement('span');
      time.textContent = H.getJobName(shift) + ' · ' + H.formatTime12(shift.clockIn) + '–' + H.formatTime12(shift.clockOut);
      details.append(date, time);
      const hours = document.createElement('strong');
      hours.textContent = H.formatMinutes(H.shiftMinutes(shift));
      item.append(details, hours);
      recent.appendChild(item);
    });
  }
})();
