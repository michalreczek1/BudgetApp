import {
    sanitizeTenantProfiles,
    sanitizeTenantPaymentHistory,
    getTenantRecordForMonth,
    getTenantDueDate,
    upsertTenantPaymentRecord,
    buildTenantMonthRows,
    summarizeTenantMonthRows
} from './tenants.js';
import { formatDateString } from '../date-utils.js';

function generateEntityId() {
    return Date.now() + Math.floor(Math.random() * 1000);
}

function escapeHtmlText(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getSelectedMonthValue(inputId, getMonthInputValue) {
    const input = document.getElementById(inputId);
    if (!input) {
        return getMonthInputValue(new Date());
    }
    if (!/^\d{4}-\d{2}$/.test(String(input.value || ''))) {
        input.value = getMonthInputValue(new Date());
    }
    return input.value;
}

export function createTenantPaymentsController({
    appStorage,
    storageKeys,
    parseStoredJSON,
    roundCurrency,
    buildCategoryTotals,
    showToast,
    normalizeUserText,
    formatDateToPolish,
    formatCurrencyPLN,
    getMonthInputValue,
    getCategoryIcon,
    loadBalance,
    loadIncomes,
    updateCalculations,
    flushStateSave,
    renderIncomeAnalysis
}) {
    const pendingDashboardToggleTenantIds = new Set();

    function readProfiles() {
        return sanitizeTenantProfiles(parseStoredJSON(storageKeys.TENANT_PROFILES, []));
    }

    function readHistory() {
        return sanitizeTenantPaymentHistory(parseStoredJSON(storageKeys.TENANT_PAYMENT_HISTORY, []));
    }

    function readIncomeEntries() {
        return parseStoredJSON(storageKeys.INCOME_ENTRIES, []);
    }

    function writeIncomeEntries(entries) {
        appStorage.setItem(storageKeys.INCOME_ENTRIES, JSON.stringify(entries));
        appStorage.setItem(storageKeys.INCOME_TOTALS, JSON.stringify(buildCategoryTotals(entries)));
    }

    function refreshTenantDerivedUi() {
        loadBalance();
        loadIncomes();
        updateCalculations();
        if (document.getElementById('incomeAnalysisModal')?.classList.contains('active')) {
            renderIncomeAnalysis();
        }
    }

    function getTenantMonthValue() {
        return getSelectedMonthValue('tenantPaymentsMonth', getMonthInputValue);
    }

    function getCurrentMonthValue() {
        return getMonthInputValue(new Date());
    }

    function collectTenantProfilesFromModal() {
        const profiles = [];
        for (let tenantId = 1; tenantId <= 7; tenantId += 1) {
            const isMarkedActive = Boolean(document.getElementById(`tenantActive${tenantId}`)?.checked);
            const name = normalizeUserText(document.getElementById(`tenantName${tenantId}`)?.value);
            const amountInput = document.getElementById(`tenantAmount${tenantId}`);
            const dueDayInput = document.getElementById(`tenantDueDay${tenantId}`);
            const amount = roundCurrency(Number(amountInput?.value || 0));
            const dueDay = Number(dueDayInput?.value);
            const hasEnteredTenantData = Boolean(name) || (Number.isFinite(amount) && amount > 0);
            const isActive = isMarkedActive || hasEnteredTenantData;

            if (isActive) {
                if (!name) {
                    showToast(`Wpisz nazwę dla najemcy ${tenantId}`, 'warning');
                    document.getElementById(`tenantName${tenantId}`)?.focus();
                    return null;
                }
                if (!Number.isFinite(amount) || amount <= 0) {
                    showToast(`Podaj poprawną kwotę dla najemcy ${tenantId}`, 'warning');
                    amountInput?.focus();
                    return null;
                }
                if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 28) {
                    showToast(`Podaj dzień płatności 1-28 dla najemcy ${tenantId}`, 'warning');
                    dueDayInput?.focus();
                    return null;
                }
            }

            profiles.push({
                id: tenantId,
                isActive,
                name,
                amount: Number.isFinite(amount) && amount > 0 ? amount : 0,
                dueDay: Number.isInteger(dueDay) && dueDay >= 1 && dueDay <= 28 ? dueDay : 10
            });
        }

        return profiles;
    }

    function getCurrentMonthRows() {
        const monthValue = getMonthInputValue(new Date());
        return buildTenantMonthRows({
            profiles: readProfiles(),
            history: readHistory(),
            monthValue,
            today: new Date()
        });
    }

    function renderTenantDashboardReport() {
        const summaryElement = document.getElementById('tenantDashboardSummary');
        const listElement = document.getElementById('tenantDashboardList');
        const monthElement = document.getElementById('tenantDashboardMonth');
        if (!summaryElement || !listElement || !monthElement) {
            return;
        }

        const monthRows = getCurrentMonthRows();
        const summary = summarizeTenantMonthRows(monthRows);
        const today = new Date();
        const formattedMonth = today.toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' });
        monthElement.textContent = formattedMonth.charAt(0).toUpperCase() + formattedMonth.slice(1);

        if (summary.active === 0) {
            summaryElement.textContent = 'Brak aktywnych najemców';
            listElement.innerHTML = `
                <div class="tenant-report-empty">
                    <span>Dodaj lokatorów w module, aby zobaczyć szybki raport.</span>
                    <button type="button" class="btn btn-secondary tenant-open-btn" onclick="openTenantPaymentsModal()">Otwórz moduł</button>
                </div>
            `;
            return;
        }

        summaryElement.textContent = `${summary.paid}/${summary.active} zapłaciło • ${formatCurrencyPLN(summary.paidAmount)} / ${formatCurrencyPLN(summary.expectedAmount)}`;
        const rowsMarkup = monthRows
            .filter(row => row.profile.isActive)
            .map(row => {
                const amount = Number(row.historyRecord?.amount) > 0
                    ? Number(row.historyRecord.amount)
                    : Number(row.profile.amount) || 0;
                const isPaid = row.historyRecord?.paid === true;
                const isPending = pendingDashboardToggleTenantIds.has(Number(row.profile.id));
                const rowClassNames = [
                    'tenant-sheet-row',
                    row.status?.key === 'overdue' ? 'tenant-sheet-row-overdue' : '',
                    isPending ? 'tenant-sheet-row-pending' : ''
                ].filter(Boolean).join(' ');
                return `
                    <div class="${rowClassNames}" role="row">
                        <div class="tenant-sheet-cell tenant-sheet-name">${escapeHtmlText(row.profile.name)}</div>
                        <div class="tenant-sheet-cell tenant-sheet-due">${formatDateToPolish(row.dueDate)}</div>
                        <div class="tenant-sheet-cell tenant-sheet-amount">${formatCurrencyPLN(amount)}</div>
                        <label class="tenant-sheet-cell tenant-sheet-paid">
                            <input
                                type="checkbox"
                                class="tenant-sheet-checkbox"
                                aria-label="Zapłacił ${escapeHtmlText(row.profile.name)}"
                                ${isPaid ? 'checked' : ''}
                                ${isPending ? 'disabled' : ''}
                                onclick="toggleTenantDashboardPaid(${row.profile.id}, this.checked)"
                            >
                        </label>
                    </div>
                `;
            })
            .join('');
        listElement.innerHTML = `
            <div class="tenant-sheet" role="table" aria-label="Raport najemców">
                <div class="tenant-sheet-header" role="row">
                    <div class="tenant-sheet-cell tenant-sheet-name">Nazwisko</div>
                    <div class="tenant-sheet-cell tenant-sheet-due">Termin</div>
                    <div class="tenant-sheet-cell tenant-sheet-amount">Kwota</div>
                    <div class="tenant-sheet-cell tenant-sheet-paid">Zapłacił</div>
                </div>
                ${rowsMarkup}
            </div>
        `;
    }

    function renderTenantPayments() {
        const profiles = readProfiles();
        const history = readHistory();
        const monthValue = getTenantMonthValue();
        const listElement = document.getElementById('tenantPaymentsList');
        const summaryElement = document.getElementById('tenantPaymentsSummary');
        if (!listElement || !summaryElement) {
            return;
        }

        const monthRows = buildTenantMonthRows({
            profiles,
            history,
            monthValue,
            today: new Date()
        });
        const summary = summarizeTenantMonthRows(monthRows);
        summaryElement.textContent = `Zapłacono: ${summary.paid} • Oczekuje: ${summary.awaiting} • Po terminie: ${summary.overdue} • Ukryte: ${summary.hidden}`;

        listElement.innerHTML = monthRows.map(({ profile, historyRecord, dueDate, status }) => {
            const paidAtLabel = historyRecord?.paidAt
                ? `Wpłata zaksięgowana: ${formatDateToPolish(historyRecord.paidAt)}`
                : `Termin płatności: ${formatDateToPolish(dueDate)}`;

            return `
                <div class="tenant-card ${profile.isActive ? '' : 'tenant-card-inactive'}">
                    <div class="tenant-card-head">
                        <label class="tenant-active-toggle">
                            <input type="checkbox" id="tenantActive${profile.id}" ${profile.isActive ? 'checked' : ''}>
                            <span>${profile.isActive ? 'Aktywny' : 'Ukryty'}</span>
                        </label>
                        <span class="tenant-status-badge tenant-status-${status.key}">${status.label}</span>
                    </div>
                    <div class="tenant-card-grid">
                        <div class="input-group">
                            <label>Nazwisko najemcy</label>
                            <input type="text" id="tenantName${profile.id}" value="${String(profile.name || '').replace(/"/g, '&quot;')}" maxlength="120" placeholder="np. Kowalski">
                        </div>
                        <div class="input-group">
                            <label>Kwota miesięczna (zł)</label>
                            <input type="number" id="tenantAmount${profile.id}" value="${profile.amount || ''}" step="0.01" min="0">
                        </div>
                        <div class="input-group">
                            <label>Dzień płatności</label>
                            <input type="number" id="tenantDueDay${profile.id}" value="${profile.dueDay}" min="1" max="28" step="1">
                        </div>
                    </div>
                    <div class="tenant-card-meta">
                        <span>${paidAtLabel}</span>
                        ${historyRecord?.amount ? `<span>Snapshot miesiąca: ${historyRecord.amount.toFixed(2)} zł</span>` : ''}
                    </div>
                    <div class="tenant-card-actions">
                        ${profile.isActive ? `
                            ${historyRecord?.paid
                                ? `<button class="btn btn-secondary" type="button" onclick="undoTenantPayment(${profile.id})">Cofnij wpłatę</button>`
                                : `<button class="btn btn-primary" type="button" onclick="markTenantAsPaid(${profile.id})">Zaksięguj wpłatę</button>`}
                        ` : '<div class="tenant-card-muted">Slot ukryty nie bierze udziału w rozliczeniach.</div>'}
                    </div>
                </div>
            `;
        }).join('');
    }

    function openTenantPaymentsModal() {
        const monthInput = document.getElementById('tenantPaymentsMonth');
        if (monthInput) {
            monthInput.value = getMonthInputValue(new Date());
        }
        renderTenantPayments();
        document.getElementById('tenantPaymentsModal')?.classList.add('active');
    }

    function closeTenantPaymentsModal() {
        document.getElementById('tenantPaymentsModal')?.classList.remove('active');
    }

    function changeTenantPaymentsMonth() {
        renderTenantPayments();
    }

    async function toggleTenantDashboardPaid(tenantId, isChecked) {
        const normalizedTenantId = Number(tenantId);
        if (!Number.isInteger(normalizedTenantId) || pendingDashboardToggleTenantIds.has(normalizedTenantId)) {
            renderTenantDashboardReport();
            return;
        }

        pendingDashboardToggleTenantIds.add(normalizedTenantId);
        renderTenantDashboardReport();

        try {
            if (isChecked) {
                await markTenantAsPaid(normalizedTenantId, getCurrentMonthValue());
            } else {
                await undoTenantPayment(normalizedTenantId, getCurrentMonthValue());
            }
        } finally {
            pendingDashboardToggleTenantIds.delete(normalizedTenantId);
            renderTenantDashboardReport();
        }
    }

    async function saveTenantProfiles() {
        const profiles = collectTenantProfilesFromModal();
        if (!profiles) {
            return;
        }

        appStorage.setItem(storageKeys.TENANT_PROFILES, JSON.stringify(profiles));
        renderTenantDashboardReport();
        renderTenantPayments();
        await flushStateSave();
        showToast('Dane najemców zostały zapisane.', 'success');
    }

    async function markTenantAsPaid(tenantId, monthOverride = '') {
        const profiles = readProfiles();
        const profile = profiles.find(item => Number(item.id) === Number(tenantId));
        if (!profile || !profile.isActive) {
            showToast('Najemca jest nieaktywny lub nie istnieje.', 'warning');
            return;
        }

        const monthValue = /^\d{4}-\d{2}$/.test(String(monthOverride || ''))
            ? String(monthOverride)
            : getTenantMonthValue();
        const history = readHistory();
        const existingRecord = getTenantRecordForMonth(history, profile.id, monthValue);
        if (existingRecord?.paid) {
            return;
        }

        const todayIso = formatDateString(new Date());
        const amount = existingRecord?.amount > 0 ? existingRecord.amount : roundCurrency(profile.amount);
        const dueDate = existingRecord?.dueDate || getTenantDueDate(monthValue, profile.dueDay);
        const incomeEntries = readIncomeEntries();
        const entryId = generateEntityId();
        incomeEntries.push({
            id: entryId,
            amount,
            category: 'najem',
            date: todayIso,
            source: 'tenant-payment',
            name: normalizeUserText(profile.name),
            icon: getCategoryIcon('najem', 'income')
        });
        writeIncomeEntries(incomeEntries);

        const currentBalance = Number(appStorage.getItem(storageKeys.BALANCE)) || 0;
        appStorage.setItem(storageKeys.BALANCE, roundCurrency(currentBalance + amount).toString());

        const nextHistory = upsertTenantPaymentRecord(history, {
            id: existingRecord?.id || generateEntityId(),
            tenantId: profile.id,
            month: monthValue,
            amount,
            dueDate,
            paid: true,
            paidAt: todayIso,
            incomeEntryId: entryId
        });
        appStorage.setItem(storageKeys.TENANT_PAYMENT_HISTORY, JSON.stringify(nextHistory));

        refreshTenantDerivedUi();
        renderTenantDashboardReport();
        renderTenantPayments();
        await flushStateSave();
        showToast(`Zaksięgowano wpłatę: ${profile.name}`, 'success');
    }

    async function undoTenantPayment(tenantId, monthOverride = '') {
        const monthValue = /^\d{4}-\d{2}$/.test(String(monthOverride || ''))
            ? String(monthOverride)
            : getTenantMonthValue();
        const history = readHistory();
        const record = getTenantRecordForMonth(history, tenantId, monthValue);
        if (!record?.paid) {
            return;
        }

        let removedAmount = 0;
        if (record.incomeEntryId) {
            const incomeEntries = readIncomeEntries();
            const nextEntries = incomeEntries.filter(entry => {
                const keep = Number(entry.id) !== Number(record.incomeEntryId);
                if (!keep) {
                    removedAmount = roundCurrency(Number(entry.amount) || 0);
                }
                return keep;
            });

            if (nextEntries.length !== incomeEntries.length) {
                writeIncomeEntries(nextEntries);
            } else {
                showToast('Nie znaleziono powiązanego wpisu wpływu. Cofnięto tylko status najemcy.', 'warning', 5000);
            }
        }

        if (removedAmount > 0) {
            const currentBalance = Number(appStorage.getItem(storageKeys.BALANCE)) || 0;
            appStorage.setItem(storageKeys.BALANCE, roundCurrency(currentBalance - removedAmount).toString());
        }

        const nextHistory = upsertTenantPaymentRecord(history, {
            ...record,
            paid: false,
            paidAt: '',
            incomeEntryId: null
        });
        appStorage.setItem(storageKeys.TENANT_PAYMENT_HISTORY, JSON.stringify(nextHistory));

        refreshTenantDerivedUi();
        renderTenantDashboardReport();
        renderTenantPayments();
        await flushStateSave();
        showToast('Cofnięto wpłatę najemcy.', 'success');
    }

    return {
        openTenantPaymentsModal,
        closeTenantPaymentsModal,
        changeTenantPaymentsMonth,
        renderTenantPayments,
        renderTenantDashboardReport,
        toggleTenantDashboardPaid,
        saveTenantProfiles,
        markTenantAsPaid,
        undoTenantPayment
    };
}
