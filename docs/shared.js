(function () {
  'use strict';

  const STORAGE_KEY = 'hourglass.shifts.v1';
  const SETTINGS_KEY = 'hourglass.settings.v1';
  const ACTIVE_SHIFT_KEY = 'hourglass.activeShift.v1';
  const CLOCK_PHOTO_KEY = 'hourglass.clockPhoto.v1';
  const CLOCK_PHOTO_METADATA_KEY = 'hourglass.clockPhotoMetadata.v1';
  const NO_WORK_DATE_KEY = 'hourglass.noWorkDate.v1';
  const NO_WORK_RECORDS_KEY = 'hourglass.noWorkRecords.v1';
  const PAYMENTS_KEY = 'hourglass.payments.v1';
  const PROFILES_KEY = 'hourglass.profiles.v1';
  const ACTIVE_PROFILE_KEY = 'hourglass.activeProfile.v1';
  const DEFAULT_PROFILE_ID = 'default';
  const DEFAULT_SETTINGS = { hourlyWage: 0, currency: 'USD', weekStartsOn: 'monday', jobs: [], defaultJob: '' };
  const WEEK_DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const MAX_SHIFTS = 10000;
  const MAX_NO_WORK_RECORDS = 10000;
  const MAX_PROFILES = 20;
  const MAX_PAYMENTS = 5000;
  const MAX_IMAGE_DATA_LENGTH = 1500000;
  const BACKUP_FORMAT = 'hourglass-full-backup';
  const BACKUP_VERSION = 3;
  const PROFILE_DATA_KEYS = [STORAGE_KEY, SETTINGS_KEY, ACTIVE_SHIFT_KEY, CLOCK_PHOTO_KEY, CLOCK_PHOTO_METADATA_KEY, NO_WORK_DATE_KEY, NO_WORK_RECORDS_KEY, PAYMENTS_KEY];

  function sanitizeText(value, maximumLength) {
    return String(value == null ? '' : value)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .trim()
      .slice(0, maximumLength);
  }

  function sanitizeProfile(profile, index) {
    if (!profile || typeof profile !== 'object') return null;
    const id = sanitizeText(profile.id, 80).replace(/[^a-z0-9_-]/gi, '');
    const name = sanitizeText(profile.name, 50);
    if (!id || !name) return null;
    return { id: id, name: name, createdAt: sanitizeTimestamp(profile.createdAt) || (index === 0 ? new Date().toISOString() : '') };
  }

  function profileDataKey(profileId, key) {
    return 'hourglass.profile.' + profileId + '.' + key.slice('hourglass.'.length);
  }

  function migrateLegacyData(profileId) {
    PROFILE_DATA_KEYS.forEach(function (key) {
      const targetKey = profileDataKey(profileId, key);
      const legacyValue = localStorage.getItem(key);
      if (localStorage.getItem(targetKey) === null && legacyValue !== null) localStorage.setItem(targetKey, legacyValue);
    });
  }

  function getProfiles() {
    let profiles = [];
    try {
      const stored = JSON.parse(localStorage.getItem(PROFILES_KEY) || '[]');
      profiles = (Array.isArray(stored) ? stored : []).slice(0, MAX_PROFILES).map(sanitizeProfile).filter(Boolean);
    } catch (_error) {
      profiles = [];
    }
    if (!profiles.length) {
      profiles = [{ id: DEFAULT_PROFILE_ID, name: 'My profile', createdAt: new Date().toISOString() }];
      localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
      migrateLegacyData(DEFAULT_PROFILE_ID);
    }
    return profiles;
  }

  function saveProfiles(profiles) {
    const safeProfiles = (Array.isArray(profiles) ? profiles : []).slice(0, MAX_PROFILES).map(sanitizeProfile).filter(Boolean);
    if (!safeProfiles.length) throw new TypeError('At least one profile is required.');
    localStorage.setItem(PROFILES_KEY, JSON.stringify(safeProfiles));
  }

  function getActiveProfileId() {
    const profiles = getProfiles();
    const requested = sanitizeText(localStorage.getItem(ACTIVE_PROFILE_KEY), 80);
    const active = profiles.find(function (profile) { return profile.id === requested; }) || profiles[0];
    if (requested !== active.id) localStorage.setItem(ACTIVE_PROFILE_KEY, active.id);
    return active.id;
  }

  function getActiveProfile() {
    const activeId = getActiveProfileId();
    return getProfiles().find(function (profile) { return profile.id === activeId; });
  }

  function setActiveProfile(profileId) {
    const safeId = sanitizeText(profileId, 80);
    if (!getProfiles().some(function (profile) { return profile.id === safeId; })) throw new TypeError('Unknown profile.');
    localStorage.setItem(ACTIVE_PROFILE_KEY, safeId);
  }

  function createProfile(name) {
    const safeName = sanitizeText(name, 50);
    if (!safeName) throw new TypeError('Enter a user name.');
    const profiles = getProfiles();
    if (profiles.length >= MAX_PROFILES) throw new RangeError('The 20-user limit has been reached.');
    if (profiles.some(function (profile) { return profile.name.toLowerCase() === safeName.toLowerCase(); })) throw new TypeError('A user with that name already exists.');
    const profile = { id: 'user-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7), name: safeName, createdAt: new Date().toISOString() };
    profiles.push(profile);
    saveProfiles(profiles);
    return profile;
  }

  function profileStorageKey(key) {
    return profileDataKey(getActiveProfileId(), key);
  }

  function sanitizeDate(value) {
    const date = sanitizeText(value, 10);
    const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return '';
    const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return parsed.getFullYear() === Number(match[1]) && parsed.getMonth() === Number(match[2]) - 1 && parsed.getDate() === Number(match[3]) ? date : '';
  }

  function sanitizeTime(value) {
    const time = sanitizeText(value, 5);
    return timeToMinutes(time) === null ? '' : time;
  }

  function sanitizeTimestamp(value) {
    const timestamp = sanitizeText(value, 64);
    return timestamp && !Number.isNaN(new Date(timestamp).getTime()) ? timestamp : '';
  }

  function sanitizeImage(value) {
    const image = typeof value === 'string' ? value : '';
    return image.length <= MAX_IMAGE_DATA_LENGTH && /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(image) ? image : '';
  }

  function sanitizeImageMetadata(value) {
    if (!value || typeof value !== 'object') return null;
    function number(input, minimum, maximum) {
      const parsed = Number(input);
      return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : 0;
    }
    const latitude = value.gps && Number(value.gps.latitude);
    const longitude = value.gps && Number(value.gps.longitude);
    const safeGps = value.gps && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180 ? {
      latitude: latitude,
      longitude: longitude,
      altitude: number(value.gps.altitude, -12000, 100000)
    } : null;
    return {
      fileName: sanitizeText(value.fileName, 120),
      mimeType: sanitizeText(value.mimeType, 80),
      fileSize: number(value.fileSize, 0, 20 * 1024 * 1024),
      lastModified: number(value.lastModified, 0, 9999999999999),
      width: number(value.width, 0, 50000),
      height: number(value.height, 0, 50000),
      capturedAt: sanitizeText(value.capturedAt, 40),
      make: sanitizeText(value.make, 80),
      model: sanitizeText(value.model, 80),
      orientation: number(value.orientation, 0, 8),
      exposureTime: sanitizeText(value.exposureTime, 32),
      fNumber: number(value.fNumber, 0, 1000),
      iso: number(value.iso, 0, 10000000),
      focalLength: number(value.focalLength, 0, 100000),
      gps: safeGps
    };
  }

  function sanitizeBreak(item, allowIncomplete) {
    if (!item || typeof item !== 'object') return null;
    const start = sanitizeTime(item.start);
    const end = sanitizeTime(item.end);
    if (!start || (!allowIncomplete && !end)) return null;
    return {
      start: start,
      end: end,
      startedAt: sanitizeTimestamp(item.startedAt),
      endedAt: sanitizeTimestamp(item.endedAt)
    };
  }

  function sanitizeShift(shift, index) {
    if (!shift || typeof shift !== 'object') return null;
    const date = sanitizeDate(shift.date);
    const clockIn = sanitizeTime(shift.clockIn);
    const clockOut = sanitizeTime(shift.clockOut);
    if (!date || !clockIn || !clockOut) return null;
    const breaks = (Array.isArray(shift.breaks) ? shift.breaks : []).slice(0, 50).map(function (item) {
      return sanitizeBreak(item, false);
    }).filter(Boolean);
    return {
      id: sanitizeText(shift.id, 100) || 'legacy-' + String(index) + '-' + date,
      job: sanitizeText(shift.job, 80),
      date: date,
      clockIn: clockIn,
      clockOut: clockOut,
      clockInTimestamp: sanitizeTimestamp(shift.clockInTimestamp),
      clockOutTimestamp: sanitizeTimestamp(shift.clockOutTimestamp),
      breaks: breaks,
      breakMinutesOverride: Math.min(1439, Math.max(0, Number(shift.breakMinutesOverride) || 0)),
      notes: sanitizeText(shift.notes, 240),
      image: sanitizeImage(shift.image),
      imageMetadata: sanitizeImageMetadata(shift.imageMetadata),
      validated: shift.validated === true && Boolean(sanitizeTimestamp(shift.validatedAt)),
      validatedAt: shift.validated === true ? sanitizeTimestamp(shift.validatedAt) : ''
    };
  }

  function sanitizePayment(payment, index) {
    if (!payment || typeof payment !== 'object') return null;
    const id = sanitizeText(payment.id, 100) || 'payment-' + String(index);
    const paymentDate = sanitizeDate(payment.paymentDate);
    const periodStart = sanitizeDate(payment.periodStart);
    const periodEnd = sanitizeDate(payment.periodEnd);
    if (!paymentDate || !periodStart || !periodEnd || periodStart > periodEnd) return null;
    const shiftIds = [];
    const seenShiftIds = new Set();
    (Array.isArray(payment.shiftIds) ? payment.shiftIds : []).slice(0, MAX_SHIFTS).forEach(function (shiftId) {
      const safeId = sanitizeText(shiftId, 100);
      if (safeId && !seenShiftIds.has(safeId)) {
        seenShiftIds.add(safeId);
        shiftIds.push(safeId);
      }
    });
    if (!shiftIds.length) return null;
    function money(value) {
      const amount = Number(value);
      return Number.isFinite(amount) ? Math.min(1000000000, Math.max(0, Math.round(amount * 100) / 100)) : 0;
    }
    const methods = ['direct-deposit', 'check', 'cash', 'other'];
    return {
      id: id,
      job: sanitizeText(payment.job, 80),
      paymentDate: paymentDate,
      periodStart: periodStart,
      periodEnd: periodEnd,
      expectedGross: money(payment.expectedGross),
      paycheckGross: money(payment.paycheckGross),
      netReceived: money(payment.netReceived),
      method: methods.includes(payment.method) ? payment.method : 'other',
      reference: sanitizeText(payment.reference, 80),
      notes: sanitizeText(payment.notes, 500),
      shiftIds: shiftIds,
      createdAt: sanitizeTimestamp(payment.createdAt) || new Date().toISOString(),
      updatedAt: sanitizeTimestamp(payment.updatedAt) || new Date().toISOString()
    };
  }

  function normalizeWeekStart(value, fallback) {
    return WEEK_DAYS.includes(value) ? value : fallback;
  }

  function getShifts() {
    try {
      const value = JSON.parse(localStorage.getItem(profileStorageKey(STORAGE_KEY)) || '[]');
      return Array.isArray(value) ? value.slice(0, MAX_SHIFTS).map(sanitizeShift).filter(Boolean) : [];
    } catch (_error) {
      return [];
    }
  }

  // A review remains valid only while the shift's exact worked-hour fields match.
  function verificationSignature(shift) {
    return JSON.stringify([shift.job, shift.date, shift.clockIn, shift.clockOut,
      shift.clockInTimestamp, shift.clockOutTimestamp, shift.breakMinutesOverride,
      (shift.breaks || []).map(function (b) { return [b.start, b.end, b.startedAt, b.endedAt]; })]);
  }

  function saveShifts(shifts) {
    const previous = new Map(getShifts().map(function (s) { return [s.id, s]; }));
    const safeShifts = (Array.isArray(shifts) ? shifts : []).slice(0, MAX_SHIFTS).map(function (source, index) {
      const safe = sanitizeShift(source, index);
      if (!safe) return null;
      const old = previous.get(safe.id);
      if (old && verificationSignature(old) !== verificationSignature(safe)) {
        safe.validated = false;
        safe.validatedAt = '';
      } else if (old && !Object.prototype.hasOwnProperty.call(source, 'validated') &&
        !Object.prototype.hasOwnProperty.call(source, 'validatedAt')) {
        // Maintain verification when older callers update only the notes/photo.
        safe.validated = old.validated;
        safe.validatedAt = old.validatedAt;
      }
      return safe;
    }).filter(Boolean);
    localStorage.setItem(profileStorageKey(STORAGE_KEY), JSON.stringify(safeShifts));
  }

  function setShiftValidation(id, checked) {
    if (typeof checked !== 'boolean') throw new TypeError('Validation must be true or false.');
    const shifts = getShifts();
    const index = shifts.findIndex(function (shift) { return shift.id === sanitizeText(id, 100); });
    if (index < 0) throw new TypeError('Shift not found.');
    if (shifts[index].validated === checked) return shifts[index];
    shifts[index].validated = checked;
    shifts[index].validatedAt = checked ? new Date().toISOString() : '';
    saveShifts(shifts);
    return getShifts()[index];
  }

  function getValidationSummary(shifts) {
    const list = Array.isArray(shifts) ? shifts : getShifts();
    const validated = list.filter(function (item) { return item.validated && item.validatedAt; }).length;
    return { total: list.length, validated: validated, pending: list.length - validated };
  }

  function getPayments() {
    try {
      const value = JSON.parse(localStorage.getItem(profileStorageKey(PAYMENTS_KEY)) || '[]');
      return Array.isArray(value) ? value.slice(0, MAX_PAYMENTS).map(sanitizePayment).filter(Boolean) : [];
    } catch (_error) {
      return [];
    }
  }

  function savePayments(payments) {
    const safePayments = (Array.isArray(payments) ? payments : []).slice(0, MAX_PAYMENTS).map(sanitizePayment).filter(Boolean);
    const ids = new Set();
    safePayments.forEach(function (payment) {
      if (ids.has(payment.id)) throw new TypeError('Payment IDs must be unique.');
      ids.add(payment.id);
    });
    localStorage.setItem(profileStorageKey(PAYMENTS_KEY), JSON.stringify(safePayments));
  }

  function getPaymentForShift(shiftId) {
    const safeId = sanitizeText(shiftId, 100);
    return safeId ? getPayments().find(function (payment) { return payment.shiftIds.includes(safeId); }) || null : null;
  }

  function savePayment(payment) {
    const payments = getPayments();
    const existingIndex = payments.findIndex(function (item) { return item.id === sanitizeText(payment && payment.id, 100); });
    const existing = existingIndex >= 0 ? payments[existingIndex] : null;
    const candidate = sanitizePayment(Object.assign({}, payment, {
      id: existing ? existing.id : (sanitizeText(payment && payment.id, 100) || 'payment-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7)),
      createdAt: existing ? existing.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }), existingIndex >= 0 ? existingIndex : payments.length);
    if (!candidate) throw new TypeError('Enter valid payment details and select at least one shift.');

    const shifts = getShifts();
    const selectedShifts = candidate.shiftIds.map(function (shiftId) {
      return shifts.find(function (shift) { return shift.id === shiftId; });
    });
    if (selectedShifts.some(function (shift) { return !shift; })) throw new TypeError('One or more selected shifts no longer exist.');
    if (selectedShifts.some(function (shift) { return String(shift.job || '') !== candidate.job; })) throw new TypeError('All selected shifts must belong to the payment job.');
    if (selectedShifts.some(function (shift) { return shift.date < candidate.periodStart || shift.date > candidate.periodEnd; })) throw new TypeError('All selected shifts must fall within the pay period.');
    const conflict = payments.find(function (item) {
      return item.id !== candidate.id && item.shiftIds.some(function (shiftId) { return candidate.shiftIds.includes(shiftId); });
    });
    if (conflict) throw new TypeError('A selected shift is already linked to another payment.');

    const currentSettings = getSettings();
    candidate.expectedGross = Math.round(selectedShifts.reduce(function (sum, shift) {
      return sum + shiftMinutes(shift) / 60 * getShiftHourlyWage(shift, currentSettings);
    }, 0) * 100) / 100;
    if (existingIndex >= 0) payments[existingIndex] = candidate;
    else {
      if (payments.length >= MAX_PAYMENTS) throw new RangeError('The 5,000-payment limit has been reached.');
      payments.push(candidate);
    }

    const oldPayments = localStorage.getItem(profileStorageKey(PAYMENTS_KEY));
    try {
      savePayments(payments);
    } catch (error) {
      if (oldPayments === null) localStorage.removeItem(profileStorageKey(PAYMENTS_KEY));
      else localStorage.setItem(profileStorageKey(PAYMENTS_KEY), oldPayments);
      throw error;
    }
    return candidate;
  }

  function deletePayment(paymentId) {
    const safeId = sanitizeText(paymentId, 100);
    const payments = getPayments();
    const payment = payments.find(function (item) { return item.id === safeId; });
    if (!payment) return false;
    const remaining = payments.filter(function (item) { return item.id !== safeId; });
    const oldPayments = localStorage.getItem(profileStorageKey(PAYMENTS_KEY));
    try {
      savePayments(remaining);
    } catch (error) {
      if (oldPayments === null) localStorage.removeItem(profileStorageKey(PAYMENTS_KEY));
      else localStorage.setItem(profileStorageKey(PAYMENTS_KEY), oldPayments);
      throw error;
    }
    return true;
  }

  function clearPayments() {
    localStorage.removeItem(profileStorageKey(PAYMENTS_KEY));
  }

  function getShiftsAwaitingPayment() {
    const linkedShiftIds = new Set();
    getPayments().forEach(function (payment) {
      payment.shiftIds.forEach(function (shiftId) { linkedShiftIds.add(shiftId); });
    });
    return getShifts().filter(function (shift) { return !linkedShiftIds.has(shift.id); });
  }

  function normalizeSettings(stored) {
    const source = stored && typeof stored === 'object' ? stored : {};
    const weekStartsOn = normalizeWeekStart(source.weekStartsOn, DEFAULT_SETTINGS.weekStartsOn);
    const seen = new Set();
    const jobs = (Array.isArray(source.jobs) ? source.jobs : []).slice(0, 100).map(function (job) {
      return {
        name: sanitizeText(job && job.name, 80),
        hourlyWage: Math.min(100000, Math.max(0, Number(job && job.hourlyWage) || 0)),
        weekStartsOn: normalizeWeekStart(job && job.weekStartsOn, weekStartsOn),
        // Canonical 3-mode setting; legacy Build 35/36 boolean migrates to daily.
        roundingMode: job && ['off', 'daily', 'period'].includes(job.roundingMode)
          ? job.roundingMode : (job && job.roundDailyToQuarterHour === true ? 'daily' : 'off'),
        // Kept as a compatibility mirror for older backups/clients.
        roundDailyToQuarterHour: !!(job && (['off', 'daily', 'period'].includes(job.roundingMode)
          ? job.roundingMode === 'daily' : job.roundDailyToQuarterHour === true))
      };
    }).filter(function (job) {
      const key = job.name.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const requestedDefault = sanitizeText(source.defaultJob, 80);
    const defaultJob = jobs.some(function (job) { return job.name === requestedDefault; }) ? requestedDefault : (jobs[0] ? jobs[0].name : '');
    return {
      hourlyWage: Math.min(100000, Math.max(0, Number(source.hourlyWage) || 0)),
      currency: ['USD', 'CAD', 'EUR', 'GBP', 'AUD'].includes(source.currency) ? source.currency : DEFAULT_SETTINGS.currency,
      weekStartsOn: weekStartsOn,
      jobs: jobs,
      defaultJob: defaultJob
    };
  }

  function getSettings() {
    try {
      const stored = JSON.parse(localStorage.getItem(profileStorageKey(SETTINGS_KEY)) || '{}');
      return normalizeSettings(stored);
    } catch (_error) {
      return Object.assign({}, DEFAULT_SETTINGS);
    }
  }

  function saveSettings(settings) {
    localStorage.setItem(profileStorageKey(SETTINGS_KEY), JSON.stringify(normalizeSettings(settings)));
  }

  function getActiveShift() {
    try {
      const value = JSON.parse(localStorage.getItem(profileStorageKey(ACTIVE_SHIFT_KEY)) || 'null');
      if (!value || typeof value !== 'object') return null;
      const date = sanitizeDate(value.date);
      const clockIn = sanitizeTime(value.clockIn);
      const startedAt = sanitizeTimestamp(value.startedAt);
      if (!date || !clockIn || !startedAt) return null;
      return {
        date: date,
        job: sanitizeText(value.job, 80),
        clockIn: clockIn,
        startedAt: startedAt,
        breaks: (Array.isArray(value.breaks) ? value.breaks : []).slice(0, 50).map(function (item) { return sanitizeBreak(item, true); }).filter(Boolean)
      };
    } catch (_error) {
      return null;
    }
  }

  function saveActiveShift(shift) {
    if (!shift || typeof shift !== 'object') throw new TypeError('Invalid active shift.');
    const safeShift = {
      date: sanitizeDate(shift.date),
      job: sanitizeText(shift.job, 80),
      clockIn: sanitizeTime(shift.clockIn),
      startedAt: sanitizeTimestamp(shift.startedAt),
      breaks: (Array.isArray(shift.breaks) ? shift.breaks : []).slice(0, 50).map(function (item) { return sanitizeBreak(item, true); }).filter(Boolean)
    };
    if (!safeShift.date || !safeShift.clockIn || !safeShift.startedAt) throw new TypeError('Invalid active shift.');
    localStorage.setItem(profileStorageKey(ACTIVE_SHIFT_KEY), JSON.stringify(safeShift));
  }

  function clearActiveShift() {
    localStorage.removeItem(profileStorageKey(ACTIVE_SHIFT_KEY));
  }

  function getClockPhoto() {
    return sanitizeImage(localStorage.getItem(profileStorageKey(CLOCK_PHOTO_KEY)) || '');
  }

  function saveClockPhoto(dataUrl) {
    const image = sanitizeImage(dataUrl);
    if (!image) throw new TypeError('Invalid image data.');
    localStorage.setItem(profileStorageKey(CLOCK_PHOTO_KEY), image);
  }

  function getClockPhotoMetadata() {
    try { return sanitizeImageMetadata(JSON.parse(localStorage.getItem(profileStorageKey(CLOCK_PHOTO_METADATA_KEY)) || 'null')); } catch (_error) { return null; }
  }

  function saveClockPhotoMetadata(metadata) {
    const safeMetadata = sanitizeImageMetadata(metadata);
    if (!safeMetadata) throw new TypeError('Invalid image metadata.');
    localStorage.setItem(profileStorageKey(CLOCK_PHOTO_METADATA_KEY), JSON.stringify(safeMetadata));
  }

  function clearClockPhoto() {
    localStorage.removeItem(profileStorageKey(CLOCK_PHOTO_KEY));
    localStorage.removeItem(profileStorageKey(CLOCK_PHOTO_METADATA_KEY));
  }

  function sanitizeNoWorkRecord(record, index) {
    if (!record || typeof record !== 'object') return null;
    const date = sanitizeDate(record.date);
    if (!date) return null;
    return {
      id: sanitizeText(record.id, 100) || 'no-work-' + date + '-' + String(index),
      date: date,
      job: '',
      createdAt: sanitizeTimestamp(record.createdAt)
    };
  }

  function getNoWorkRecords() {
    let records = [];
    try {
      const stored = JSON.parse(localStorage.getItem(profileStorageKey(NO_WORK_RECORDS_KEY)) || '[]');
      records = (Array.isArray(stored) ? stored : []).slice(0, MAX_NO_WORK_RECORDS).map(sanitizeNoWorkRecord).filter(Boolean);
    } catch (_error) {
      records = [];
    }
    const legacyDate = sanitizeDate(localStorage.getItem(profileStorageKey(NO_WORK_DATE_KEY)) || '');
    if (legacyDate && !records.some(function (record) { return record.date === legacyDate; })) {
      records.push({ id: 'no-work-' + legacyDate + '-legacy', date: legacyDate, job: '', createdAt: '' });
    }
    const seen = new Set();
    return records.filter(function (record) {
      if (seen.has(record.date)) return false;
      seen.add(record.date);
      return true;
    });
  }

  function saveNoWorkRecords(records) {
    const safeRecords = (Array.isArray(records) ? records : []).slice(0, MAX_NO_WORK_RECORDS).map(sanitizeNoWorkRecord).filter(Boolean);
    localStorage.setItem(profileStorageKey(NO_WORK_RECORDS_KEY), JSON.stringify(safeRecords));
    localStorage.removeItem(profileStorageKey(NO_WORK_DATE_KEY));
  }

  function getNoWorkRecord(date) {
    const safeDate = sanitizeDate(date);
    return safeDate ? getNoWorkRecords().find(function (record) { return record.date === safeDate; }) || null : null;
  }

  function getNoWorkDate() {
    const records = getNoWorkRecords().slice().sort(function (a, b) { return b.date.localeCompare(a.date); });
    return records[0] ? records[0].date : '';
  }

  function setNoWorkDate(date) {
    const safeDate = sanitizeDate(date);
    if (!safeDate) throw new TypeError('Invalid no-work date.');
    const records = getNoWorkRecords();
    if (!records.some(function (record) { return record.date === safeDate; })) {
      records.push({ id: 'no-work-' + safeDate + '-' + Date.now().toString(36), date: safeDate, job: '', createdAt: new Date().toISOString() });
    }
    saveNoWorkRecords(records);
  }

  function clearNoWorkDate(date) {
    const targetDate = sanitizeDate(date) || getNoWorkDate();
    saveNoWorkRecords(getNoWorkRecords().filter(function (record) { return record.date !== targetDate; }));
  }

  function deleteNoWorkRecord(id) {
    const safeId = sanitizeText(id, 100);
    saveNoWorkRecords(getNoWorkRecords().filter(function (record) { return record.id !== safeId; }));
  }

  function clearNoWorkRecords() {
    saveNoWorkRecords([]);
  }

  function parseStoredJson(profileId, key, fallback) {
    try {
      const stored = localStorage.getItem(profileDataKey(profileId, key));
      return stored === null ? fallback : JSON.parse(stored);
    } catch (_error) {
      return fallback;
    }
  }

  function sanitizeActiveShift(value) {
    if (!value || typeof value !== 'object') return null;
    const date = sanitizeDate(value.date);
    const clockIn = sanitizeTime(value.clockIn);
    const startedAt = sanitizeTimestamp(value.startedAt);
    if (!date || !clockIn || !startedAt) return null;
    return {
      date: date,
      job: sanitizeText(value.job, 80),
      clockIn: clockIn,
      startedAt: startedAt,
      breaks: (Array.isArray(value.breaks) ? value.breaks : []).slice(0, 50).map(function (item) { return sanitizeBreak(item, true); }).filter(Boolean)
    };
  }

  function profileBackup(profile) {
    const shifts = parseStoredJson(profile.id, STORAGE_KEY, []);
    const records = parseStoredJson(profile.id, NO_WORK_RECORDS_KEY, []);
    const legacyDate = sanitizeDate(localStorage.getItem(profileDataKey(profile.id, NO_WORK_DATE_KEY)) || '');
    const safeRecords = (Array.isArray(records) ? records : []).slice(0, MAX_NO_WORK_RECORDS).map(sanitizeNoWorkRecord).filter(Boolean);
    if (legacyDate && !safeRecords.some(function (record) { return record.date === legacyDate; })) {
      safeRecords.push({ id: 'no-work-' + legacyDate + '-legacy', date: legacyDate, job: '', createdAt: '' });
    }
    return {
      id: profile.id,
      name: profile.name,
      createdAt: profile.createdAt,
      settings: normalizeSettings(parseStoredJson(profile.id, SETTINGS_KEY, {})),
      shifts: (Array.isArray(shifts) ? shifts : []).slice(0, MAX_SHIFTS).map(sanitizeShift).filter(Boolean),
      activeShift: sanitizeActiveShift(parseStoredJson(profile.id, ACTIVE_SHIFT_KEY, null)),
      clockPhoto: sanitizeImage(localStorage.getItem(profileDataKey(profile.id, CLOCK_PHOTO_KEY)) || ''),
      clockPhotoMetadata: sanitizeImageMetadata(parseStoredJson(profile.id, CLOCK_PHOTO_METADATA_KEY, null)),
      noWorkRecords: safeRecords,
      payments: (function () {
        const payments = parseStoredJson(profile.id, PAYMENTS_KEY, []);
        return (Array.isArray(payments) ? payments : []).slice(0, MAX_PAYMENTS).map(sanitizePayment).filter(Boolean);
      })()
    };
  }

  function createFullBackup() {
    const profiles = getProfiles();
    return {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      activeProfileId: getActiveProfileId(),
      profiles: profiles.map(profileBackup)
    };
  }

  function validateFullBackup(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('This is not a valid Hourglass backup.');
    if (input.format !== BACKUP_FORMAT) throw new TypeError('This file is not a full Hourglass backup.');
    if (![1, 2, BACKUP_VERSION].includes(input.version)) throw new TypeError('This backup version is not supported.');
    if (!Array.isArray(input.profiles) || !input.profiles.length) throw new TypeError('The backup does not contain any users.');
    if (input.profiles.length > MAX_PROFILES) throw new RangeError('The backup exceeds the 20-user limit.');

    const ids = new Set();
    const names = new Set();
    const profiles = input.profiles.map(function (source, profileIndex) {
      const profile = sanitizeProfile(source, profileIndex);
      if (!profile || !source.createdAt || !sanitizeTimestamp(source.createdAt)) throw new TypeError('The backup contains an invalid user.');
      const lowerName = profile.name.toLowerCase();
      if (ids.has(profile.id) || names.has(lowerName)) throw new TypeError('The backup contains duplicate users.');
      ids.add(profile.id);
      names.add(lowerName);

      if (!Array.isArray(source.shifts)) throw new TypeError('The backup contains invalid shift data.');
      if (source.shifts.length > MAX_SHIFTS) throw new RangeError('A user in the backup exceeds the 10,000-shift limit.');
      const shifts = source.shifts.map(function (item, shiftIndex) {
        const safe = sanitizeShift(item, shiftIndex);
        if (!safe) throw new TypeError('The backup contains an invalid shift.');
        if (item.image && !safe.image) throw new TypeError('The backup contains an unsupported shift image.');
        if (item.imageMetadata && !safe.imageMetadata) throw new TypeError('The backup contains invalid image metadata.');
        return safe;
      });

      if (!source.settings || typeof source.settings !== 'object' || Array.isArray(source.settings)) throw new TypeError('The backup contains invalid settings.');
      const activeShift = source.activeShift == null ? null : sanitizeActiveShift(source.activeShift);
      if (source.activeShift != null && !activeShift) throw new TypeError('The backup contains an invalid active shift.');
      const clockPhoto = sanitizeImage(source.clockPhoto || '');
      if (source.clockPhoto && !clockPhoto) throw new TypeError('The backup contains an unsupported clock photo.');
      const clockPhotoMetadata = source.clockPhotoMetadata == null ? null : sanitizeImageMetadata(source.clockPhotoMetadata);
      if (source.clockPhotoMetadata != null && !clockPhotoMetadata) throw new TypeError('The backup contains invalid clock-photo metadata.');

      if (!Array.isArray(source.noWorkRecords)) throw new TypeError('The backup contains invalid no-work records.');
      if (source.noWorkRecords.length > MAX_NO_WORK_RECORDS) throw new RangeError('A user in the backup exceeds the 10,000 no-work-day limit.');
      const noWorkDates = new Set();
      const noWorkRecords = source.noWorkRecords.map(function (item, recordIndex) {
        const safe = sanitizeNoWorkRecord(item, recordIndex);
        if (!safe || noWorkDates.has(safe.date)) throw new TypeError('The backup contains an invalid or duplicate no-work day.');
        noWorkDates.add(safe.date);
        return safe;
      });

      const sourcePayments = input.version === 1 && source.payments == null ? [] : source.payments;
      if (!Array.isArray(sourcePayments)) throw new TypeError('The backup contains invalid payment history.');
      if (sourcePayments.length > MAX_PAYMENTS) throw new RangeError('A user in the backup exceeds the 5,000-payment limit.');
      const paymentIds = new Set();
      const linkedShiftIds = new Set();
      const payments = sourcePayments.map(function (item, paymentIndex) {
        const safe = sanitizePayment(item, paymentIndex);
        if (!safe || paymentIds.has(safe.id)) throw new TypeError('The backup contains an invalid or duplicate payment.');
        paymentIds.add(safe.id);
        safe.shiftIds.forEach(function (shiftId) {
          const shift = shifts.find(function (candidate) { return candidate.id === shiftId; });
          if (!shift || linkedShiftIds.has(shiftId)) throw new TypeError('The backup contains an invalid payment-to-shift link.');
          if (String(shift.job || '') !== safe.job || shift.date < safe.periodStart || shift.date > safe.periodEnd) {
            throw new TypeError('A payment in the backup does not match its linked shifts.');
          }
          linkedShiftIds.add(shiftId);
        });
        return safe;
      });

      return {
        id: profile.id,
        name: profile.name,
        createdAt: profile.createdAt,
        settings: normalizeSettings(source.settings),
        shifts: shifts,
        activeShift: activeShift,
        clockPhoto: clockPhoto,
        clockPhotoMetadata: clockPhotoMetadata,
        noWorkRecords: noWorkRecords,
        payments: payments
      };
    });

    const activeProfileId = sanitizeText(input.activeProfileId, 80);
    if (!profiles.some(function (profile) { return profile.id === activeProfileId; })) throw new TypeError('The backup has an invalid active user.');
    return {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: sanitizeTimestamp(input.exportedAt) || new Date().toISOString(),
      activeProfileId: activeProfileId,
      profiles: profiles
    };
  }

  function hourglassStorageKeys() {
    const keys = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && key.indexOf('hourglass.') === 0) keys.push(key);
    }
    return keys;
  }

  function restoreFullBackup(input) {
    const backup = validateFullBackup(input);
    const previous = {};
    hourglassStorageKeys().forEach(function (key) { previous[key] = localStorage.getItem(key); });
    try {
      hourglassStorageKeys().forEach(function (key) { localStorage.removeItem(key); });
      localStorage.setItem(PROFILES_KEY, JSON.stringify(backup.profiles.map(function (profile) {
        return { id: profile.id, name: profile.name, createdAt: profile.createdAt };
      })));
      localStorage.setItem(ACTIVE_PROFILE_KEY, backup.activeProfileId);
      backup.profiles.forEach(function (profile) {
        localStorage.setItem(profileDataKey(profile.id, SETTINGS_KEY), JSON.stringify(profile.settings));
        localStorage.setItem(profileDataKey(profile.id, STORAGE_KEY), JSON.stringify(profile.shifts));
        localStorage.setItem(profileDataKey(profile.id, NO_WORK_RECORDS_KEY), JSON.stringify(profile.noWorkRecords));
        localStorage.setItem(profileDataKey(profile.id, PAYMENTS_KEY), JSON.stringify(profile.payments));
        if (profile.activeShift) localStorage.setItem(profileDataKey(profile.id, ACTIVE_SHIFT_KEY), JSON.stringify(profile.activeShift));
        if (profile.clockPhoto) localStorage.setItem(profileDataKey(profile.id, CLOCK_PHOTO_KEY), profile.clockPhoto);
        if (profile.clockPhotoMetadata) localStorage.setItem(profileDataKey(profile.id, CLOCK_PHOTO_METADATA_KEY), JSON.stringify(profile.clockPhotoMetadata));
      });
    } catch (error) {
      hourglassStorageKeys().forEach(function (key) { localStorage.removeItem(key); });
      Object.keys(previous).forEach(function (key) { localStorage.setItem(key, previous[key]); });
      throw error;
    }
    return backup;
  }

  function timeToMinutes(time) {
    if (!time || !/^\d{2}:\d{2}$/.test(time)) return null;
    const [hours, minutes] = time.split(':').map(Number);
    if (hours > 23 || minutes > 59) return null;
    return hours * 60 + minutes;
  }

  function elapsedMinutes(start, end) {
    const startMinutes = timeToMinutes(start);
    let endMinutes = timeToMinutes(end);
    if (startMinutes === null || endMinutes === null) return 0;
    if (endMinutes < startMinutes) endMinutes += 24 * 60;
    return endMinutes - startMinutes;
  }

  function shiftMinutes(shift) {
    const gross = elapsedMinutes(shift.clockIn, shift.clockOut);
    return Math.max(0, gross - breakMinutes(shift));
  }

  function breakMinutes(shift) {
    const timedBreaks = (shift.breaks || []).reduce(function (sum, item) {
      return sum + elapsedMinutes(item.start, item.end);
    }, 0);
    return timedBreaks || Math.max(0, Number(shift.breakMinutesOverride) || 0);
  }

  function formatMinutes(total) {
    const safe = Math.max(0, Math.round(total || 0));
    return Math.floor(safe / 60) + 'h ' + String(safe % 60).padStart(2, '0') + 'm';
  }

  function formatDecimalHours(totalMinutes) {
    return (Math.max(0, Number(totalMinutes) || 0) / 60).toFixed(2);
  }

  function formatTime12(time) {
    const minutes = timeToMinutes(time);
    if (minutes === null) return time || '';
    const hour24 = Math.floor(minutes / 60);
    const minute = minutes % 60;
    const period = hour24 >= 12 ? 'PM' : 'AM';
    const hour12 = hour24 % 12 || 12;
    return hour12 + ':' + String(minute).padStart(2, '0') + ' ' + period;
  }

  function compareShiftsNewestFirst(a, b) {
    return String(b && b.date || '').localeCompare(String(a && a.date || '')) ||
      String(b && b.clockIn || '').localeCompare(String(a && a.clockIn || '')) ||
      String(b && b.clockOut || '').localeCompare(String(a && a.clockOut || '')) ||
      String(b && b.clockInTimestamp || '').localeCompare(String(a && a.clockInTimestamp || '')) ||
      String(b && b.id || '').localeCompare(String(a && a.id || ''));
  }

  function formatCurrency(amount, currency) {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD' }).format(Number(amount) || 0);
    } catch (_error) {
      return '$' + (Number(amount) || 0).toFixed(2);
    }
  }

  function getJobName(shift) {
    return String(shift && shift.job || '').trim() || 'Unassigned';
  }

  function getShiftHourlyWage(shift, settings) {
    const currentSettings = settings || getSettings();
    const jobName = String(shift && shift.job || '').trim();
    const job = (currentSettings.jobs || []).find(function (item) { return item.name === jobName; });
    return job ? Math.max(0, Number(job.hourlyWage) || 0) : Math.max(0, Number(currentSettings.hourlyWage) || 0);
  }

  // Reporting calculations share the same pure module. Passing only the shifts
  // in the requested date/job range defines exactly one reporting period.
  function reportingInputs(shifts, settings) {
    const currentSettings = normalizeSettings(settings || getSettings());
    const modes = Object.create(null);
    currentSettings.jobs.forEach(function (job) { modes['job:' + job.name] = job.roundingMode; });
    // Unassigned and removed jobs remain exact by default.
    const entries = shifts.map(function (shift) {
      return { date: shift.date, jobId: 'job:' + String(shift.job || '').trim(), netMinutes: shiftMinutes(shift) };
    });
    return { modes: modes, entries: entries };
  }

  function getDailyJobTotals(shifts, settings) {
    const input = reportingInputs(shifts, settings);
    return window.HourglassRounding.calculateDailyJobTotals(input.entries, input.modes).map(function (day) {
      return Object.assign({}, day, { job: day.jobId.slice(4) });
    });
  }

  function getReportingSummary(shifts, settings) {
    const input = reportingInputs(shifts, settings);
    const result = window.HourglassRounding.calculateReportingSummary(input.entries, input.modes);
    return Object.assign({}, result, {
      dailyTotals: result.dailyTotals.map(function (day) { return Object.assign({}, day, { job: day.jobId.slice(4) }); }),
      jobs: result.jobs.map(function (job) { return Object.assign({}, job, { job: job.jobId.slice(4) }); })
    });
  }

  function getReportedMinutes(shifts, settings) {
    return getReportingSummary(shifts, settings).reportedMinutes;
  }

  function getShiftWeekStartsOn(shift, settings) {
    const currentSettings = settings || getSettings();
    const jobName = String(shift && shift.job || '').trim();
    const job = (currentSettings.jobs || []).find(function (item) { return item.name === jobName; });
    return normalizeWeekStart(job && job.weekStartsOn, normalizeWeekStart(currentSettings.weekStartsOn, DEFAULT_SETTINGS.weekStartsOn));
  }

  function parseLocalDate(dateString) {
    const parts = dateString.split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function dateKey(date) {
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  }

  function formatDate(dateString, options) {
    return new Intl.DateTimeFormat(undefined, options || { month: 'short', day: 'numeric', year: 'numeric' }).format(parseLocalDate(dateString));
  }

  window.Hourglass = {
    getProfiles,
    getActiveProfile,
    setActiveProfile,
    createProfile,
    createFullBackup,
    validateFullBackup,
    restoreFullBackup,
    getShifts,
    saveShifts,
    setShiftValidation,
    getValidationSummary,
    getPayments,
    savePayment,
    deletePayment,
    clearPayments,
    getPaymentForShift,
    getShiftsAwaitingPayment,
    getSettings,
    saveSettings,
    getActiveShift,
    saveActiveShift,
    clearActiveShift,
    getClockPhoto,
    saveClockPhoto,
    getClockPhotoMetadata,
    saveClockPhotoMetadata,
    clearClockPhoto,
    getNoWorkDate,
    getNoWorkRecords,
    getNoWorkRecord,
    setNoWorkDate,
    clearNoWorkDate,
    deleteNoWorkRecord,
    clearNoWorkRecords,
    elapsedMinutes,
    shiftMinutes,
    breakMinutes,
    formatMinutes,
    formatDecimalHours,
    formatTime12,
    compareShiftsNewestFirst,
    formatCurrency,
    getJobName,
    getShiftHourlyWage,
    getDailyJobTotals,
    getReportingSummary,
    getReportedMinutes,
    getShiftWeekStartsOn,
    parseLocalDate,
    dateKey,
    formatDate
  };
})();
