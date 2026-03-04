import { parseDateString, formatDateString } from '../date-utils.js';
import { roundCurrency } from './formatters.js';
import {
    normalizeDate,
    getIncomeOccurrenceForMonth,
    getPaymentOccurrenceForMonth
} from './scheduling.js';

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
    const previousMonthDate = new Date(normalizedToday.getFullYear(), normalizedToday.getMonth() - 1, 1);
    const previousMonthStart = getMonthStart(previousMonthDate);
    const previousMonthEnd = getMonthEnd(previousMonthDate);

    const realizedIncomeToDate = sumEntriesInRange(incomeEntries, currentMonthStart, normalizedToday);
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

    const previousMonthRealizedIncome = sumEntriesInRange(incomeEntries, previousMonthStart, previousMonthEnd);
    const previousMonthRealizedExpense = sumEntriesInRange(expenseEntries, previousMonthStart, previousMonthEnd);

    return {
        currentMonth: {
            plannedIncomeToDate,
            realizedIncomeToDate,
            plannedExpenseToDate,
            realizedExpenseToDate,
            balanceToDate: roundCurrency(realizedIncomeToDate - realizedExpenseToDate),
            monthLabel: getMonthLabel(currentMonthStart),
            rangeLabel: `Do ${formatDateString(normalizedToday)}`
        },
        previousMonth: {
            realizedIncome: previousMonthRealizedIncome,
            realizedExpense: previousMonthRealizedExpense,
            balance: roundCurrency(previousMonthRealizedIncome - previousMonthRealizedExpense),
            monthLabel: getMonthLabel(previousMonthStart)
        }
    };
}
