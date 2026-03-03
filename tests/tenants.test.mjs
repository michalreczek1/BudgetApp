import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildDefaultTenantProfiles,
    sanitizeTenantProfiles,
    sanitizeTenantPaymentHistory,
    getTenantDueDate,
    getTenantRecordForMonth,
    upsertTenantPaymentRecord,
    buildTenantMonthStatus,
    buildTenantMonthRows,
    summarizeTenantMonthRows
} from '../js/tenants.js';

test('buildDefaultTenantProfiles returns 7 inactive slots', () => {
    const profiles = buildDefaultTenantProfiles();
    assert.equal(profiles.length, 7);
    assert.deepEqual(profiles[0], {
        id: 1,
        isActive: false,
        name: '',
        amount: 0,
        dueDay: 10
    });
    assert.equal(profiles[6].id, 7);
});

test('sanitizeTenantProfiles normalizes ids and fills missing slots', () => {
    const profiles = sanitizeTenantProfiles([
        { id: 2, isActive: true, name: ' Nowak ', amount: 2100.555, dueDay: 15 }
    ]);

    assert.equal(profiles.length, 7);
    assert.deepEqual(profiles[1], {
        id: 2,
        isActive: true,
        name: 'Nowak',
        amount: 2100.55,
        dueDay: 15
    });
    assert.equal(profiles[0].id, 1);
    assert.equal(profiles[0].isActive, false);
});

test('getTenantDueDate creates month snapshot date', () => {
    assert.equal(getTenantDueDate('2026-03', 7), '2026-03-07');
});

test('buildTenantMonthStatus returns awaiting before due date', () => {
    const status = buildTenantMonthStatus({
        profile: { id: 1, isActive: true, name: 'Kowalski', amount: 1800, dueDay: 10 },
        historyRecord: null,
        monthValue: '2026-03',
        today: new Date('2026-03-05T12:00:00Z')
    });

    assert.equal(status.key, 'awaiting');
});

test('buildTenantMonthStatus returns overdue after due date', () => {
    const status = buildTenantMonthStatus({
        profile: { id: 1, isActive: true, name: 'Kowalski', amount: 1800, dueDay: 10 },
        historyRecord: null,
        monthValue: '2026-03',
        today: new Date('2026-03-15T12:00:00Z')
    });

    assert.equal(status.key, 'overdue');
});

test('buildTenantMonthStatus returns paid for paid record', () => {
    const status = buildTenantMonthStatus({
        profile: { id: 1, isActive: true, name: 'Kowalski', amount: 1800, dueDay: 10 },
        historyRecord: {
            id: 100,
            tenantId: 1,
            month: '2026-03',
            amount: 1800,
            dueDate: '2026-03-10',
            paid: true,
            paidAt: '2026-03-09',
            incomeEntryId: 500
        },
        monthValue: '2026-03',
        today: new Date('2026-03-15T12:00:00Z')
    });

    assert.equal(status.key, 'paid');
});

test('buildTenantMonthStatus returns missing for past month without record', () => {
    const status = buildTenantMonthStatus({
        profile: { id: 1, isActive: true, name: 'Kowalski', amount: 1800, dueDay: 10 },
        historyRecord: null,
        monthValue: '2026-02',
        today: new Date('2026-03-15T12:00:00Z')
    });

    assert.equal(status.key, 'missing');
});

test('sanitizeTenantPaymentHistory removes duplicate tenant-month records', () => {
    const history = sanitizeTenantPaymentHistory([
        {
            id: 1,
            tenantId: 1,
            month: '2026-03',
            amount: 1800,
            dueDate: '2026-03-10',
            paid: true,
            paidAt: '2026-03-09',
            incomeEntryId: 401
        },
        {
            id: 2,
            tenantId: 1,
            month: '2026-03',
            amount: 1900,
            dueDate: '2026-03-11',
            paid: false,
            paidAt: '',
            incomeEntryId: null
        }
    ]);

    assert.equal(history.length, 1);
    assert.equal(history[0].amount, 1800);
});

test('upsertTenantPaymentRecord updates month snapshot without mutating other months', () => {
    const initial = [
        {
            id: 1,
            tenantId: 1,
            month: '2026-03',
            amount: 1800,
            dueDate: '2026-03-10',
            paid: false,
            paidAt: '',
            incomeEntryId: null
        }
    ];

    const updated = upsertTenantPaymentRecord(initial, {
        id: 2,
        tenantId: 1,
        month: '2026-04',
        amount: 1950,
        dueDate: '2026-04-12',
        paid: false,
        paidAt: '',
        incomeEntryId: null
    });

    assert.equal(updated.length, 2);
    assert.deepEqual(getTenantRecordForMonth(updated, 1, '2026-03'), initial[0]);
    assert.equal(getTenantRecordForMonth(updated, 1, '2026-04').amount, 1950);
});

test('summarizeTenantMonthRows returns counts and amounts for dashboard', () => {
    const rows = buildTenantMonthRows({
        profiles: [
            { id: 1, isActive: true, name: 'Kowalski', amount: 1800, dueDay: 10 },
            { id: 2, isActive: true, name: 'Nowak', amount: 2200, dueDay: 12 },
            { id: 3, isActive: false, name: '', amount: 0, dueDay: 10 }
        ],
        history: [
            {
                id: 101,
                tenantId: 1,
                month: '2026-03',
                amount: 1800,
                dueDate: '2026-03-10',
                paid: true,
                paidAt: '2026-03-09',
                incomeEntryId: 900
            }
        ],
        monthValue: '2026-03',
        today: new Date('2026-03-15T12:00:00Z')
    });

    const summary = summarizeTenantMonthRows(rows);
    assert.equal(summary.active, 2);
    assert.equal(summary.paid, 1);
    assert.equal(summary.overdue, 1);
    assert.equal(summary.hidden, 5);
    assert.equal(summary.expectedAmount, 4000);
    assert.equal(summary.paidAmount, 1800);
    assert.equal(summary.pendingAmount, 2200);
    assert.equal(summary.overdueAmount, 2200);
});
