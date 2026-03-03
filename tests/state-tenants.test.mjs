import test from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeState, isStateEffectivelyEmpty } from '../js/state.js';

test('sanitizeState initializes tenant structures', () => {
    const state = sanitizeState({});

    assert.equal(state.tenantProfiles.length, 7);
    assert.equal(state.tenantPaymentHistory.length, 0);
});

test('sanitizeState preserves tenant data and isStateEffectivelyEmpty reacts to it', () => {
    const state = sanitizeState({
        balance: 1200,
        tenantProfiles: [
            {
                id: 1,
                isActive: true,
                name: 'Kowalski',
                amount: 1800,
                dueDay: 10
            }
        ],
        tenantPaymentHistory: [
            {
                id: 100,
                tenantId: 1,
                month: '2026-03',
                amount: 1800,
                dueDate: '2026-03-10',
                paid: true,
                paidAt: '2026-03-09',
                incomeEntryId: 999
            }
        ]
    });

    assert.equal(state.tenantProfiles[0].name, 'Kowalski');
    assert.equal(state.tenantPaymentHistory[0].month, '2026-03');
    assert.equal(isStateEffectivelyEmpty(state), false);
});
