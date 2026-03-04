import { parseDateString, formatDateString } from '../date-utils.js';

const SALARY_KEYWORDS = ['pensja', 'wynagrodzenie'];
const LATE_MONTH_DAY_THRESHOLD = 28;

function normalizeText(value) {
    return String(value || '').trim().toLowerCase();
}

function addMonths(dateValue, offset) {
    return new Date(dateValue.getFullYear(), dateValue.getMonth() + offset, 1);
}

export function isSalaryLikeIncomeEntry(entry) {
    const normalizedName = normalizeText(entry?.name);
    return SALARY_KEYWORDS.some(keyword => normalizedName.includes(keyword));
}

export function getIncomeEffectiveMonthValue(entry) {
    const parsedDate = parseDateString(entry?.date);
    if (Number.isNaN(parsedDate.getTime())) {
        return '';
    }

    const effectiveMonthDate = (
        isSalaryLikeIncomeEntry(entry) && parsedDate.getDate() >= LATE_MONTH_DAY_THRESHOLD
    )
        ? addMonths(parsedDate, 1)
        : new Date(parsedDate.getFullYear(), parsedDate.getMonth(), 1);

    return formatDateString(effectiveMonthDate).slice(0, 7);
}

export function isIncomeInEffectiveMonth(entry, monthValue) {
    return getIncomeEffectiveMonthValue(entry) === String(monthValue || '');
}
