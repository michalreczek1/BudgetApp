import { parseDateString, formatDateString } from '../date-utils.js';
import { roundCurrency } from './formatters.js';
import {
    normalizeDate,
    getPaymentOccurrenceForMonth,
    getNextIncomeOccurrenceFromDate,
    isOccurrencePaid
} from './scheduling.js';

function getEndOfMonth(dateValue) {
    return normalizeDate(new Date(dateValue.getFullYear(), dateValue.getMonth() + 1, 0));
}

function getMonthStart(dateValue) {
    return new Date(dateValue.getFullYear(), dateValue.getMonth(), 1);
}

function buildReservedOccurrence(payment, occurrenceDate, todayDate) {
    const amount = roundCurrency(Number(payment.amount) || 0);
    if (amount <= 0) {
        return null;
    }

    return {
        paymentId: Number(payment.id) || 0,
        name: String(payment.name || '').trim(),
        amount,
        occurrenceDate,
        isOverdue: parseDateString(occurrenceDate) < todayDate
    };
}

function getReservedOccurrencesForPayment(payment, todayDate, horizonDate) {
    const occurrences = [];
    const baseDate = parseDateString(payment?.date);
    if (Number.isNaN(baseDate.getTime())) {
        return occurrences;
    }

    const frequency = String(payment?.frequency || 'once').trim().toLowerCase();

    if (frequency === 'once') {
        const occurrenceDate = formatDateString(baseDate);
        const parsedOccurrence = parseDateString(occurrenceDate);
        if (parsedOccurrence <= horizonDate && !isOccurrencePaid(payment, occurrenceDate)) {
            const occurrence = buildReservedOccurrence(payment, occurrenceDate, todayDate);
            if (occurrence) {
                occurrences.push(occurrence);
            }
        }
        return occurrences;
    }

    const baseMonth = getMonthStart(baseDate);
    const lastMonth = getMonthStart(horizonDate);
    for (
        let probeMonth = new Date(baseMonth);
        probeMonth <= lastMonth;
        probeMonth = new Date(probeMonth.getFullYear(), probeMonth.getMonth() + 1, 1)
    ) {
        const occurrenceDate = getPaymentOccurrenceForMonth(payment, probeMonth);
        if (!occurrenceDate || isOccurrencePaid(payment, occurrenceDate)) {
            continue;
        }

        const parsedOccurrence = parseDateString(occurrenceDate);
        if (parsedOccurrence > horizonDate) {
            continue;
        }

        const occurrence = buildReservedOccurrence(payment, occurrenceDate, todayDate);
        if (occurrence) {
            occurrences.push(occurrence);
        }
    }

    return occurrences;
}

export function calculateAvailableCashForecast({
    balance,
    payments,
    incomes,
    today
}) {
    const normalizedToday = normalizeDate(today || new Date());
    const normalizedBalance = roundCurrency(Number(balance) || 0);
    const safePayments = Array.isArray(payments) ? payments : [];
    const safeIncomes = Array.isArray(incomes) ? incomes : [];

    let nextIncomeDate = null;
    safeIncomes.forEach(income => {
        const occurrenceDate = getNextIncomeOccurrenceFromDate(income, normalizedToday);
        if (!occurrenceDate) {
            return;
        }

        if (!nextIncomeDate || parseDateString(occurrenceDate) < parseDateString(nextIncomeDate)) {
            nextIncomeDate = occurrenceDate;
        }
    });

    const horizonType = nextIncomeDate ? 'next-income' : 'end-of-month';
    const horizonDate = nextIncomeDate || formatDateString(getEndOfMonth(normalizedToday));
    const parsedHorizonDate = parseDateString(horizonDate);

    const reservedOccurrences = safePayments
        .flatMap(payment => getReservedOccurrencesForPayment(payment, normalizedToday, parsedHorizonDate))
        .sort((left, right) => parseDateString(left.occurrenceDate) - parseDateString(right.occurrenceDate));

    const reserveAmount = roundCurrency(
        reservedOccurrences.reduce((sum, occurrence) => sum + (Number(occurrence.amount) || 0), 0)
    );

    return {
        availableCash: roundCurrency(normalizedBalance - reserveAmount),
        reserveAmount,
        horizonType,
        horizonDate,
        nextIncomeDate,
        reservedOccurrences
    };
}
