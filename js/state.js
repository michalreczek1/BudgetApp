import { formatDateString } from '../date-utils.js';
import { roundCurrency } from './formatters.js';

export const CLIENT_DEPRECATED_PIN_VALUE = '__deprecated__';

export function sanitizeState(rawState) {
    const version = Number(rawState && rawState.version);
    const balance = Number(rawState && rawState.balance);

    const sanitizeTotals = (rawTotals) => {
        if (!rawTotals || typeof rawTotals !== 'object' || Array.isArray(rawTotals)) {
            return {};
        }

        const cleaned = {};
        Object.entries(rawTotals).forEach(([category, value]) => {
            const parsed = Number(value);
            if (Number.isFinite(parsed)) {
                cleaned[String(category)] = Math.round(parsed * 100) / 100;
            }
        });
        return cleaned;
    };

    const sanitizeEntries = (rawEntries) => {
        if (!Array.isArray(rawEntries)) {
            return [];
        }

        return rawEntries
            .filter(entry => entry && typeof entry === 'object')
            .map(entry => {
                const parsedAmount = Number(entry.amount);
                const amount = Number.isFinite(parsedAmount) ? Math.round(parsedAmount * 100) / 100 : 0;
                return {
                    id: Number.isFinite(Number(entry.id)) ? Number(entry.id) : Date.now(),
                    amount: amount,
                    category: typeof entry.category === 'string' && entry.category.trim() ? entry.category.trim() : 'inne',
                    date: typeof entry.date === 'string' && entry.date ? entry.date : formatDateString(new Date()),
                    source: typeof entry.source === 'string' && entry.source ? entry.source : 'balance-update',
                    name: typeof entry.name === 'string' ? entry.name : '',
                    icon: typeof entry.icon === 'string' ? entry.icon : ''
                };
            });
    };

    return {
        pin: CLIENT_DEPRECATED_PIN_VALUE,
        version: Number.isFinite(version) && version > 0 ? Math.trunc(version) : 1,
        balance: Number.isFinite(balance) ? balance : 0,
        payments: Array.isArray(rawState?.payments) ? rawState.payments : [],
        incomes: Array.isArray(rawState?.incomes) ? rawState.incomes : [],
        expenseEntries: sanitizeEntries(rawState?.expenseEntries),
        incomeEntries: sanitizeEntries(rawState?.incomeEntries),
        expenseCategoryTotals: sanitizeTotals(rawState?.expenseCategoryTotals),
        incomeCategoryTotals: sanitizeTotals(rawState?.incomeCategoryTotals)
    };
}

export function isStateEffectivelyEmpty(state) {
    return (
        Number(state.version) === 1 &&
        Number(state.balance) === 0 &&
        Array.isArray(state.payments) &&
        state.payments.length === 0 &&
        Array.isArray(state.incomes) &&
        state.incomes.length === 0 &&
        Array.isArray(state.expenseEntries) &&
        state.expenseEntries.length === 0 &&
        Array.isArray(state.incomeEntries) &&
        state.incomeEntries.length === 0 &&
        Object.keys(state.expenseCategoryTotals || {}).length === 0 &&
        Object.keys(state.incomeCategoryTotals || {}).length === 0
    );
}

export function buildCategoryTotals(entries) {
    const totals = {};
    entries.forEach(entry => {
        const category = entry.category || 'inne';
        totals[category] = roundCurrency((totals[category] || 0) + (Number(entry.amount) || 0));
    });
    return totals;
}

