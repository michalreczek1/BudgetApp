export function createAnalysisController({
    getCurrentViewDate,
    getMonthInputValue,
    apiFetchTransactionsForAnalysis,
    handleUnauthorizedSession,
    parseStoredJSON,
    appStorage,
    storageKeys,
    roundCurrency,
    showToast,
    buildCategoryTotals,
    loadBalance,
    updateCalculations,
    flushStateSave,
    parseDateString,
    getCategoryIcon,
    escapeHtml,
    formatEntryDate,
    formatExpenseAmountPLN,
    formatIncomeAmountPLN
}) {
    let expenseDetailsVisible = false;
    let editingExpenseEntryId = null;
    let expenseAnalysisRequestId = 0;
    let incomeAnalysisRequestId = 0;

    async function fetchTransactionsForAnalysis(entryType, monthValue) {
        if (!/^\d{4}-\d{2}$/.test(String(monthValue || ''))) {
            return {
                entries: [],
                totalsByCategory: {},
                totalAmount: 0
            };
        }

        return apiFetchTransactionsForAnalysis(entryType, monthValue);
    }

    function getAnalysisMonthValue(monthValue) {
        if (/^\d{4}-\d{2}$/.test(String(monthValue || ''))) {
            return String(monthValue);
        }
        return getMonthInputValue(getCurrentViewDate());
    }

    function openExpenseAnalysisModalForMonth(monthValue) {
        const monthInput = document.getElementById('expenseAnalysisMonth');
        monthInput.value = getAnalysisMonthValue(monthValue);
        expenseDetailsVisible = false;
        document.getElementById('expenseDetailsSection').classList.add('hidden');
        document.getElementById('expenseDetailsBtn').textContent = 'Szczegóły';
        renderExpenseAnalysis();
        document.getElementById('expenseAnalysisModal').classList.add('active');
    }

    function openExpenseAnalysisModal() {
        openExpenseAnalysisModalForMonth(getMonthInputValue(getCurrentViewDate()));
    }

    function closeExpenseAnalysisModal() {
        document.getElementById('expenseAnalysisModal').classList.remove('active');
        closeExpenseEditModal();
    }

    function closeExpenseEditModal() {
        document.getElementById('expenseEditModal').classList.remove('active');
        editingExpenseEntryId = null;
        document.getElementById('expenseEditAmountInput').value = '';
    }

    function openIncomeAnalysisModalForMonth(monthValue) {
        const monthInput = document.getElementById('incomeAnalysisMonth');
        monthInput.value = getAnalysisMonthValue(monthValue);
        renderIncomeAnalysis();
        document.getElementById('incomeAnalysisModal').classList.add('active');
    }

    function openIncomeAnalysisModal() {
        openIncomeAnalysisModalForMonth(getMonthInputValue(getCurrentViewDate()));
    }

    function closeIncomeAnalysisModal() {
        document.getElementById('incomeAnalysisModal').classList.remove('active');
    }

    function openIncomeAnalysisFromExpense() {
        const expenseMonth = document.getElementById('expenseAnalysisMonth').value;
        closeExpenseAnalysisModal();
        openIncomeAnalysisModalForMonth(expenseMonth || getMonthInputValue(getCurrentViewDate()));
    }

    function toggleExpenseDetails() {
        const detailsButton = document.getElementById('expenseDetailsBtn');
        if (detailsButton.disabled) {
            return;
        }

        expenseDetailsVisible = !expenseDetailsVisible;
        renderExpenseAnalysis();
    }

    async function editExpenseAmountFromAnalysis(entryId) {
        const normalizedId = Number(entryId);
        if (!Number.isInteger(normalizedId) || normalizedId <= 0) {
            showToast('Nie udało się odczytać identyfikatora wydatku.', 'error');
            return;
        }

        const entries = parseStoredJSON(storageKeys.EXPENSE_ENTRIES, []);
        const entryIndex = entries.findIndex(entry => Number(entry.id) === normalizedId);
        if (entryIndex === -1) {
            showToast('Nie znaleziono wydatku. Odśwież analizę i spróbuj ponownie.', 'warning');
            await renderExpenseAnalysis();
            return;
        }

        const currentAmount = roundCurrency(Number(entries[entryIndex].amount) || 0);
        editingExpenseEntryId = normalizedId;
        const amountInput = document.getElementById('expenseEditAmountInput');
        amountInput.value = currentAmount.toFixed(2);
        document.getElementById('expenseEditModal').classList.add('active');
        amountInput.focus();
        amountInput.select();
    }

    async function saveExpenseAmountFromAnalysis() {
        if (!Number.isInteger(editingExpenseEntryId) || editingExpenseEntryId <= 0) {
            showToast('Nie wybrano wydatku do edycji.', 'warning');
            return;
        }

        const rawValue = document.getElementById('expenseEditAmountInput').value;
        const parsedAmount = Number(String(rawValue).replace(',', '.').trim());
        const newAmount = roundCurrency(parsedAmount);
        if (!Number.isFinite(newAmount) || newAmount <= 0) {
            showToast('Podaj poprawną kwotę większą od zera.', 'warning');
            return;
        }

        const entries = parseStoredJSON(storageKeys.EXPENSE_ENTRIES, []);
        const entryIndex = entries.findIndex(entry => Number(entry.id) === editingExpenseEntryId);
        if (entryIndex === -1) {
            closeExpenseEditModal();
            showToast('Nie znaleziono wydatku. Odśwież analizę i spróbuj ponownie.', 'warning');
            await renderExpenseAnalysis();
            return;
        }

        const currentAmount = roundCurrency(Number(entries[entryIndex].amount) || 0);
        if (newAmount === currentAmount) {
            closeExpenseEditModal();
            return;
        }

        entries[entryIndex] = {
            ...entries[entryIndex],
            amount: newAmount
        };

        appStorage.setItem(storageKeys.EXPENSE_ENTRIES, JSON.stringify(entries));
        appStorage.setItem(storageKeys.EXPENSE_TOTALS, JSON.stringify(buildCategoryTotals(entries)));

        const currentBalance = parseFloat(appStorage.getItem(storageKeys.BALANCE)) || 0;
        const updatedBalance = roundCurrency(currentBalance + currentAmount - newAmount);
        appStorage.setItem(storageKeys.BALANCE, updatedBalance.toString());

        closeExpenseEditModal();
        loadBalance();
        updateCalculations();

        await flushStateSave();
        if (document.getElementById('expenseAnalysisModal').classList.contains('active')) {
            await renderExpenseAnalysis();
        }
    }

    async function renderExpenseAnalysis() {
        const requestId = ++expenseAnalysisRequestId;
        const monthValue = document.getElementById('expenseAnalysisMonth').value;
        const summaryElement = document.getElementById('expenseAnalysisSummary');
        const detailsElement = document.getElementById('expenseAnalysisDetails');
        const detailsButton = document.getElementById('expenseDetailsBtn');
        const detailsSection = document.getElementById('expenseDetailsSection');
        let payload;

        try {
            payload = await fetchTransactionsForAnalysis('expense', monthValue);
        } catch (error) {
            if (requestId !== expenseAnalysisRequestId) {
                return;
            }
            if (error?.status === 401) {
                handleUnauthorizedSession('Sesja wygasła. Zaloguj się ponownie.');
                return;
            }
            summaryElement.classList.remove('hidden');
            summaryElement.innerHTML = `
                <div class="empty-state">
                    <div class="icon">⚠️</div>
                    <p>Nie udało się pobrać analizy wydatków.</p>
                </div>
            `;
            detailsElement.innerHTML = summaryElement.innerHTML;
            detailsButton.disabled = true;
            detailsSection.classList.add('hidden');
            detailsButton.textContent = 'Szczegóły';
            expenseDetailsVisible = false;
            return;
        }

        if (requestId !== expenseAnalysisRequestId) {
            return;
        }

        const entries = Array.isArray(payload?.entries) ? payload.entries : [];
        const grouped = {};
        entries.forEach(entry => {
            const category = entry.category || 'inne';
            if (!grouped[category]) {
                grouped[category] = [];
            }
            grouped[category].push(entry);
        });

        const apiTotals = payload?.totalsByCategory && typeof payload.totalsByCategory === 'object'
            ? payload.totalsByCategory
            : {};
        const totalsByCategory = Object.keys(apiTotals).length > 0
            ? Object.entries(apiTotals).reduce((acc, [category, value]) => {
                const amount = Number(value);
                if (Number.isFinite(amount)) {
                    acc[category] = roundCurrency(amount);
                }
                return acc;
            }, {})
            : Object.entries(grouped).reduce((acc, [category, categoryEntries]) => {
                acc[category] = roundCurrency(
                    categoryEntries.reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0)
                );
                return acc;
            }, {});

        if (entries.length === 0) {
            summaryElement.classList.remove('hidden');
            summaryElement.innerHTML = `
                <div class="empty-state">
                    <div class="icon">🧾</div>
                    <p>Brak wydatków w wybranym miesiącu</p>
                </div>
            `;
            detailsElement.innerHTML = `
                <div class="empty-state">
                    <div class="icon">🧾</div>
                    <p>Brak wydatków w wybranym miesiącu</p>
                </div>
            `;
            detailsButton.disabled = true;
            detailsSection.classList.add('hidden');
            detailsButton.textContent = 'Szczegóły';
            expenseDetailsVisible = false;
            return;
        }

        detailsButton.disabled = false;

        const categories = Object.entries(totalsByCategory).sort((a, b) => b[1] - a[1]);
        summaryElement.innerHTML = categories.map(([category, total]) => {
            const icon = getCategoryIcon(category, 'expense');
            return `
                <div class="analysis-category-card">
                    <div class="analysis-category-header">
                        <span>${icon} ${escapeHtml(category)}</span>
                        <span class="analysis-category-total">${formatExpenseAmountPLN(total)}</span>
                    </div>
                </div>
            `;
        }).join('');

        if (!expenseDetailsVisible) {
            summaryElement.classList.remove('hidden');
            detailsSection.classList.add('hidden');
            detailsButton.textContent = 'Szczegóły';
            return;
        }

        summaryElement.classList.add('hidden');
        detailsSection.classList.remove('hidden');
        detailsButton.textContent = 'Ukryj szczegóły';
        const totalExpenses = Number.isFinite(Number(payload?.totalAmount))
            ? roundCurrency(Number(payload.totalAmount))
            : roundCurrency(entries.reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0));
        detailsElement.innerHTML = categories.map(([category]) => {
            const icon = getCategoryIcon(category, 'expense');
            const categoryEntries = [...(grouped[category] || [])]
                .filter(entry => !Number.isNaN(parseDateString(entry.date).getTime()))
                .sort((a, b) => parseDateString(b.date) - parseDateString(a.date));

            if (categoryEntries.length === 0) {
                return '';
            }

            return `
                <div class="analysis-category-card">
                    <div class="analysis-category-header">
                        <span>${icon} ${escapeHtml(category)}</span>
                    </div>
                    <div class="analysis-entry-list">
                        ${categoryEntries.map(entry => `
                            <div
                                class="analysis-entry analysis-entry-editable"
                                role="button"
                                tabindex="0"
                                onclick="editExpenseAmountFromAnalysis(${Number(entry.id)})"
                                onkeydown="if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); editExpenseAmountFromAnalysis(${Number(entry.id)}); }"
                            >
                                <div>${formatEntryDate(entry.date)}</div>
                                <div class="analysis-entry-amount-expense">${formatExpenseAmountPLN(entry.amount)}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }).join('') + `
            <div class="analysis-category-card">
                <div class="analysis-category-header">
                    <span>🧮 Suma wydatków</span>
                    <span class="analysis-category-total">${formatExpenseAmountPLN(totalExpenses)}</span>
                </div>
            </div>
        `;
    }

    async function renderIncomeAnalysis() {
        const requestId = ++incomeAnalysisRequestId;
        const monthValue = document.getElementById('incomeAnalysisMonth').value;
        const listElement = document.getElementById('incomeAnalysisList');
        let payload;

        try {
            payload = await fetchTransactionsForAnalysis('income', monthValue);
        } catch (error) {
            if (requestId !== incomeAnalysisRequestId) {
                return;
            }
            if (error?.status === 401) {
                handleUnauthorizedSession('Sesja wygasła. Zaloguj się ponownie.');
                return;
            }
            listElement.innerHTML = `
                <div class="empty-state">
                    <div class="icon">⚠️</div>
                    <p>Nie udało się pobrać analizy wpływów.</p>
                </div>
            `;
            return;
        }

        if (requestId !== incomeAnalysisRequestId) {
            return;
        }

        const entries = Array.isArray(payload?.entries) ? payload.entries : [];

        if (entries.length === 0) {
            listElement.innerHTML = `
                <div class="empty-state">
                    <div class="icon">💵</div>
                    <p>Brak wpływów w wybranym miesiącu</p>
                </div>
            `;
            return;
        }

        const grouped = {};
        entries.forEach(entry => {
            const category = entry.category || 'inne';
            if (!grouped[category]) {
                grouped[category] = {
                    total: 0,
                    entries: []
                };
            }

            grouped[category].total = roundCurrency(grouped[category].total + (Number(entry.amount) || 0));
            grouped[category].entries.push(entry);
        });

        const apiTotals = payload?.totalsByCategory && typeof payload.totalsByCategory === 'object'
            ? payload.totalsByCategory
            : {};
        const totalsByCategory = Object.keys(apiTotals).length > 0
            ? Object.entries(apiTotals).reduce((acc, [category, value]) => {
                const amount = Number(value);
                if (Number.isFinite(amount)) {
                    acc[category] = roundCurrency(amount);
                }
                return acc;
            }, {})
            : Object.entries(grouped).reduce((acc, [category, group]) => {
                acc[category] = roundCurrency(group.total);
                return acc;
            }, {});

        const categories = Object.entries(totalsByCategory).sort((a, b) => b[1] - a[1]);
        const totalIncome = Number.isFinite(Number(payload?.totalAmount))
            ? roundCurrency(Number(payload.totalAmount))
            : roundCurrency(entries.reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0));

        listElement.innerHTML = categories.map(([category, total]) => {
            const icon = getCategoryIcon(category, 'income');
            const categoryEntries = [...(grouped[category]?.entries || [])].sort((a, b) => parseDateString(a.date) - parseDateString(b.date));
            return `
                <div class="analysis-category-card">
                    <div class="analysis-category-header">
                        <span>${icon} ${escapeHtml(category)}</span>
                        <span class="analysis-category-total analysis-income-total">${formatIncomeAmountPLN(total)}</span>
                    </div>
                    <div class="analysis-entry-list">
                        ${categoryEntries.map(entry => `
                            <div class="analysis-entry">
                                <div>
                                    <div>${escapeHtml(entry.name || category)}</div>
                                    <div class="analysis-entry-meta">${formatEntryDate(entry.date)}</div>
                                </div>
                                <div class="analysis-entry-amount-income">${formatIncomeAmountPLN(entry.amount)}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }).join('') + `
            <div class="analysis-category-card">
                <div class="analysis-category-header">
                    <span>🧮 Suma wpływów</span>
                    <span class="analysis-category-total analysis-income-total">${formatIncomeAmountPLN(totalIncome)}</span>
                </div>
            </div>
        `;
    }

    return {
        openExpenseAnalysisModal,
        openExpenseAnalysisModalForMonth,
        closeExpenseAnalysisModal,
        closeExpenseEditModal,
        openIncomeAnalysisModal,
        openIncomeAnalysisModalForMonth,
        closeIncomeAnalysisModal,
        openIncomeAnalysisFromExpense,
        toggleExpenseDetails,
        editExpenseAmountFromAnalysis,
        saveExpenseAmountFromAnalysis,
        renderExpenseAnalysis,
        renderIncomeAnalysis
    };
}
