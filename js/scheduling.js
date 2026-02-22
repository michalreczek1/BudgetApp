import { parseDateString, formatDateString } from '../date-utils.js';

function isSameMonthAndYear(dateToCheck, referenceDate) {
    return (
        dateToCheck.getMonth() === referenceDate.getMonth() &&
        dateToCheck.getFullYear() === referenceDate.getFullYear()
    );
}

function getMonthOccurrenceDate(baseDate, year, monthIndex) {
    const lastDayOfMonth = new Date(year, monthIndex + 1, 0).getDate();
    const day = Math.min(baseDate.getDate(), lastDayOfMonth);
    return normalizeDate(new Date(year, monthIndex, day));
}

export function normalizeDate(date) {
    const result = new Date(date);
    result.setHours(0, 0, 0, 0);
    return result;
}

export function isSameCalendarDate(firstDate, secondDate) {
    return formatDateString(firstDate) === formatDateString(secondDate);
}

export function isOccurrencePaid(payment, occurrenceDateString) {
    return Array.isArray(payment.paidDates) && payment.paidDates.includes(occurrenceDateString);
}

export function addPaidOccurrence(payment, occurrenceDateString) {
    if (!Array.isArray(payment.paidDates)) {
        payment.paidDates = [];
    }

    if (!payment.paidDates.includes(occurrenceDateString)) {
        payment.paidDates.push(occurrenceDateString);
        payment.paidDates.sort();
    }
}

export function isIncomeOccurrenceReceived(income, occurrenceDateString) {
    return Array.isArray(income.receivedDates) && income.receivedDates.includes(occurrenceDateString);
}

export function addReceivedOccurrence(income, occurrenceDateString) {
    if (!Array.isArray(income.receivedDates)) {
        income.receivedDates = [];
    }

    if (!income.receivedDates.includes(occurrenceDateString)) {
        income.receivedDates.push(occurrenceDateString);
        income.receivedDates.sort();
    }
}

export function getIncomeOccurrenceForMonth(income, monthDate) {
    const baseDate = parseDateString(income.date);
    const monthStart = normalizeDate(new Date(monthDate.getFullYear(), monthDate.getMonth(), 1));

    if (income.frequency === 'once') {
        return isSameMonthAndYear(baseDate, monthStart) ? formatDateString(baseDate) : null;
    }

    if (income.frequency === 'monthly') {
        const occurrenceDate = getMonthOccurrenceDate(baseDate, monthStart.getFullYear(), monthStart.getMonth());
        return occurrenceDate >= baseDate ? formatDateString(occurrenceDate) : null;
    }

    return null;
}

export function getPaymentOccurrenceForMonth(payment, monthDate) {
    const baseDate = parseDateString(payment.date);
    const monthStart = normalizeDate(new Date(monthDate.getFullYear(), monthDate.getMonth(), 1));

    if (payment.frequency === 'once') {
        return isSameMonthAndYear(baseDate, monthStart) ? formatDateString(baseDate) : null;
    }

    if (payment.frequency === 'monthly') {
        const occurrenceDate = getMonthOccurrenceDate(baseDate, monthStart.getFullYear(), monthStart.getMonth());
        return occurrenceDate >= baseDate ? formatDateString(occurrenceDate) : null;
    }

    if (payment.frequency === 'selected') {
        const selectedMonth = monthStart.getMonth() + 1;
        if (!Array.isArray(payment.months) || !payment.months.includes(selectedMonth)) {
            return null;
        }

        const occurrenceDate = getMonthOccurrenceDate(baseDate, monthStart.getFullYear(), monthStart.getMonth());
        return occurrenceDate >= baseDate ? formatDateString(occurrenceDate) : null;
    }

    return null;
}

export function getNextIncomeOccurrenceFromDate(income, fromDate) {
    const startDate = normalizeDate(fromDate);
    const baseDate = parseDateString(income.date);

    if (income.frequency === 'once') {
        const onceDate = formatDateString(baseDate);
        if (isIncomeOccurrenceReceived(income, onceDate)) {
            return null;
        }
        return baseDate >= startDate ? onceDate : null;
    }

    if (income.frequency === 'monthly') {
        for (let i = 0; i < 36; i += 1) {
            const probeMonth = new Date(startDate.getFullYear(), startDate.getMonth() + i, 1);
            const occurrenceDateString = getIncomeOccurrenceForMonth(income, probeMonth);
            if (!occurrenceDateString) {
                continue;
            }

            if (isIncomeOccurrenceReceived(income, occurrenceDateString)) {
                continue;
            }

            const occurrenceDate = parseDateString(occurrenceDateString);
            if (occurrenceDate >= startDate) {
                return occurrenceDateString;
            }
        }
    }

    return null;
}

