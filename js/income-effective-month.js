import { parseDateString, formatDateString } from '../date-utils.js';

const SALARY_KEYWORDS = ['pensja', 'wynagrodzenie'];
const LATE_MONTH_DAY_THRESHOLD = 28;
const EMPLOYER_INCOME_CATEGORY = 'wynagrodzenie';

function normalizeText(value) {
    return String(value || '').trim().toLowerCase();
}

function addMonths(dateValue, offset) {
    return new Date(dateValue.getFullYear(), dateValue.getMonth() + offset, 1);
}

function getRoundedAmount(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
        return 0;
    }
    return Math.round(Math.abs(numericValue) * 100) / 100;
}

function isEmployerIncomeCategory(category) {
    return normalizeText(category) === EMPLOYER_INCOME_CATEGORY;
}

function isSalaryLikeIncomeDefinition(entryLike) {
    if (isEmployerIncomeCategory(entryLike?.category)) {
        return true;
    }

    const normalizedName = normalizeText(entryLike?.name);
    return SALARY_KEYWORDS.some(keyword => normalizedName.includes(keyword));
}

function findClosestReceivedDate(entryDate, receivedDates) {
    const parsedEntryDate = parseDateString(entryDate);
    if (Number.isNaN(parsedEntryDate.getTime())) {
        return null;
    }

    let closest = null;
    let closestDistance = Number.POSITIVE_INFINITY;

    (Array.isArray(receivedDates) ? receivedDates : []).forEach(receivedDate => {
        const parsedReceivedDate = parseDateString(receivedDate);
        if (Number.isNaN(parsedReceivedDate.getTime())) {
            return;
        }

        const distance = Math.abs(parsedReceivedDate.getTime() - parsedEntryDate.getTime());
        if (distance < closestDistance) {
            closest = receivedDate;
            closestDistance = distance;
        }
    });

    return closest;
}

function findMatchingSalaryIncomePlan(entry, plannedIncomes = []) {
    if (normalizeText(entry?.source) !== 'planned-income') {
        return null;
    }

    const entryAmount = getRoundedAmount(entry?.amount);
    const candidates = (Array.isArray(plannedIncomes) ? plannedIncomes : [])
        .filter(income => (
            getRoundedAmount(income?.amount) === entryAmount &&
            isSalaryLikeIncomeDefinition(income)
        ))
        .map(income => ({
            income,
            matchedReceivedDate: findClosestReceivedDate(entry?.date, income?.receivedDates)
        }))
        .filter(candidate => candidate.matchedReceivedDate);

    if (candidates.length === 0) {
        return null;
    }

    candidates.sort((left, right) => {
        const leftDistance = Math.abs(parseDateString(left.matchedReceivedDate).getTime() - parseDateString(entry?.date).getTime());
        const rightDistance = Math.abs(parseDateString(right.matchedReceivedDate).getTime() - parseDateString(entry?.date).getTime());
        return leftDistance - rightDistance;
    });

    return candidates[0];
}

export function isSalaryLikeIncomeEntry(entry, plannedIncomes = []) {
    if (isSalaryLikeIncomeDefinition(entry)) {
        return true;
    }

    return Boolean(findMatchingSalaryIncomePlan(entry, plannedIncomes));
}

function getIncomeEffectiveDate(entry, plannedIncomes = []) {
    const matchedSalaryPlan = findMatchingSalaryIncomePlan(entry, plannedIncomes);
    return matchedSalaryPlan?.matchedReceivedDate || entry?.date;
}

export function getIncomeEffectiveMonthValue(entry, plannedIncomes = []) {
    const effectiveDateValue = getIncomeEffectiveDate(entry, plannedIncomes);
    const parsedDate = parseDateString(effectiveDateValue);
    if (Number.isNaN(parsedDate.getTime())) {
        return '';
    }

    const effectiveMonthDate = (
        isSalaryLikeIncomeEntry(entry, plannedIncomes) && parsedDate.getDate() >= LATE_MONTH_DAY_THRESHOLD
    )
        ? addMonths(parsedDate, 1)
        : new Date(parsedDate.getFullYear(), parsedDate.getMonth(), 1);

    return formatDateString(effectiveMonthDate).slice(0, 7);
}

export function isIncomeInEffectiveMonth(entry, monthValue, plannedIncomes = []) {
    return getIncomeEffectiveMonthValue(entry, plannedIncomes) === String(monthValue || '');
}
