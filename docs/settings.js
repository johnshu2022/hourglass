(function () {
  'use strict';

  const H = window.Hourglass;
  const form = document.getElementById('settings-form');
  const wageInput = document.getElementById('hourly-wage');
  const currencyInput = document.getElementById('currency');
  const weekStartInput = document.getElementById('week-start');
  const defaultJobInput = document.getElementById('default-job');
  const jobList = document.getElementById('job-list');
  const jobTemplate = document.getElementById('job-template');
  const message = document.getElementById('settings-message');
  const settings = H.getSettings();

  wageInput.value = settings.hourlyWage || '';
  currencyInput.value = settings.currency;
  weekStartInput.value = settings.weekStartsOn;

  function jobRows() {
    return Array.from(jobList.querySelectorAll('.job-row'));
  }

  function readJobs() {
    return jobRows().map(function (row) {
      return {
        name: row.querySelector('.job-name').value.trim(),
        hourlyWage: Math.max(0, Number(row.querySelector('.job-wage').value) || 0),
        weekStartsOn: row.querySelector('.job-week-start').value,
        roundingMode: row.querySelector('.job-rounding-mode').value
      };
    }).filter(function (job) { return job.name; });
  }

  function updateDefaultOptions(preferred) {
    const current = preferred !== undefined ? preferred : defaultJobInput.value;
    defaultJobInput.innerHTML = '';
    defaultJobInput.appendChild(new Option('Unassigned', ''));
    readJobs().forEach(function (job) { defaultJobInput.appendChild(new Option(job.name, job.name)); });
    defaultJobInput.value = Array.from(defaultJobInput.options).some(function (option) { return option.value === current; }) ? current : '';
  }

  function addJob(job) {
    const fragment = jobTemplate.content.cloneNode(true);
    const row = fragment.querySelector('.job-row');
    const nameInput = row.querySelector('.job-name');
    const jobWageInput = row.querySelector('.job-wage');
    nameInput.value = job && job.name || '';
    jobWageInput.value = job && job.hourlyWage || '';
    row.querySelector('.job-week-start').value = job && job.weekStartsOn || weekStartInput.value;
    row.querySelector('.job-rounding-mode').value = job && job.roundingMode || (job && job.roundDailyToQuarterHour ? 'daily' : 'off');
    nameInput.addEventListener('input', function () { updateDefaultOptions(); updatePreview(); });
    jobWageInput.addEventListener('input', updatePreview);
    row.querySelector('.remove-job').addEventListener('click', function () {
      row.remove();
      updateDefaultOptions();
      updatePreview();
    });
    jobList.appendChild(fragment);
  }

  function draftSettings() {
    return {
      hourlyWage: Math.max(0, Number(wageInput.value) || 0),
      currency: currencyInput.value,
      weekStartsOn: weekStartInput.value,
      jobs: readJobs(),
      defaultJob: defaultJobInput.value
    };
  }

  function updatePreview() {
    const draft = draftSettings();
    const awaiting = H.getShiftsAwaitingPayment();
    const minutes = awaiting.reduce(function (sum, shift) { return sum + H.shiftMinutes(shift); }, 0);
    const pay = awaiting.reduce(function (sum, shift) {
      return sum + H.shiftMinutes(shift) / 60 * H.getShiftHourlyWage(shift, draft);
    }, 0);
    document.getElementById('preview-hours').textContent = H.formatMinutes(minutes);
    document.getElementById('preview-pay').textContent = H.formatCurrency(pay, draft.currency);
  }

  settings.jobs.forEach(addJob);
  updateDefaultOptions(settings.defaultJob);

  document.getElementById('add-job').addEventListener('click', function () {
    addJob({ name: '', hourlyWage: 0 });
    const rows = jobRows();
    rows[rows.length - 1].querySelector('.job-name').focus();
  });
  wageInput.addEventListener('input', updatePreview);
  currencyInput.addEventListener('change', updatePreview);
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    const hourlyWage = Number(wageInput.value);
    if (!Number.isFinite(hourlyWage) || hourlyWage < 0) {
      message.textContent = 'Enter a valid fallback hourly wage of zero or more.';
      return;
    }
    const rows = jobRows();
    const incomplete = rows.some(function (row) {
      const name = row.querySelector('.job-name').value.trim();
      const wage = row.querySelector('.job-wage').value;
      return !name || wage === '' || !Number.isFinite(Number(wage)) || Number(wage) < 0;
    });
    if (incomplete) {
      message.textContent = 'Each job needs a name and a valid hourly wage of zero or more.';
      return;
    }
    const jobs = readJobs();
    const normalizedNames = jobs.map(function (job) { return job.name.toLowerCase(); });
    if (new Set(normalizedNames).size !== normalizedNames.length) {
      message.textContent = 'Job names must be unique.';
      return;
    }
    H.saveSettings({
      hourlyWage: hourlyWage,
      currency: currencyInput.value,
      weekStartsOn: weekStartInput.value,
      jobs: jobs,
      defaultJob: defaultJobInput.value
    });
    message.textContent = 'Settings saved. Each job’s reporting method now applies to its selected date range; payment estimates remain exact.';
    updatePreview();
  });

  updatePreview();
})();