export function settlePaymentOccurrence(payment, occurrenceDateString) {
    const amount = parseFloat(payment.amount) || 0;
    if (isOccurrencePaid(payment, occurrenceDateString)) {
        return 0;
    }

    if (payment.frequency === 'once') {
        payment._delete = true;
        return amount;
    }

    addPaidOccurrence(payment, occurrenceDateString);
    return amount;
}

export function settleIncomeOccurrence(income, occurrenceDateString) {
    const amount = parseFloat(income.amount) || 0;
    if (isIncomeOccurrenceReceived(income, occurrenceDateString)) {
        return 0;
    }

    if (income.frequency === 'once') {
        income._delete = true;
        return amount;
    }

    addReceivedOccurrence(income, occurrenceDateString);
    return amount;
}

export function isPaymentDueOnDate(payment, targetDate) {
    const normalizedDate = normalizeDate(targetDate);
    const targetDateString = formatDateString(normalizedDate);

    if (payment.frequency === 'once') {
        return formatDateString(parseDateString(payment.date)) === targetDateString;
    }

    const occurrenceForMonth = getPaymentOccurrenceForMonth(payment, normalizedDate);
    return occurrenceForMonth === targetDateString;
}

export function isIncomeDueOnDate(income, targetDate) {
    const normalizedDate = normalizeDate(targetDate);
    const targetDateString = formatDateString(normalizedDate);

    if (income.frequency === 'once') {
        return formatDateString(parseDateString(income.date)) === targetDateString;
    }

    const occurrenceForMonth = getIncomeOccurrenceForMonth(income, normalizedDate);
    return occurrenceForMonth === targetDateString;
}

export function getDuePaymentOccurrencesUpToDate(payment, todayDate, includeTodayOccurrence) {
    const dueOccurrences = [];
    const todayString = formatDateString(todayDate);
    const baseDate = parseDateString(payment.date);
    if (Number.isNaN(baseDate.getTime())) {
        return dueOccurrences;
    }

    if (payment.frequency === 'once') {
        const occurrence = formatDateString(baseDate);
        const isDue = occurrence < todayString || (includeTodayOccurrence && occurrence === todayString);
        if (isDue && !isOccurrencePaid(payment, occurrence)) {
            dueOccurrences.push(occurrence);
        }
        return dueOccurrences;
    }

    const baseMonth = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
    const targetMonth = new Date(todayDate.getFullYear(), todayDate.getMonth(), 1);

    for (
        let probeMonth = new Date(baseMonth);
        probeMonth <= targetMonth;
        probeMonth = new Date(probeMonth.getFullYear(), probeMonth.getMonth() + 1, 1)
    ) {
        const occurrence = getPaymentOccurrenceForMonth(payment, probeMonth);
        if (!occurrence || isOccurrencePaid(payment, occurrence)) {
            continue;
        }

        const isDue = occurrence < todayString || (includeTodayOccurrence && occurrence === todayString);
        if (isDue) {
            dueOccurrences.push(occurrence);
        }
    }

    return dueOccurrences;
}

export function getDueIncomeOccurrencesUpToDate(income, todayDate, includeTodayOccurrence) {
    const dueOccurrences = [];
    const todayString = formatDateString(todayDate);
    const baseDate = parseDateString(income.date);
    if (Number.isNaN(baseDate.getTime())) {
        return dueOccurrences;
    }

    if (income.frequency === 'once') {
        const occurrence = formatDateString(baseDate);
        const isDue = occurrence < todayString || (includeTodayOccurrence && occurrence === todayString);
        if (isDue && !isIncomeOccurrenceReceived(income, occurrence)) {
            dueOccurrences.push(occurrence);
        }
        return dueOccurrences;
    }

    const baseMonth = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
    const targetMonth = new Date(todayDate.getFullYear(), todayDate.getMonth(), 1);

    for (
        let probeMonth = new Date(baseMonth);
        probeMonth <= targetMonth;
        probeMonth = new Date(probeMonth.getFullYear(), probeMonth.getMonth() + 1, 1)
    ) {
        const occurrence = getIncomeOccurrenceForMonth(income, probeMonth);
        if (!occurrence || isIncomeOccurrenceReceived(income, occurrence)) {
            continue;
        }

        const isDue = occurrence < todayString || (includeTodayOccurrence && occurrence === todayString);
        if (isDue) {
            dueOccurrences.push(occurrence);
        }
    }

    return dueOccurrences;
}
