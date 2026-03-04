import { parseDateString, formatDateString } from '../date-utils.js';
import { roundCurrency } from './formatters.js';
import { isIncomeInEffectiveMonth, isSalaryLikeIncomeEntry } from './income-effective-month.js';
import {
    normalizeDate,
    getIncomeOccurrenceForMonth,
    getPaymentOccurrenceForMonth,
    isIncomeOccurrenceReceived,
    isOccurrencePaid
} from './scheduling.js';

const LEGACY_SUMMARY_CATEGORIES = new Set([
    'zaplanowane płatności',
    'zaplanowane wpływy'
]);

function getMonthStart(dateValue) {
    return normalizeDate(new Date(dateValue.getFullYear(), dateValue.getMonth(), 1));
}

function getMonthEnd(dateValue) {
    return normalizeDate(new Date(dateValue.getFullYear(), dateValue.getMonth() + 1, 0));
}

function isDateInRange(dateString, startDate, endDate) {
    const parsedDate = parseDateString(dateString);
    if (Number.isNaN(parsedDate.getTime())) {
        return false;
    }
    return parsedDate >= startDate && parsedDate <= endDate;
}

function sumEntriesInRange(entries, startDate, endDate) {
    const safeEntries = Array.isArray(entries) ? entries : [];
    return roundCurrency(safeEntries.reduce((sum, entry) => {
        if (!isDateInRange(entry?.date, startDate, endDate)) {
            return sum;
        }
        const normalizedCategory = String(entry?.category || '').trim().toLowerCase();
        if (LEGACY_SUMMARY_CATEGORIES.has(normalizedCategory)) {
            return sum;
        }
        return sum + (Number(entry?.amount) || 0);
    }, 0));
}

function sumRealizedIncomeForEffectiveMonth(entries, targetMonthValue, todayDate = null, plannedIncomes = []) {
    const safeEntries = Array.isArray(entries) ? entries : [];
    return roundCurrency(safeEntries.reduce((sum, entry) => {
        if (!isIncomeInEffectiveMonth(entry, targetMonthValue, plannedIncomes)) {
            return sum;
        }

        const parsedDate = parseDateString(entry?.date);
        if (Number.isNaN(parsedDate.getTime())) {
            return sum;
        }
        if (todayDate && parsedDate > todayDate) {
            return sum;
        }

        const normalizedCategory = String(entry?.category || '').trim().toLowerCase();
        if (LEGACY_SUMMARY_CATEGORIES.has(normalizedCategory) && !isSalaryLikeIncomeEntry(entry, plannedIncomes)) {
            return sum;
        }

        return sum + (Number(entry?.amount) || 0);
    }, 0));
}

function sumPlannedOccurrencesInRange(items, monthStart, rangeEnd, getOccurrenceForMonth) {
    const safeItems = Array.isArray(items) ? items : [];
    return roundCurrency(safeItems.reduce((sum, item) => {
        const occurrenceDate = getOccurrenceForMonth(item, monthStart);
        if (!occurrenceDate) {
            return sum;
        }

        const parsedOccurrence = parseDateString(occurrenceDate);
        if (Number.isNaN(parsedOccurrence.getTime()) || parsedOccurrence < monthStart || parsedOccurrence > rangeEnd) {
            return sum;
        }

        return sum + (Number(item?.amount) || 0);
    }, 0));
}

function sumPlannedOutstandingForMonth(items, monthStart, monthEnd, getOccurrenceForMonth, isSettledOccurrence) {
    const safeItems = Array.isArray(items) ? items : [];
    return roundCurrency(safeItems.reduce((sum, item) => {
        const occurrenceDate = getOccurrenceForMonth(item, monthStart);
        if (!occurrenceDate) {
            return sum;
        }

        const parsedOccurrence = parseDateString(occurrenceDate);
        if (Number.isNaN(parsedOccurrence.getTime()) || parsedOccurrence < monthStart || parsedOccurrence > monthEnd) {
            return sum;
        }

        if (isSettledOccurrence(item, occurrenceDate)) {
            return sum;
        }

        return sum + (Number(item?.amount) || 0);
    }, 0));
}

function getMonthLabel(dateValue) {
    const formatted = dateValue.toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' });
    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

export function calculateDashboardMonthSummary({
    today,
    payments,
    incomes,
    expenseEntries,
    incomeEntries
}) {
    const normalizedToday = normalizeDate(today || new Date());
    const currentMonthStart = getMonthStart(normalizedToday);
    const currentMonthEnd = getMonthEnd(normalizedToday);
    const currentMonthValue = formatDateString(currentMonthStart).slice(0, 7);
    const previousMonthDate = new Date(normalizedToday.getFullYear(), normalizedToday.getMonth() - 1, 1);
    const previousMonthStart = getMonthStart(previousMonthDate);
    const previousMonthEnd = getMonthEnd(previousMonthDate);
    const previousMonthValue = formatDateString(previousMonthStart).slice(0, 7);

    const realizedIncomeToDate = sumRealizedIncomeForEffectiveMonth(incomeEntries, currentMonthValue, normalizedToday, incomes);
    const realizedExpenseToDate = sumEntriesInRange(expenseEntries, currentMonthStart, normalizedToday);
    const plannedIncomeToDate = sumPlannedOccurrencesInRange(
        incomes,
        currentMonthStart,
        normalizedToday,
        getIncomeOccurrenceForMonth
    );
    const plannedExpenseToDate = sumPlannedOccurrencesInRange(
        payments,
        currentMonthStart,
        normalizedToday,
        getPaymentOccurrenceForMonth
    );
    const plannedIncomeOutstanding = sumPlannedOutstandingForMonth(
        incomes,
        currentMonthStart,
        currentMonthEnd,
        getIncomeOccurrenceForMonth,
        isIncomeOccurrenceReceived
    );
    const plannedExpenseOutstanding = sumPlannedOutstandingForMonth(
        payments,
        currentMonthStart,
        currentMonthEnd,
        getPaymentOccurrenceForMonth,
        isOccurrencePaid
    );
    const projectedIncome = roundCurrency(realizedIncomeToDate + plannedIncomeOutstanding);
    const projectedExpense = roundCurrency(realizedExpenseToDate + plannedExpenseOutstanding);

    const previousMonthRealizedIncome = sumRealizedIncomeForEffectiveMonth(incomeEntries, previousMonthValue, null, incomes);
    const previousMonthRealizedExpense = sumEntriesInRange(expenseEntries, previousMonthStart, previousMonthEnd);

    return {
        currentMonth: {
            plannedIncomeToDate,
            realizedIncomeToDate,
            plannedExpenseToDate,
            realizedExpenseToDate,
            plannedIncomeOutstanding,
            plannedExpenseOutstanding,
            projectedIncome,
            projectedExpense,
            projectedBalance: roundCurrency(projectedIncome - projectedExpense),
            balanceToDate: roundCurrency(realizedIncomeToDate - realizedExpenseToDate),
            monthValue: currentMonthValue,
            monthLabel: getMonthLabel(currentMonthStart),
            rangeLabel: `Do ${formatDateString(normalizedToday)}`
        },
        previousMonth: {
            realizedIncome: previousMonthRealizedIncome,
            realizedExpense: previousMonthRealizedExpense,
            balance: roundCurrency(previousMonthRealizedIncome - previousMonthRealizedExpense),
            monthValue: previousMonthValue,
            monthLabel: getMonthLabel(previousMonthStart)
        }
    };
}
