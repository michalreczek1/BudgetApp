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
    calculateAvailableCashForecast,
    calculateDashboardMonthSummary,
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
    let isMonthToDateExpanded = false;
    let isPreviousMonthExpanded = false;
    let latestMonthlyOverview = null;

    function parseStoredArray(key) {
        const stored = appStorage.getItem(key);
        return stored ? JSON.parse(stored) : [];
    }

    function applySignedState(element, value) {
        if (!element) {
            return;
        }

        element.classList.remove('positive', 'negative');
        if (value > 0) {
            element.classList.add('positive');
        } else if (value < 0) {
            element.classList.add('negative');
        }
    }

    function renderMonthlyOverviewCards(monthlyOverview) {
        latestMonthlyOverview = monthlyOverview;

        const monthToDateCard = document.getElementById('monthToDateCard');
        const previousMonthCard = document.getElementById('previousMonthCard');
        const monthToDateToggle = document.getElementById('monthToDateToggle');
        const previousMonthToggle = document.getElementById('previousMonthToggle');
        const monthToDateDetails = document.getElementById('monthToDateDetails');
        const previousMonthDetails = document.getElementById('previousMonthDetails');
        const monthToDateChevron = document.getElementById('monthToDateChevron');
        const previousMonthChevron = document.getElementById('previousMonthChevron');

        if (
            !monthToDateCard ||
            !previousMonthCard ||
            !monthToDateToggle ||
            !previousMonthToggle ||
            !monthToDateDetails ||
            !previousMonthDetails
        ) {
            return;
        }

        const { currentMonth, previousMonth } = monthlyOverview;
        monthToDateCard.dataset.monthValue = currentMonth.monthValue;
        previousMonthCard.dataset.monthValue = previousMonth.monthValue;

        document.getElementById('monthToDateSubtext').textContent = 'Bieżący miesiąc: realizacja + plan';
        document.getElementById('monthToDateCollapsedIncome').textContent = formatCurrencyPLN(currentMonth.projectedIncome);
        document.getElementById('monthToDateCollapsedExpense').textContent = formatCurrencyPLN(currentMonth.projectedExpense);
        const monthToDateCollapsedBalance = document.getElementById('monthToDateCollapsedBalance');
        monthToDateCollapsedBalance.textContent = formatCurrencyPLN(currentMonth.projectedBalance);
        applySignedState(monthToDateCollapsedBalance, currentMonth.projectedBalance);

        document.getElementById('monthToDateDetailRealizedIncome').textContent = formatCurrencyPLN(currentMonth.realizedIncomeToDate);
        document.getElementById('monthToDateDetailPlannedIncome').textContent = formatCurrencyPLN(currentMonth.plannedIncomeOutstanding);
        document.getElementById('monthToDateDetailRealizedExpense').textContent = formatCurrencyPLN(currentMonth.realizedExpenseToDate);
        document.getElementById('monthToDateDetailPlannedExpense').textContent = formatCurrencyPLN(currentMonth.plannedExpenseOutstanding);
        const monthToDateDetailBalance = document.getElementById('monthToDateDetailBalance');
        monthToDateDetailBalance.textContent = formatCurrencyPLN(currentMonth.projectedBalance);
        applySignedState(monthToDateDetailBalance, currentMonth.projectedBalance);

        document.getElementById('previousMonthSubtext').textContent = previousMonth.monthLabel;
        document.getElementById('previousMonthCollapsedIncome').textContent = formatCurrencyPLN(previousMonth.realizedIncome);
        document.getElementById('previousMonthCollapsedExpense').textContent = formatCurrencyPLN(previousMonth.realizedExpense);
        const previousMonthCollapsedBalance = document.getElementById('previousMonthCollapsedBalance');
        previousMonthCollapsedBalance.textContent = formatCurrencyPLN(previousMonth.balance);
        applySignedState(previousMonthCollapsedBalance, previousMonth.balance);

        document.getElementById('previousMonthDetailIncome').textContent = formatCurrencyPLN(previousMonth.realizedIncome);
        document.getElementById('previousMonthDetailExpense').textContent = formatCurrencyPLN(previousMonth.realizedExpense);
        const previousMonthDetailBalance = document.getElementById('previousMonthDetailBalance');
        previousMonthDetailBalance.textContent = formatCurrencyPLN(previousMonth.balance);
        applySignedState(previousMonthDetailBalance, previousMonth.balance);

        monthToDateCard.classList.toggle('expanded', isMonthToDateExpanded);
        previousMonthCard.classList.toggle('expanded', isPreviousMonthExpanded);
        monthToDateDetails.classList.toggle('hidden', !isMonthToDateExpanded);
        previousMonthDetails.classList.toggle('hidden', !isPreviousMonthExpanded);
        monthToDateToggle.setAttribute('aria-expanded', isMonthToDateExpanded ? 'true' : 'false');
        previousMonthToggle.setAttribute('aria-expanded', isPreviousMonthExpanded ? 'true' : 'false');
        if (monthToDateChevron) {
            monthToDateChevron.textContent = isMonthToDateExpanded ? '⌃' : '⌄';
        }
        if (previousMonthChevron) {
            previousMonthChevron.textContent = isPreviousMonthExpanded ? '⌃' : '⌄';
        }
    }

    function toggleMonthToDateCard() {
        isMonthToDateExpanded = !isMonthToDateExpanded;
        if (latestMonthlyOverview) {
            renderMonthlyOverviewCards(latestMonthlyOverview);
        }
    }

    function togglePreviousMonthCard() {
        isPreviousMonthExpanded = !isPreviousMonthExpanded;
        if (latestMonthlyOverview) {
            renderMonthlyOverviewCards(latestMonthlyOverview);
        }
    }

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
        const today = normalizeDate(new Date());
        const balance = parseFloat(appStorage.getItem(storageKeys.BALANCE)) || 0;
        const payments = parseStoredArray(storageKeys.PAYMENTS);
        const incomes = parseStoredArray(storageKeys.INCOMES);
        const expenseEntries = parseStoredArray(storageKeys.EXPENSE_ENTRIES);
        const incomeEntries = parseStoredArray(storageKeys.INCOME_ENTRIES);

        const forecast = calculateAvailableCashForecast({
            balance,
            payments,
            incomes,
            today
        });
        const afterPayments = forecast.availableCash;
        const afterPaymentsElement = document.getElementById('afterPayments');
        const afterPaymentsSubtext = document.getElementById('afterPaymentsSubtext');
        afterPaymentsElement.textContent = formatCurrencyPLN(afterPayments);
        applySignedState(afterPaymentsElement, afterPayments);

        if (afterPaymentsSubtext) {
            if (forecast.reserveAmount <= 0) {
                afterPaymentsSubtext.textContent = forecast.nextIncomeDate
                    ? `Brak płatności do wpływu ${formatDateToPolish(forecast.nextIncomeDate)}`
                    : 'Brak płatności do końca miesiąca';
            } else {
                afterPaymentsSubtext.textContent = forecast.horizonType === 'next-income'
                    ? `Po rezerwie do wpływu ${formatDateToPolish(forecast.horizonDate)}`
                    : 'Po rezerwie do końca miesiąca';
            }
        }

        const monthlyOverview = calculateDashboardMonthSummary({
            today,
            payments,
            incomes,
            expenseEntries,
            incomeEntries
        });
        renderMonthlyOverviewCards(monthlyOverview);
    }

    function loadIncomes() {
        const incomes = parseStoredArray(storageKeys.INCOMES);
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

                const paidBtn = document.createElement('button');
                paidBtn.className = 'paid-btn';
                paidBtn.type = 'button';
                paidBtn.textContent = 'Zaksięgowano';
                paidBtn.addEventListener('click', event => {
                    event.stopPropagation();
                    const shouldSettle = confirm(
                        `Zaksięgować wpływ "${normalizeUserText(income.name)}" na dziś?\n`
                        + `Kwota: ${formatIncomeAmountPLN(income.amount || 0)}\n`
                        + `Planowana data: ${formatDateToPolish(income.date)}`
                    );
                    if (!shouldSettle) {
                        return;
                    }
                    markIncomeAsReceived(income.id, income.date);
                });
                row.appendChild(paidBtn);

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
        const payments = parseStoredArray(storageKeys.PAYMENTS);
        const currentViewDate = getCurrentViewDate();
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

            const paidBtn = document.createElement('button');
            paidBtn.className = 'paid-btn';
            paidBtn.type = 'button';
            paidBtn.textContent = 'Opłacone';
            paidBtn.addEventListener('click', event => {
                event.stopPropagation();
                const shouldSettle = confirm(
                    `Oznaczyć płatność "${normalizeUserText(payment.name)}" jako opłaconą na dziś?\n`
                    + `Kwota: ${formatExpenseAmountPLN(payment.amount || 0)}\n`
                    + `Planowana data: ${formatDateToPolish(payment.date)}`
                );
                if (!shouldSettle) {
                    return;
                }
                markPaymentAsPaid(payment.id, payment.date);
            });
            row.appendChild(paidBtn);

            listElement.appendChild(row);
        });
    }

    return {
        updateViewMonthLabel,
        changeViewMonth,
        goToCurrentMonth,
        toggleMonthToDateCard,
        togglePreviousMonthCard,
        loadBalance,
        updateCalculations,
        loadIncomes,
        loadPayments
    };
}
