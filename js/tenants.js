import { parseDateString, formatDateString } from '../date-utils.js';
import { roundCurrency } from './formatters.js';
import { normalizeDate } from './scheduling.js';

export const TENANT_SLOT_COUNT = 7;
export const DEFAULT_TENANT_DUE_DAY = 10;

function isMonthValue(rawValue) {
    return /^\d{4}-\d{2}$/.test(String(rawValue || ''));
}

function sanitizeDueDay(rawValue) {
    const parsed = Number(rawValue);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 28) {
        return DEFAULT_TENANT_DUE_DAY;
    }
    return parsed;
}

function sanitizeTenantId(rawValue, fallbackValue) {
    const parsed = Number(rawValue);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > TENANT_SLOT_COUNT) {
        return fallbackValue;
    }
    return parsed;
}

export function buildDefaultTenantProfiles() {
    return Array.from({ length: TENANT_SLOT_COUNT }, (_, index) => ({
        id: index + 1,
        isActive: false,
        name: '',
        amount: 0,
        dueDay: DEFAULT_TENANT_DUE_DAY
    }));
}

export function sanitizeTenantProfiles(rawProfiles) {
    const profiles = Array.isArray(rawProfiles) ? rawProfiles : [];
    const byId = new Map();
    profiles.forEach((profile, index) => {
        if (!profile || typeof profile !== 'object') {
            return;
        }

        const id = sanitizeTenantId(profile.id, index + 1);
        byId.set(id, {
            id,
            isActive: Boolean(profile.isActive),
            name: String(profile.name || '').trim().slice(0, 120),
            amount: Math.max(0, roundCurrency(Number(profile.amount) || 0)),
            dueDay: sanitizeDueDay(profile.dueDay)
        });
    });

    return buildDefaultTenantProfiles().map(defaultProfile => {
        const existing = byId.get(defaultProfile.id);
        return existing ? { ...defaultProfile, ...existing } : defaultProfile;
    });
}

export function sanitizeTenantPaymentHistory(rawHistory) {
    const history = Array.isArray(rawHistory) ? rawHistory : [];
    const sanitized = [];
    const seenKeys = new Set();

    history.forEach((record, index) => {
        if (!record || typeof record !== 'object') {
            return;
        }

        const tenantId = sanitizeTenantId(record.tenantId, 0);
        const month = isMonthValue(record.month) ? String(record.month) : '';
        if (!tenantId || !month) {
            return;
        }

        const logicalKey = `${tenantId}:${month}`;
        if (seenKeys.has(logicalKey)) {
            return;
        }
        seenKeys.add(logicalKey);

        const dueDate = String(record.dueDate || '').trim();
        const paidAt = String(record.paidAt || '').trim();
        const incomeEntryId = Number(record.incomeEntryId);

        sanitized.push({
            id: Number.isInteger(Number(record.id)) && Number(record.id) > 0
                ? Number(record.id)
                : Date.now() + index,
            tenantId,
            month,
            amount: Math.max(0, roundCurrency(Number(record.amount) || 0)),
            dueDate: !Number.isNaN(parseDateString(dueDate).getTime())
                ? formatDateString(parseDateString(dueDate))
                : getTenantDueDate(month, DEFAULT_TENANT_DUE_DAY),
            paid: Boolean(record.paid),
            paidAt: !Number.isNaN(parseDateString(paidAt).getTime())
                ? formatDateString(parseDateString(paidAt))
                : '',
            incomeEntryId: Number.isInteger(incomeEntryId) && incomeEntryId > 0 ? incomeEntryId : null
        });
    });

    return sanitized;
}

export function isTenantProfilesEffectivelyEmpty(profiles) {
    const sanitized = sanitizeTenantProfiles(profiles);
    return sanitized.every(profile => (
        profile.isActive === false
        && !profile.name
        && Number(profile.amount) === 0
        && Number(profile.dueDay) === DEFAULT_TENANT_DUE_DAY
    ));
}

export function getTenantDueDate(monthValue, dueDay) {
    if (!isMonthValue(monthValue)) {
        return '';
    }
    return `${monthValue}-${String(sanitizeDueDay(dueDay)).padStart(2, '0')}`;
}

export function getTenantRecordForMonth(history, tenantId, monthValue) {
    const safeHistory = Array.isArray(history) ? history : [];
    return safeHistory.find(record =>
        Number(record?.tenantId) === Number(tenantId)
        && String(record?.month || '') === String(monthValue || '')
    ) || null;
}

