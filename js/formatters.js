const PLN_CURRENCY_FORMATTER = new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency: 'PLN',
    useGrouping: 'always',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
});

export function roundCurrency(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
}

export function formatCurrencyPLN(value) {
    return PLN_CURRENCY_FORMATTER.format(roundCurrency(value));
}

export function formatExpenseAmountPLN(value) {
    return `-${formatCurrencyPLN(Math.abs(Number(value) || 0))}`;
}

export function formatIncomeAmountPLN(value) {
    return `+${formatCurrencyPLN(Math.abs(Number(value) || 0))}`;
}
