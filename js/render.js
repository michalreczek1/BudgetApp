export function createRenderController({
    getCurrentViewDate,
    setCurrentViewDate,
    appStorage,
    storageKeys,
    normalizeDate,
    getPaymentOccurrenceForMonth,
    isOccurrencePaid,
    getIncomeOccurrenceForMonth,
    isIncomeOccurrenceReceived,
    getNextIncomeOccurrenceFromDate,
    parseDateString,
    formatDateToPolish,
    formatCurrencyPLN,
    formatExpenseAmountPLN,
    formatIncomeAmountPLN,
    normalizeUserText,
    openEditIncome,
    openEditPayment,
    markIncomeAsReceived,
    markPaymentAsPaid
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

    function loadIncomes() {
        const stored = appStorage.getItem(storageKeys.INCOMES);
        const incomes = stored ? JSON.parse(stored) : [];
        const currentViewDate = getCurrentViewDate();
        const today = normalizeDate(new Date());
        const viewMonth = normalizeDate(new Date(currentViewDate.getFullYear(), currentViewDate.getMonth(), 1));
        const visibleIncomes = [];
        let nextIncome = null;

        incomes.forEach(income => {
            const occurrenceForView = getIncomeOccurrenceForMonth(income, viewMonth);
            if (occurrenceForView && !isIncomeOccurrenceReceived(income, occurrenceForView)) {
                visibleIncomes.push({
                    ...income,
                    date: occurrenceForView,
                    isRecurring: income.frequency !== 'once'
                });
            }

            const nextOccurrence = getNextIncomeOccurrenceFromDate(income, today);
            if (!nextOccurrence) {
                return;
            }

            const nextOccurrenceDate = parseDateString(nextOccurrence);
            if (!nextIncome || nextOccurrenceDate < parseDateString(nextIncome.date)) {
                nextIncome = {
                    ...income,
                    date: nextOccurrence
                };
            }
        });

        visibleIncomes.sort((a, b) => parseDateString(a.date) - parseDateString(b.date));

        const listElement = document.getElementById('incomeList');

        if (visibleIncomes.length === 0) {
            listElement.innerHTML = `
                <div class="empty-state">
                    <div class="icon">💰</div>
                    <p>Brak zaplanowanych wpływów w tym miesiącu</p>
                </div>
            `;
        } else {
            listElement.textContent = '';
            visibleIncomes.forEach(income => {
                const row = document.createElement('div');
                row.className = 'payment-item editable';
                row.title = 'Kliknij, aby edytować serię';
                row.addEventListener('click', () => openEditIncome(income.id));

                const info = document.createElement('div');
                info.className = 'payment-info';

                const name = document.createElement('div');
                name.className = 'payment-name';
                name.textContent = normalizeUserText(income.name);
                info.appendChild(name);

                const meta = document.createElement('div');
                meta.className = 'payment-meta';

                const dateNode = document.createElement('div');
                dateNode.className = 'payment-date';
                dateNode.textContent = formatDateToPolish(income.date);
                meta.appendChild(dateNode);

                const freq = document.createElement('span');
                freq.className = income.frequency === 'monthly'
                    ? 'payment-frequency freq-monthly'
                    : 'payment-frequency freq-income';
                freq.textContent = income.frequency === 'monthly' ? 'Co miesiąc' : 'Jednorazowy';
                meta.appendChild(freq);

                info.appendChild(meta);
                row.appendChild(info);

                const amount = document.createElement('div');
                amount.className = 'payment-amount income';
                amount.textContent = formatIncomeAmountPLN(income.amount || 0);
                row.appendChild(amount);

                if (parseDateString(income.date) <= today) {
                    const paidBtn = document.createElement('button');
                    paidBtn.className = 'paid-btn';
                    paidBtn.type = 'button';
                    paidBtn.textContent = 'Zaksięgowano';
                    paidBtn.addEventListener('click', event => {
                        event.stopPropagation();
                        markIncomeAsReceived(income.id, income.date);
                    });
                    row.appendChild(paidBtn);
                }

                listElement.appendChild(row);
            });
        }

        if (nextIncome) {
            const nextDate = parseDateString(nextIncome.date);
            const diffTime = nextDate - today;
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            document.getElementById('daysToIncome').textContent = diffDays >= 0 ? `${diffDays} dni` : '0 dni';
            document.getElementById('nextIncomeDate').textContent = `Wpływ: ${formatDateToPolish(nextIncome.date)}`;
        } else {
            document.getElementById('daysToIncome').textContent = '-- dni';
            document.getElementById('nextIncomeDate').textContent = 'Brak zaplanowanych wpływów';
        }
    }

    function loadPayments() {
        const stored = appStorage.getItem(storageKeys.PAYMENTS);
        const payments = stored ? JSON.parse(stored) : [];
        const currentViewDate = getCurrentViewDate();
        const today = normalizeDate(new Date());
        const viewMonth = normalizeDate(new Date(currentViewDate.getFullYear(), currentViewDate.getMonth(), 1));
        const visiblePayments = [];

        payments.forEach(payment => {
            const occurrenceForView = getPaymentOccurrenceForMonth(payment, viewMonth);
            if (!occurrenceForView || isOccurrencePaid(payment, occurrenceForView)) {
                return;
            }

            visiblePayments.push({
                ...payment,
                date: occurrenceForView,
                isRecurring: payment.frequency !== 'once'
            });
        });

        visiblePayments.sort((a, b) => parseDateString(a.date) - parseDateString(b.date));

        const listElement = document.getElementById('paymentsList');

        if (visiblePayments.length === 0) {
            listElement.innerHTML = `
                <div class="empty-state">
                    <div class="icon">📭</div>
                    <p>Brak zaplanowanych płatności w tym miesiącu</p>
                </div>
            `;
            return;
        }

        listElement.textContent = '';
        visiblePayments.forEach(payment => {
            const row = document.createElement('div');
            row.className = 'payment-item editable';
            row.title = 'Kliknij, aby edytować serię';
            row.addEventListener('click', () => openEditPayment(payment.id));

            const info = document.createElement('div');
            info.className = 'payment-info';

            const name = document.createElement('div');
            name.className = 'payment-name';
            name.textContent = normalizeUserText(payment.name);
            info.appendChild(name);

            const meta = document.createElement('div');
            meta.className = 'payment-meta';

            const dateNode = document.createElement('div');
            dateNode.className = 'payment-date';
            dateNode.textContent = formatDateToPolish(payment.date);
            meta.appendChild(dateNode);

            if (payment.frequency === 'monthly' || payment.frequency === 'selected') {
                const freq = document.createElement('span');
                freq.className = payment.frequency === 'monthly'
                    ? 'payment-frequency freq-monthly'
                    : 'payment-frequency freq-selected';
                freq.textContent = payment.frequency === 'monthly' ? 'Co miesiąc' : 'Wybrane miesiące';
                meta.appendChild(freq);
            }

            info.appendChild(meta);
            row.appendChild(info);

            const amount = document.createElement('div');
            amount.className = 'payment-amount expense';
            amount.textContent = formatExpenseAmountPLN(payment.amount || 0);
            row.appendChild(amount);

            if (parseDateString(payment.date) <= today) {
                const paidBtn = document.createElement('button');
                paidBtn.className = 'paid-btn';
                paidBtn.type = 'button';
                paidBtn.textContent = 'Opłacone';
                paidBtn.addEventListener('click', event => {
                    event.stopPropagation();
                    markPaymentAsPaid(payment.id, payment.date);
                });
                row.appendChild(paidBtn);
            }

            listElement.appendChild(row);
        });
    }

    return {
        updateViewMonthLabel,
        changeViewMonth,
        goToCurrentMonth,
        loadBalance,
        updateCalculations,
        loadIncomes,
        loadPayments
    };
}
