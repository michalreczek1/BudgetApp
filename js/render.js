export function createRenderController({
    getCurrentViewDate,
    setCurrentViewDate,
    loadPayments,
    loadIncomes,
    appStorage,
    storageKeys,
    normalizeDate,
    getPaymentOccurrenceForMonth,
    isOccurrencePaid,
    formatCurrencyPLN
}) {
    function updateViewMonthLabel() {
        const currentViewDate = getCurrentViewDate();
        const labelElement = document.getElementById('currentViewMonth');
        const labelButton = document.getElementById('monthLabelBtn');
        if (!labelElement || !labelButton) {
            return;
        }

        const formatted = currentViewDate.toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' });
        labelElement.textContent = formatted.charAt(0).toUpperCase() + formatted.slice(1);

        const today = new Date();
        const isCurrentMonth = (
            currentViewDate.getMonth() === today.getMonth() &&
            currentViewDate.getFullYear() === today.getFullYear()
        );
        labelButton.classList.toggle('current-month', isCurrentMonth);
    }

    function changeViewMonth(offset) {
        const currentViewDate = getCurrentViewDate();
        setCurrentViewDate(new Date(currentViewDate.getFullYear(), currentViewDate.getMonth() + offset, 1));
        updateViewMonthLabel();
        loadPayments();
        loadIncomes();
    }

    function goToCurrentMonth() {
        const today = new Date();
        setCurrentViewDate(new Date(today.getFullYear(), today.getMonth(), 1));
        updateViewMonthLabel();
        loadPayments();
        loadIncomes();
    }

    function loadBalance() {
        const balance = parseFloat(appStorage.getItem(storageKeys.BALANCE)) || 0;
        document.getElementById('currentBalance').textContent = formatCurrencyPLN(balance);
    }

    function updateCalculations() {
        const balance = parseFloat(appStorage.getItem(storageKeys.BALANCE)) || 0;

        let totalPayments = 0;
        const paymentsStored = appStorage.getItem(storageKeys.PAYMENTS);
        if (paymentsStored) {
            const payments = JSON.parse(paymentsStored);
            const today = normalizeDate(new Date());

            payments.forEach(payment => {
                const occurrenceInCurrentMonth = getPaymentOccurrenceForMonth(payment, today);
                if (!occurrenceInCurrentMonth || isOccurrencePaid(payment, occurrenceInCurrentMonth)) {
                    return;
                }

                totalPayments += payment.amount;
            });
        }

        const afterPayments = balance - totalPayments;
        const afterPaymentsElement = document.getElementById('afterPayments');
        afterPaymentsElement.textContent = formatCurrencyPLN(afterPayments);

        if (afterPayments > 0) {
            afterPaymentsElement.classList.add('positive');
            afterPaymentsElement.classList.remove('negative');
        } else if (afterPayments < 0) {
            afterPaymentsElement.classList.add('negative');
            afterPaymentsElement.classList.remove('positive');
        }
    }

    return {
        updateViewMonthLabel,
        changeViewMonth,
        goToCurrentMonth,
        loadBalance,
        updateCalculations
    };
}