export function upsertTenantPaymentRecord(history, nextRecord) {
    const safeHistory = Array.isArray(history) ? [...history] : [];
    const targetTenantId = Number(nextRecord?.tenantId);
    const targetMonth = String(nextRecord?.month || '');
    const nextLogicalKey = `${targetTenantId}:${targetMonth}`;
    const filtered = safeHistory.filter(record => `${Number(record?.tenantId)}:${String(record?.month || '')}` !== nextLogicalKey);
    filtered.push(nextRecord);
    return filtered.sort((left, right) => {
        const monthCompare = String(left.month).localeCompare(String(right.month));
        if (monthCompare !== 0) {
            return monthCompare;
        }
        return Number(left.tenantId) - Number(right.tenantId);
    });
}

function compareMonthValue(monthValue, todayDate) {
    if (!isMonthValue(monthValue)) {
        return 0;
    }

    const [yearString, monthString] = monthValue.split('-');
    const selected = Number(yearString) * 100 + Number(monthString);
    const todayMarker = todayDate.getFullYear() * 100 + (todayDate.getMonth() + 1);
    if (selected < todayMarker) {
        return -1;
    }
    if (selected > todayMarker) {
        return 1;
    }
    return 0;
}

export function buildTenantMonthStatus({ profile, historyRecord, monthValue, today }) {
    const normalizedToday = normalizeDate(today || new Date());
    const dueDate = historyRecord?.dueDate || getTenantDueDate(monthValue, profile?.dueDay);

    if (!profile?.isActive) {
        return {
            key: 'inactive',
            label: 'Ukryty slot'
        };
    }

    if (historyRecord?.paid === true) {
        return {
            key: 'paid',
            label: 'Zapłacono'
        };
    }

    if (compareMonthValue(monthValue, normalizedToday) < 0 && !historyRecord) {
        return {
            key: 'missing',
            label: 'Brak danych'
        };
    }

    const parsedDueDate = parseDateString(dueDate);
    if (!Number.isNaN(parsedDueDate.getTime()) && parsedDueDate < normalizedToday) {
        return {
            key: 'overdue',
            label: 'Po terminie'
        };
    }

    return {
        key: 'awaiting',
        label: 'Oczekuje'
    };
}

export function buildTenantMonthRows({ profiles, history, monthValue, today }) {
    const safeProfiles = sanitizeTenantProfiles(profiles);
    const safeHistory = sanitizeTenantPaymentHistory(history);
    const normalizedToday = normalizeDate(today || new Date());

    return safeProfiles.map(profile => {
        const historyRecord = getTenantRecordForMonth(safeHistory, profile.id, monthValue);
        const dueDate = historyRecord?.dueDate || getTenantDueDate(monthValue, profile.dueDay);
        return {
            profile,
            historyRecord,
            dueDate,
            status: buildTenantMonthStatus({
                profile,
                historyRecord,
                monthValue,
                today: normalizedToday
            })
        };
    });
}

export function summarizeTenantMonthRows(monthRows) {
    const safeRows = Array.isArray(monthRows) ? monthRows : [];

    return safeRows.reduce((summary, row) => {
        const amount = roundCurrency(Number(row?.historyRecord?.amount) > 0
            ? Number(row.historyRecord.amount)
            : Number(row?.profile?.amount) || 0);

        if (!row?.profile?.isActive) {
            summary.hidden += 1;
            return summary;
        }

        summary.active += 1;
        summary.expectedAmount = roundCurrency(summary.expectedAmount + amount);

        if (row.status?.key === 'paid') {
            summary.paid += 1;
            summary.paidAmount = roundCurrency(summary.paidAmount + amount);
            return summary;
        }

        if (row.status?.key === 'overdue') {
            summary.overdue += 1;
            summary.overdueAmount = roundCurrency(summary.overdueAmount + amount);
        } else {
            summary.awaiting += 1;
        }

        summary.pendingAmount = roundCurrency(summary.pendingAmount + amount);
        return summary;
    }, {
        active: 0,
        paid: 0,
        overdue: 0,
        awaiting: 0,
        hidden: 0,
        expectedAmount: 0,
        paidAmount: 0,
        pendingAmount: 0,
        overdueAmount: 0
    });
}
