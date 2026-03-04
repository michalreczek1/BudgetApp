import {
    parseDateString as importedParseDateString,
    formatDateString as importedFormatDateString,
    formatDateToPolish as importedFormatDateToPolish,
    parseUserDateToISO as importedParseUserDateToISO
} from './date-utils.js';
import {
    roundCurrency,
    formatCurrencyPLN,
    formatExpenseAmountPLN,
    formatIncomeAmountPLN
} from './js/formatters.js';
import { CLIENT_DEPRECATED_PIN_VALUE, sanitizeState, isStateEffectivelyEmpty, buildCategoryTotals } from './js/state.js';
import { showToast } from './js/toast.js';
import { createPwaController } from './js/pwa.js';
import { createAdminController } from './js/admin.js';
import { createRenderController } from './js/render.js';
import { createAnalysisController } from './js/analysis.js';
import { createUiModalsController } from './js/ui-modals.js';
import { createActionsController } from './js/actions.js';
import { calculateAvailableCashForecast } from './js/cash-forecast.js';
import { calculateDashboardMonthSummary } from './js/month-summary.js';
import { createTenantPaymentsController } from './js/tenant-payments.js';
import {
    normalizeDate,
    isOccurrencePaid,
    isIncomeOccurrenceReceived,
    getIncomeOccurrenceForMonth,
    getPaymentOccurrenceForMonth,
    getNextIncomeOccurrenceFromDate,
    settlePaymentOccurrence,
    settleIncomeOccurrence,
    isPaymentDueOnDate,
    isIncomeDueOnDate,
    getDuePaymentOccurrencesUpToDate,
    getDueIncomeOccurrencesUpToDate
} from './js/scheduling.js';
import {
    apiFetchState,
    apiSaveState,
    apiFetchAuthStatus,
    apiRunSettlement,
    apiFetchTransactionsForAnalysis
} from './js/api.js';

if (
    typeof importedParseDateString !== 'function' ||
    typeof importedFormatDateString !== 'function' ||
    typeof importedFormatDateToPolish !== 'function' ||
    typeof importedParseUserDateToISO !== 'function'
) {
    console.error('Nie udało się załadować modułu date-utils.js');
    throw new Error('date-utils module unavailable');
}

const parseDateString = importedParseDateString;
const formatDateString = importedFormatDateString;
const formatDateToPolish = importedFormatDateToPolish;
const parseUserDateToISO = importedParseUserDateToISO;

        // Constants and shared state
        const STORAGE_KEYS = {
            PIN: 'budget_pin',
            BALANCE: 'budget_balance',
            PAYMENTS: 'budget_payments',
            INCOMES: 'budget_incomes',
            EXPENSE_ENTRIES: 'budget_expense_entries',
            INCOME_ENTRIES: 'budget_income_entries',
            EXPENSE_TOTALS: 'budget_expense_totals',
            INCOME_TOTALS: 'budget_income_totals',
            TENANT_PROFILES: 'budget_tenant_profiles',
            TENANT_PAYMENT_HISTORY: 'budget_tenant_payment_history'
        };
        const ADMIN_SUCCESS_DEFAULT_MESSAGE = 'PIN został pomyślnie zmieniony!';
        const MAX_TEXT_LENGTH = 120;

        const EXPENSE_CATEGORY_OPTIONS = [
            { value: 'jedzenie', label: '🍽️ Jedzenie', icon: '🍽️' },
            { value: 'paliwo', label: '⛽ Paliwo', icon: '⛽' },
            { value: 'lekarstwa', label: '💊 Lekarstwa', icon: '💊' },
            { value: 'suplementy', label: '💪 Suplementy', icon: '💪' },
            { value: 'ubrania', label: '👕 Ubrania', icon: '👕' },
            { value: 'inne', label: '✨ Inne', icon: '✨' }
        ];
        const INCOME_CATEGORY_OPTIONS = [
            { value: 'premia', label: '🎁 Premia', icon: '🎁' },
            { value: 'rodzice', label: '👨‍👩‍👧 Rodzice', icon: '👨‍👩‍👧' },
            { value: 'najem', label: '🏠 Najem', icon: '🏠' },
            { value: 'inne', label: '✨ Inne', icon: '✨' }
        ];

        let selectedPaymentFrequency = 'once';
        let selectedIncomeFrequency = 'once';
        let selectedMonths = [];
        let editingIncomeId = null;
        let editingPaymentId = null;
        let pendingBalanceCategoryChange = null;
        let balanceCategoryRowCounter = 0;
        let currentViewDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        let noonWatcherStarted = false;
        let isAuthenticated = false;
        let stateReady = false;
        let saveTimerId = null;
        let saveInProgress = false;
        let savePending = false;
        let appState = {
            pin: CLIENT_DEPRECATED_PIN_VALUE,
            version: 1,
            balance: 0,
            payments: [],
            incomes: [],
            expenseEntries: [],
            incomeEntries: [],
            expenseCategoryTotals: {},
            incomeCategoryTotals: {},
            tenantProfiles: [],
            tenantPaymentHistory: []
        };

        function migrateLegacyLocalStorageIfNeeded() {
            if (!isStateEffectivelyEmpty(appState)) {
                return false;
            }

            try {
                const legacyPin = window.localStorage.getItem(STORAGE_KEYS.PIN);
                const legacyBalanceRaw = window.localStorage.getItem(STORAGE_KEYS.BALANCE);
                const legacyPaymentsRaw = window.localStorage.getItem(STORAGE_KEYS.PAYMENTS);
                const legacyIncomesRaw = window.localStorage.getItem(STORAGE_KEYS.INCOMES);

                if (!legacyPin && !legacyBalanceRaw && !legacyPaymentsRaw && !legacyIncomesRaw) {
                    return false;
                }

                let legacyPayments = [];
                let legacyIncomes = [];
                try {
                    legacyPayments = legacyPaymentsRaw ? JSON.parse(legacyPaymentsRaw) : [];
                } catch {
                    legacyPayments = [];
                }
                try {
                    legacyIncomes = legacyIncomesRaw ? JSON.parse(legacyIncomesRaw) : [];
                } catch {
                    legacyIncomes = [];
                }

                const legacyState = sanitizeState({
                    balance: legacyBalanceRaw,
                    payments: legacyPayments,
                    incomes: legacyIncomes
                });

                appState = legacyState;
                return true;
            } catch (error) {
                console.error('Migracja localStorage -> API nie powiodła się:', error);
                return false;
            }
        }

        // API: state and auth
        async function fetchStateFromServer() {
            const data = await apiFetchState();
            appState = sanitizeState(data);
        }

        async function saveStateToServer() {
            const payload = JSON.parse(JSON.stringify(appState));
            delete payload.pin;
            payload.version = Number(appState.version) || 1;
            const result = await apiSaveState(payload);
            const updatedVersion = Number(result?.state?.version);
            if (Number.isFinite(updatedVersion) && updatedVersion > 0) {
                appState.version = Math.trunc(updatedVersion);
            }
        }

        async function fetchAuthStatus() {
            return apiFetchAuthStatus();
        }

        // PWA install and service worker
        const {
            updateInstallButtonVisibility,
            setupPwaInstallPrompt,
            installApp,
            registerServiceWorker
        } = createPwaController({ showToast });

        // Auth/session UI flow
        function showLoginScreen() {
            document.getElementById('mainApp').classList.add('hidden');
            document.getElementById('loginScreen').classList.remove('hidden');
            document.querySelectorAll('.pin-digit').forEach(input => {
                input.value = '';
            });
            document.getElementById('pin1').focus();
            updateInstallButtonVisibility();
        }

        function showMainAppScreen() {
            document.getElementById('loginScreen').classList.add('hidden');
            document.getElementById('mainApp').classList.remove('hidden');
            document.getElementById('loginError').style.display = 'none';
            updateInstallButtonVisibility();
        }

        function handleUnauthorizedSession(message) {
            isAuthenticated = false;
            savePending = false;
            if (saveTimerId) {
                clearTimeout(saveTimerId);
                saveTimerId = null;
            }
            showLoginScreen();
            if (message) {
                document.getElementById('loginError').textContent = message;
                document.getElementById('loginError').style.display = 'block';
            }
        }

        async function flushStateSave() {
            if (saveInProgress || !savePending) {
                return;
            }

            saveInProgress = true;
            savePending = false;

            try {
                await saveStateToServer();
            } catch (error) {
                if (error?.status === 401) {
                    handleUnauthorizedSession('Sesja wygasła. Zaloguj się ponownie.');
                    savePending = false;
                    return;
                }
                if (
                    (error?.status === 400 && error?.details?.error === 'invalid_version') ||
                    (error?.status === 422 && error?.details?.error === 'invalid_state_payload')
                ) {
                    try {
                        await fetchStateFromServer();
                        loadData();
                        if (document.getElementById('expenseAnalysisModal').classList.contains('active')) {
                            renderExpenseAnalysis();
                        }
                        if (document.getElementById('incomeAnalysisModal').classList.contains('active')) {
                            renderIncomeAnalysis();
                        }
                        showToast('Wykryto błąd walidacji lub wersji danych. Stan został odświeżony z serwera.', 'warning', 5000);
                    } catch (refreshError) {
                        if (refreshError?.status === 401) {
                            handleUnauthorizedSession('Sesja wygasła. Zaloguj się ponownie.');
                        } else {
                            console.error('Nie udało się odświeżyć stanu po błędzie wersji:', refreshError);
                        }
                    }
                    savePending = false;
                    return;
                }
                if (error?.status === 409 && error?.details?.error === 'state_conflict') {
                    showToast('Dane zostały zmienione w innej sesji. Odświeżono aktualny stan z serwera.', 'warning', 5000);
                    try {
                        await fetchStateFromServer();
                        loadData();
                        if (document.getElementById('expenseAnalysisModal').classList.contains('active')) {
                            renderExpenseAnalysis();
                        }
                        if (document.getElementById('incomeAnalysisModal').classList.contains('active')) {
                            renderIncomeAnalysis();
                        }
                    } catch (refreshError) {
                        if (refreshError?.status === 401) {
                            handleUnauthorizedSession('Sesja wygasła. Zaloguj się ponownie.');
                        } else {
                            console.error('Nie udało się odświeżyć stanu po konflikcie:', refreshError);
                        }
                    }
                    savePending = false;
                    return;
                }
                console.error('Błąd zapisu danych na serwerze:', error);
                savePending = true;
            } finally {
                saveInProgress = false;
                if (savePending) {
                    setTimeout(flushStateSave, 800);
                }
            }
        }

        function queueStateSave() {
            if (!stateReady || !isAuthenticated) {
                return;
            }

            savePending = true;
            if (saveTimerId) {
                clearTimeout(saveTimerId);
            }

            saveTimerId = setTimeout(() => {
                saveTimerId = null;
                flushStateSave();
            }, 200);
        }

        // Storage adapter (legacy localStorage-like API over appState)
        const appStorage = {
            getItem(key) {
                if (key === STORAGE_KEYS.PIN) {
                    return CLIENT_DEPRECATED_PIN_VALUE;
                }
                if (key === STORAGE_KEYS.BALANCE) {
                    return String(appState.balance);
                }
                if (key === STORAGE_KEYS.PAYMENTS) {
                    return JSON.stringify(appState.payments);
                }
                if (key === STORAGE_KEYS.INCOMES) {
                    return JSON.stringify(appState.incomes);
                }
                if (key === STORAGE_KEYS.EXPENSE_ENTRIES) {
                    return JSON.stringify(appState.expenseEntries);
                }
                if (key === STORAGE_KEYS.INCOME_ENTRIES) {
                    return JSON.stringify(appState.incomeEntries);
                }
                if (key === STORAGE_KEYS.EXPENSE_TOTALS) {
                    return JSON.stringify(appState.expenseCategoryTotals);
                }
                if (key === STORAGE_KEYS.INCOME_TOTALS) {
                    return JSON.stringify(appState.incomeCategoryTotals);
                }
                if (key === STORAGE_KEYS.TENANT_PROFILES) {
                    return JSON.stringify(appState.tenantProfiles);
                }
                if (key === STORAGE_KEYS.TENANT_PAYMENT_HISTORY) {
                    return JSON.stringify(appState.tenantPaymentHistory);
                }
                return null;
            },
            setItem(key, value) {
                if (key === STORAGE_KEYS.PIN) {
                    appState.pin = CLIENT_DEPRECATED_PIN_VALUE;
                } else if (key === STORAGE_KEYS.BALANCE) {
                    const parsed = parseFloat(value);
                    appState.balance = Number.isFinite(parsed) ? parsed : 0;
                } else if (key === STORAGE_KEYS.PAYMENTS) {
                    try {
                        const parsed = JSON.parse(value);
                        appState.payments = Array.isArray(parsed) ? parsed : [];
                    } catch {
                        appState.payments = [];
                    }
                } else if (key === STORAGE_KEYS.INCOMES) {
                    try {
                        const parsed = JSON.parse(value);
                        appState.incomes = Array.isArray(parsed) ? parsed : [];
                    } catch {
                        appState.incomes = [];
                    }
                } else if (key === STORAGE_KEYS.EXPENSE_ENTRIES) {
                    try {
                        const parsed = JSON.parse(value);
                        appState.expenseEntries = Array.isArray(parsed) ? parsed : [];
                    } catch {
                        appState.expenseEntries = [];
                    }
                } else if (key === STORAGE_KEYS.INCOME_ENTRIES) {
                    try {
                        const parsed = JSON.parse(value);
                        appState.incomeEntries = Array.isArray(parsed) ? parsed : [];
                    } catch {
                        appState.incomeEntries = [];
                    }
                } else if (key === STORAGE_KEYS.EXPENSE_TOTALS) {
                    try {
                        const parsed = JSON.parse(value);
                        appState.expenseCategoryTotals = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
                    } catch {
                        appState.expenseCategoryTotals = {};
                    }
                } else if (key === STORAGE_KEYS.INCOME_TOTALS) {
                    try {
                        const parsed = JSON.parse(value);
                        appState.incomeCategoryTotals = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
                    } catch {
                        appState.incomeCategoryTotals = {};
                    }
                } else if (key === STORAGE_KEYS.TENANT_PROFILES) {
                    try {
                        const parsed = JSON.parse(value);
                        appState.tenantProfiles = Array.isArray(parsed) ? parsed : [];
                    } catch {
                        appState.tenantProfiles = [];
                    }
                } else if (key === STORAGE_KEYS.TENANT_PAYMENT_HISTORY) {
                    try {
                        const parsed = JSON.parse(value);
                        appState.tenantPaymentHistory = Array.isArray(parsed) ? parsed : [];
                    } catch {
                        appState.tenantPaymentHistory = [];
                    }
                }

                queueStateSave();
            }
        };

        const {
            updateViewMonthLabel,
            changeViewMonth,
            goToCurrentMonth,
            toggleMonthToDateCard,
            togglePreviousMonthCard,
            loadBalance,
            updateCalculations,
            loadIncomes,
            loadPayments
        } = createRenderController({
            getCurrentViewDate: () => currentViewDate,
            setCurrentViewDate: nextDate => {
                currentViewDate = nextDate;
            },
            appStorage,
            storageKeys: STORAGE_KEYS,
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
        });

        const {
            openExpenseAnalysisModal,
            closeExpenseAnalysisModal,
            closeExpenseEditModal,
            openIncomeAnalysisModal,
            closeIncomeAnalysisModal,
            openIncomeAnalysisFromExpense,
            toggleExpenseDetails,
            editExpenseAmountFromAnalysis,
            saveExpenseAmountFromAnalysis,
            renderExpenseAnalysis,
            renderIncomeAnalysis
        } = createAnalysisController({
            getCurrentViewDate: () => currentViewDate,
            getMonthInputValue,
            apiFetchTransactionsForAnalysis,
            handleUnauthorizedSession,
            parseStoredJSON,
            appStorage,
            storageKeys: STORAGE_KEYS,
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
        });

        const {
            openTenantPaymentsModal,
            closeTenantPaymentsModal,
            changeTenantPaymentsMonth,
            renderTenantPayments,
            renderTenantDashboardReport,
            toggleTenantDashboardPaid,
            saveTenantProfiles,
            markTenantAsPaid,
            undoTenantPayment
        } = createTenantPaymentsController({
            appStorage,
            storageKeys: STORAGE_KEYS,
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
        });

        // App initialization and login/logout
        async function initializeStorage() {
            try {
                const authStatus = await fetchAuthStatus();
                isAuthenticated = authStatus?.authenticated === true;
            } catch (error) {
                console.error('Nie udało się sprawdzić statusu autoryzacji:', error);
                showToast('Brak połączenia z API. Uruchom serwer aplikacji (server.py).', 'error', 6000);
                isAuthenticated = false;
            }

            if (isAuthenticated) {
                try {
                    await fetchStateFromServer();
                } catch (error) {
                    console.error('Nie udało się pobrać danych z API:', error);
                    showToast('Nie udało się pobrać danych z API. Spróbuj ponownie później.', 'error', 6000);
                    isAuthenticated = false;
                }
            }

            appState = sanitizeState(appState || {});
            if (isAuthenticated) {
                migrateLegacyLocalStorageIfNeeded();
                ensureTrackingDataConsistency();
            }

            stateReady = true;
            if (isAuthenticated) {
                queueStateSave();
                showMainAppScreen();
                loadData();
            } else {
                showLoginScreen();
            }
        }

        // PIN input auto-focus
        document.querySelectorAll('.pin-digit').forEach((input, index, inputs) => {
            input.addEventListener('input', function() {
                if (this.value.length === 1 && index < inputs.length - 1) {
                    inputs[index + 1].focus();
                }
            });

            input.addEventListener('keydown', function(e) {
                if (e.key === 'Backspace' && this.value === '' && index > 0) {
                    inputs[index - 1].focus();
                }
            });
        });

        async function login() {
            if (!stateReady) {
                document.getElementById('loginError').textContent = 'Trwa ładowanie danych, spróbuj ponownie.';
                document.getElementById('loginError').style.display = 'block';
                return;
            }

            const pin = ['pin1', 'pin2', 'pin3', 'pin4']
                .map(id => document.getElementById(id).value)
                .join('');
            const errorElement = document.getElementById('loginError');
            errorElement.style.display = 'none';

            if (!/^\d{4}$/.test(pin)) {
                errorElement.textContent = 'PIN musi składać się z 4 cyfr.';
                errorElement.style.display = 'block';
                return;
            }

            try {
                const response = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify({ pin })
                });
                const data = await response.json().catch(() => ({}));

                if (!response.ok) {
                    if (response.status === 423) {
                        const retryAfterSec = Number(data?.retry_after_sec || 0);
                        const retryAfterMin = Math.max(1, Math.ceil(retryAfterSec / 60));
                        errorElement.textContent = `Logowanie zablokowane. Spróbuj ponownie za ${retryAfterMin} min.`;
                    } else if (response.status === 401) {
                        errorElement.textContent = 'Nieprawidłowy PIN. Spróbuj ponownie.';
                    } else {
                        errorElement.textContent = 'Błąd logowania. Spróbuj ponownie.';
                    }
                    errorElement.style.display = 'block';
                    document.querySelectorAll('.pin-digit').forEach(input => {
                        input.value = '';
                    });
                    document.getElementById('pin1').focus();
                    return;
                }

                isAuthenticated = true;
                await fetchStateFromServer();
                appState = sanitizeState(appState);
                ensureTrackingDataConsistency();
                showMainAppScreen();
                loadData();
            } catch (error) {
                console.error('Błąd logowania:', error);
                errorElement.textContent = 'Błąd połączenia z serwerem.';
                errorElement.style.display = 'block';
            }
        }

        async function logout() {
            try {
                await fetch('/api/auth/logout', {
                    method: 'POST',
                    credentials: 'same-origin'
                });
            } catch (error) {
                console.error('Błąd wylogowania:', error);
            } finally {
                isAuthenticated = false;
                showLoginScreen();
            }
        }

        function loadData() {
            updateViewMonthLabel();
            loadBalance();
            loadPayments();
            loadIncomes();
            updateCalculations();
            renderTenantDashboardReport();
            if (document.getElementById('tenantPaymentsModal')?.classList.contains('active')) {
                renderTenantPayments();
            }
        }

        // Modal Functions
        // Balance update flow and category split modal
        function openBalanceModal() {
            document.getElementById('balanceModal').classList.add('active');
            const current = parseFloat(appStorage.getItem(STORAGE_KEYS.BALANCE)) || 0;
            document.getElementById('balanceInput').value = current;
        }

        function closeBalanceModal() {
            document.getElementById('balanceModal').classList.remove('active');
        }

        function getBalanceCategoryOptions(changeType) {
            return changeType === 'expense' ? EXPENSE_CATEGORY_OPTIONS : INCOME_CATEGORY_OPTIONS;
        }

        function buildBalanceCategorySelectOptions(changeType) {
            return getBalanceCategoryOptions(changeType)
                .map(option => `<option value="${option.value}">${option.label}</option>`)
                .join('');
        }

        function createBalanceCategoryRow(changeType, isPrimary) {
            balanceCategoryRowCounter += 1;
            const rowId = balanceCategoryRowCounter;
            const row = document.createElement('div');
            row.className = 'balance-split-row';
            row.dataset.rowId = String(rowId);

            const amountValue = isPrimary ? pendingBalanceCategoryChange.amount.toFixed(2) : '';
            row.innerHTML = `
                <div class="balance-split-row-head">
                    <div class="balance-split-row-title">${isPrimary ? 'Pozycja 1 (automatyczna)' : `Pozycja ${rowId}`}</div>
                    ${isPrimary ? '' : `<button type="button" class="balance-split-remove-btn" onclick="removeBalanceCategoryRow(${rowId})">Usuń</button>`}
                </div>
                <div class="balance-split-fields">
                    <div class="balance-split-field">
                        <label>Kategoria</label>
                        <select class="balance-split-category" onchange="handleBalanceCategorySelectChange(${rowId})">
                            ${buildBalanceCategorySelectOptions(changeType)}
                        </select>
                        <input type="text" class="balance-split-other hidden" placeholder="Wpisz nazwę kategorii" maxlength="120">
                    </div>
                    <div class="balance-split-field">
                        <label>Kwota (zł)</label>
                        <input type="number" class="balance-split-amount" placeholder="0.00" step="0.01" ${isPrimary ? 'readonly' : ''} value="${amountValue}">
                    </div>
                </div>
            `;

            if (!isPrimary) {
                row.querySelector('.balance-split-amount').addEventListener('input', syncBalanceCategoryFirstRowAmount);
            }

            const categorySelect = row.querySelector('.balance-split-category');
            const onCategoryChange = () => handleBalanceCategorySelectChange(rowId);
            categorySelect.addEventListener('change', onCategoryChange);
            categorySelect.addEventListener('input', onCategoryChange);

            return row;
        }

        function resetBalanceCategoryRows(changeType) {
            const list = document.getElementById('balanceCategorySplitList');
            list.textContent = '';
            balanceCategoryRowCounter = 0;
            list.appendChild(createBalanceCategoryRow(changeType, true));
            syncBalanceCategoryFirstRowAmount();
        }

        function addBalanceCategoryRow() {
            if (!pendingBalanceCategoryChange) {
                return;
            }

            const list = document.getElementById('balanceCategorySplitList');
            const row = createBalanceCategoryRow(pendingBalanceCategoryChange.changeType, false);
            list.appendChild(row);
            row.querySelector('.balance-split-category').focus();
            syncBalanceCategoryFirstRowAmount();
        }

        function removeBalanceCategoryRow(rowId) {
            const row = document.querySelector(`#balanceCategorySplitList .balance-split-row[data-row-id="${rowId}"]`);
            if (!row) {
                return;
            }

            row.remove();
            syncBalanceCategoryFirstRowAmount();
        }

        function handleBalanceCategorySelectChange(rowId) {
            const row = document.querySelector(`#balanceCategorySplitList .balance-split-row[data-row-id="${rowId}"]`);
            if (!row) {
                return;
            }

            const select = row.querySelector('.balance-split-category');
            const otherInput = row.querySelector('.balance-split-other');
            if (!select || !otherInput) {
                return;
            }

            const isOther = String(select.value || '').toLowerCase() === 'inne';
            otherInput.classList.toggle('hidden', !isOther);
            otherInput.style.display = isOther ? 'block' : 'none';
            if (!isOther) {
                otherInput.value = '';
                return;
            }
            otherInput.focus();
        }

        function syncBalanceCategoryFirstRowAmount() {
            if (!pendingBalanceCategoryChange) {
                return;
            }

            const rows = Array.from(document.querySelectorAll('#balanceCategorySplitList .balance-split-row'));
            if (rows.length === 0) {
                return;
            }

            let additionalTotal = 0;
            rows.slice(1).forEach(row => {
                const amountInput = row.querySelector('.balance-split-amount');
                const parsed = Number(amountInput.value);
                if (Number.isFinite(parsed) && parsed > 0) {
                    additionalTotal = roundCurrency(additionalTotal + parsed);
                }
            });

            const firstAmount = roundCurrency(pendingBalanceCategoryChange.amount - additionalTotal);
            const firstAmountInput = rows[0].querySelector('.balance-split-amount');
            firstAmountInput.value = firstAmount.toFixed(2);

            const warning = document.getElementById('balanceCategorySplitWarning');
            if (firstAmount < 0) {
                warning.textContent = 'Suma dodatkowych kategorii przekracza całą różnicę. Zmniejsz kwoty.';
                warning.classList.remove('hidden');
            } else {
                warning.textContent = '';
                warning.classList.add('hidden');
            }
        }

        function openBalanceCategoryModal(changeType, amount, newBalance) {
            pendingBalanceCategoryChange = {
                changeType: changeType,
                amount: roundCurrency(amount),
                newBalance: roundCurrency(newBalance)
            };

            const title = changeType === 'expense'
                ? '🧾 Kategoria wydatku'
                : '💵 Kategoria wpływu';
            const prompt = changeType === 'expense'
                ? `Saldo zmniejszyło się o ${formatCurrencyPLN(amount)}. Podziel kwotę na kategorie. Pozycja 1 wylicza się automatycznie.`
                : `Saldo zwiększyło się o ${formatCurrencyPLN(amount)}. Podziel kwotę na kategorie. Pozycja 1 wylicza się automatycznie.`;

            document.getElementById('balanceCategoryTitle').textContent = title;
            document.getElementById('balanceCategoryInfo').textContent = prompt;
            document.getElementById('balanceCategorySplitWarning').classList.add('hidden');
            document.getElementById('balanceCategorySplitWarning').textContent = '';
            resetBalanceCategoryRows(changeType);

            document.getElementById('balanceCategoryModal').classList.add('active');
        }

        function closeBalanceCategoryModal() {
            document.getElementById('balanceCategoryModal').classList.remove('active');
            document.getElementById('balanceCategorySplitList').textContent = '';
            document.getElementById('balanceCategorySplitWarning').classList.add('hidden');
            document.getElementById('balanceCategorySplitWarning').textContent = '';
            pendingBalanceCategoryChange = null;
            balanceCategoryRowCounter = 0;
        }

        function cancelBalanceCategory() {
            closeBalanceCategoryModal();
        }

        function confirmBalanceCategory() {
            if (!pendingBalanceCategoryChange) {
                showToast('Brak danych zmiany salda', 'error');
                return;
            }

            syncBalanceCategoryFirstRowAmount();

            const rows = Array.from(document.querySelectorAll('#balanceCategorySplitList .balance-split-row'));
            if (rows.length === 0) {
                showToast('Dodaj co najmniej jedną kategorię', 'warning');
                return;
            }

            const additionalAmounts = new Map();
            let additionalTotal = 0;
            for (let index = 1; index < rows.length; index += 1) {
                const amountInput = rows[index].querySelector('.balance-split-amount');
                const rawValue = amountInput.value.trim();
                if (!rawValue) {
                    additionalAmounts.set(index, 0);
                    continue;
                }

                const parsed = Number(rawValue);
                if (!Number.isFinite(parsed) || parsed <= 0) {
                    showToast(`Podaj poprawną kwotę w pozycji ${index + 1}`, 'warning');
                    amountInput.focus();
                    return;
                }

                const amountValue = roundCurrency(parsed);
                additionalAmounts.set(index, amountValue);
                additionalTotal = roundCurrency(additionalTotal + amountValue);
            }

            const totalAmount = roundCurrency(pendingBalanceCategoryChange.amount);
            const firstAmount = roundCurrency(totalAmount - additionalTotal);
            if (firstAmount < 0) {
                showToast('Suma dodatkowych kategorii przekracza całą różnicę.', 'warning');
                return;
            }

            const today = formatDateString(new Date());
            const { changeType, newBalance } = pendingBalanceCategoryChange;
            const allocations = [];

            for (let index = 0; index < rows.length; index += 1) {
                const row = rows[index];
                const amountValue = index === 0 ? firstAmount : (additionalAmounts.get(index) || 0);
                if (amountValue <= 0) {
                    continue;
                }

                const categorySelect = row.querySelector('.balance-split-category');
                let finalCategory = normalizeUserText(categorySelect.value);
                if (finalCategory === 'inne') {
                    const otherInput = normalizeUserText(row.querySelector('.balance-split-other').value);
                    if (!otherInput) {
                        showToast(`Wpisz nazwę kategorii "inne" w pozycji ${index + 1}`, 'warning');
                        row.querySelector('.balance-split-other').focus();
                        return;
                    }
                    finalCategory = otherInput;
                }

                allocations.push({
                    amount: amountValue,
                    category: finalCategory || 'inne'
                });
            }

            if (allocations.length === 0) {
                showToast('Brak kwot do zapisania. Uzupełnij podział kategorii.', 'warning');
                return;
            }

            appStorage.setItem(STORAGE_KEYS.BALANCE, newBalance.toString());
            allocations.forEach(allocation => {
                if (changeType === 'expense') {
                    recordExpenseEntry({
                        amount: allocation.amount,
                        category: allocation.category,
                        date: today,
                        source: 'balance-update',
                        name: ''
                    });
                } else {
                    recordIncomeEntry({
                        amount: allocation.amount,
                        category: allocation.category,
                        date: today,
                        source: 'balance-update',
                        name: ''
                    });
                }
            });

            closeBalanceCategoryModal();
            closeBalanceModal();
            loadBalance();
            updateCalculations();
        }

        // Modal state and frequency selectors (provided by controller)

        const {
            openAdminPanel,
            closeAdminPanel,
            downloadBackup,
            restoreBackup,
            changePin
        } = createAdminController({
            adminSuccessDefaultMessage: ADMIN_SUCCESS_DEFAULT_MESSAGE,
            handleUnauthorizedSession,
            showLoginScreen,
            onRestoreStateReset() {
                isAuthenticated = false;
                stateReady = false;
                savePending = false;
                if (saveTimerId) {
                    clearTimeout(saveTimerId);
                    saveTimerId = null;
                }
                appState = sanitizeState({});
            }
        });

        const {
            openIncomeModal,
            closeIncomeModal,
            handleIncomeCategoryChange,
            setIncomeModalMode,
            resetIncomeForm,
            openPaymentModal,
            closePaymentModal,
            handlePaymentCategoryChange,
            setPaymentModalMode,
            resetPaymentForm,
            selectPaymentFrequency,
            selectIncomeFrequency,
            toggleMonth,
            syncMonthButtons
        } = createUiModalsController({
            getEditingIncomeId: () => editingIncomeId,
            setEditingIncomeId: nextValue => {
                editingIncomeId = nextValue;
            },
            getEditingPaymentId: () => editingPaymentId,
            setEditingPaymentId: nextValue => {
                editingPaymentId = nextValue;
            },
            getSelectedIncomeFrequency: () => selectedIncomeFrequency,
            setSelectedIncomeFrequency: nextValue => {
                selectedIncomeFrequency = nextValue;
            },
            getSelectedPaymentFrequency: () => selectedPaymentFrequency,
            setSelectedPaymentFrequency: nextValue => {
                selectedPaymentFrequency = nextValue;
            },
            getSelectedMonths: () => selectedMonths,
            setSelectedMonths: nextValue => {
                selectedMonths = Array.isArray(nextValue) ? nextValue : [];
            }
        });

        // Formatting and utility helpers
        function getCategoryIcon(category, entryType) {
            const normalized = (category || '').toLowerCase();
            const expenseIcons = {
                'jedzenie': '🍽️',
                'paliwo': '⛽',
                'lekarstwa': '💊',
                'suplementy': '💪',
                'ubrania': '👕',
                'zaplanowane płatności': '📅',
                'inne': '✨'
            };
            const incomeIcons = {
                'premia': '🎁',
                'rodzice': '👨‍👩‍👧',
                'najem': '🏠',
                'zaplanowane wpływy': '📅',
                'inne': '✨'
            };

            if (entryType === 'income') {
                return incomeIcons[normalized] || '💵';
            }
            return expenseIcons[normalized] || '🧾';
        }

        function parseStoredJSON(key, fallbackValue) {
            const raw = appStorage.getItem(key);
            if (!raw) {
                return fallbackValue;
            }

            try {
                return JSON.parse(raw);
            } catch {
                return fallbackValue;
            }
        }

        function escapeHtml(value) {
            return String(value ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        function getMonthInputValue(dateValue) {
            const source = dateValue instanceof Date ? dateValue : new Date();
            const year = source.getFullYear();
            const month = String(source.getMonth() + 1).padStart(2, '0');
            return `${year}-${month}`;
        }

        function getMonthFilter(monthValue) {
            if (!/^\d{4}-\d{2}$/.test(monthValue || '')) {
                return null;
            }

            const [yearString, monthString] = monthValue.split('-');
            return {
                year: Number(yearString),
                month: Number(monthString) - 1
            };
        }

        function getEntriesByMonth(entries, monthValue) {
            const filter = getMonthFilter(monthValue);
            if (!filter) {
                return [];
            }

            return entries.filter(entry => {
                const entryDate = parseDateString(entry.date);
                if (Number.isNaN(entryDate.getTime())) {
                    return false;
                }

                return (
                    entryDate.getFullYear() === filter.year &&
                    entryDate.getMonth() === filter.month
                );
            });
        }

        function formatEntryDate(dateString) {
            const parsedDate = parseDateString(dateString);
            if (Number.isNaN(parsedDate.getTime())) {
                return escapeHtml(dateString);
            }
            return formatDateToPolish(dateString);
        }

        function ensureTrackingDataConsistency() {
            const expenseEntries = parseStoredJSON(STORAGE_KEYS.EXPENSE_ENTRIES, []);
            const incomeEntries = parseStoredJSON(STORAGE_KEYS.INCOME_ENTRIES, []);
            appStorage.setItem(STORAGE_KEYS.EXPENSE_ENTRIES, JSON.stringify(expenseEntries));
            appStorage.setItem(STORAGE_KEYS.INCOME_ENTRIES, JSON.stringify(incomeEntries));
            appStorage.setItem(STORAGE_KEYS.EXPENSE_TOTALS, JSON.stringify(buildCategoryTotals(expenseEntries)));
            appStorage.setItem(STORAGE_KEYS.INCOME_TOTALS, JSON.stringify(buildCategoryTotals(incomeEntries)));
        }

        function recordExpenseEntry({ amount, category, date, source, name }) {
            const entries = parseStoredJSON(STORAGE_KEYS.EXPENSE_ENTRIES, []);
            const categoryName = normalizeUserText(category) || 'inne';
            entries.push({
                id: Date.now() + Math.floor(Math.random() * 1000),
                amount: roundCurrency(amount),
                category: categoryName,
                date: date || formatDateString(new Date()),
                source: source || 'balance-update',
                name: normalizeUserText(name),
                icon: getCategoryIcon(categoryName, 'expense')
            });
            appStorage.setItem(STORAGE_KEYS.EXPENSE_ENTRIES, JSON.stringify(entries));
            appStorage.setItem(STORAGE_KEYS.EXPENSE_TOTALS, JSON.stringify(buildCategoryTotals(entries)));
            if (document.getElementById('expenseAnalysisModal').classList.contains('active')) {
                renderExpenseAnalysis();
            }
        }

        function recordIncomeEntry({ amount, category, date, source, name }) {
            const entries = parseStoredJSON(STORAGE_KEYS.INCOME_ENTRIES, []);
            const categoryName = normalizeUserText(category) || 'inne';
            entries.push({
                id: Date.now() + Math.floor(Math.random() * 1000),
                amount: roundCurrency(amount),
                category: categoryName,
                date: date || formatDateString(new Date()),
                source: source || 'balance-update',
                name: normalizeUserText(name),
                icon: getCategoryIcon(categoryName, 'income')
            });
            appStorage.setItem(STORAGE_KEYS.INCOME_ENTRIES, JSON.stringify(entries));
            appStorage.setItem(STORAGE_KEYS.INCOME_TOTALS, JSON.stringify(buildCategoryTotals(entries)));
            if (document.getElementById('incomeAnalysisModal').classList.contains('active')) {
                renderIncomeAnalysis();
            }
        }

        function normalizeUserText(value, maxLength = MAX_TEXT_LENGTH) {
            return String(value || '').trim().slice(0, maxLength);
        }

        function getPlannedEntryCategoryOptions(type) {
            return type === 'income' ? INCOME_CATEGORY_OPTIONS : EXPENSE_CATEGORY_OPTIONS;
        }

        function applyPlannedEntryCategoryToForm({ type, selectId, otherInputId, category }) {
            const select = document.getElementById(selectId);
            const otherInput = document.getElementById(otherInputId);
            if (!select) {
                return;
            }

            const rawCategory = normalizeUserText(category);
            const normalizedCategory = rawCategory.toLowerCase();
            const allowedValues = new Set(getPlannedEntryCategoryOptions(type).map(option => option.value));
            const isPresetCategory = allowedValues.has(normalizedCategory);

            select.value = isPresetCategory ? normalizedCategory : 'inne';
            if (otherInput) {
                otherInput.value = isPresetCategory ? '' : rawCategory;
            }
        }

        function syncPlannedEntryNameWithCategory({ selectId, otherInputId, nameInputId }) {
            const nameInput = document.getElementById(nameInputId);
            const select = document.getElementById(selectId);
            if (!nameInput || !select) {
                return '';
            }

            const selectedCategory = normalizeUserText(select.value).toLowerCase() || 'inne';
            if (selectedCategory === 'inne') {
                const customCategory = normalizeUserText(document.getElementById(otherInputId)?.value);
                nameInput.value = customCategory;
                return customCategory;
            }

            const optionLabel = normalizeUserText(
                select.options[select.selectedIndex]?.textContent || selectedCategory
            );
            nameInput.value = optionLabel;
            return optionLabel;
        }

        function resolvePlannedEntryCategory({ selectId, otherInputId, label }) {
            const select = document.getElementById(selectId);
            if (!select) {
                return 'inne';
            }

            const selectedCategory = normalizeUserText(select.value).toLowerCase() || 'inne';
            if (selectedCategory !== 'inne') {
                return selectedCategory;
            }

            const otherInput = document.getElementById(otherInputId);
            const customCategory = normalizeUserText(otherInput?.value);
            if (!customCategory) {
                showToast(`Wpisz nazwę kategorii dla ${label}`, 'warning');
                otherInput?.focus();
                return null;
            }

            return customCategory;
        }

        function formatDateInput(input) {
            const digits = input.value.replace(/\D/g, '').slice(0, 8);
            const parts = [];

            if (digits.length > 0) {
                parts.push(digits.slice(0, 2));
            }
            if (digits.length > 2) {
                parts.push(digits.slice(2, 4));
            }
            if (digits.length > 4) {
                parts.push(digits.slice(4, 8));
            }

            input.value = parts.join('/');
        }

        function normalizeDateInput(input) {
            const isoDate = parseUserDateToISO(input.value);
            if (!isoDate) {
                return;
            }

            input.value = formatDateToPolish(isoDate);
            syncNativeDatePickerFromTextInput(input);
        }

        function syncNativeDatePickerFromTextInput(textInput) {
            if (!textInput) {
                return;
            }

            const pickerId = textInput.dataset?.pickerId;
            if (!pickerId) {
                return;
            }

            const nativePicker = document.getElementById(pickerId);
            if (!nativePicker) {
                return;
            }

            const isoDate = parseUserDateToISO(textInput.value);
            nativePicker.value = isoDate || '';
        }

        function applyNativeDatePickerToTextInput(textInput, nativePicker) {
            if (!textInput || !nativePicker || !nativePicker.value) {
                return;
            }

            textInput.value = formatDateToPolish(nativePicker.value);
        }

        function openDatePickerForTextInput(textInputId, nativePickerId) {
            const textInput = document.getElementById(textInputId);
            const nativePicker = document.getElementById(nativePickerId);
            if (!textInput || !nativePicker) {
                return;
            }

            syncNativeDatePickerFromTextInput(textInput);
            try {
                if (typeof nativePicker.showPicker === 'function') {
                    nativePicker.showPicker();
                    return;
                }
            } catch {
                // Fallback below for browsers without showPicker support/permission
            }

            nativePicker.focus();
            nativePicker.click();
        }

        function setupDatePickerControls() {
            const pairs = [
                {
                    textInputId: 'incomeDate',
                    buttonId: 'incomeDatePickerBtn',
                    nativePickerId: 'incomeDateNative'
                },
                {
                    textInputId: 'paymentDate',
                    buttonId: 'paymentDatePickerBtn',
                    nativePickerId: 'paymentDateNative'
                }
            ];

            pairs.forEach(({ textInputId, buttonId, nativePickerId }) => {
                const textInput = document.getElementById(textInputId);
                const button = document.getElementById(buttonId);
                const nativePicker = document.getElementById(nativePickerId);
                if (!textInput || !button || !nativePicker) {
                    return;
                }

                button.addEventListener('click', () => openDatePickerForTextInput(textInputId, nativePickerId));
                nativePicker.addEventListener('change', () => applyNativeDatePickerToTextInput(textInput, nativePicker));
            });
        }

        // Scheduling, occurrences, and settlement helpers (provided by module)

        // Server settlement actions
        async function runServerSettlement(reason) {
            let data;
            try {
                data = await apiRunSettlement(normalizeUserText(reason || 'manual'));
            } catch (error) {
                if (error?.status === 401) {
                    handleUnauthorizedSession('Sesja wygasła. Zaloguj się ponownie.');
                }
                throw error;
            }

            if (data?.state && typeof data.state === 'object') {
                appState = sanitizeState(data.state);
            } else {
                await fetchStateFromServer();
            }
            return data;
        }

        async function markPaymentAsPaid(id, occurrenceDateString) {
            try {
                await runServerSettlement(`manual-payment-${id}-${occurrenceDateString}`);
                loadData();
            } catch (error) {
                console.error('Błąd księgowania płatności po stronie serwera:', error);
                showToast('Nie udało się oznaczyć płatności jako opłaconej.', 'error');
            }
        }

        async function markIncomeAsReceived(id, occurrenceDateString) {
            try {
                await runServerSettlement(`manual-income-${id}-${occurrenceDateString}`);
                loadData();
            } catch (error) {
                console.error('Błąd księgowania wpływu po stronie serwera:', error);
                showToast('Nie udało się oznaczyć wpływu jako zaksięgowanego.', 'error');
            }
        }

        // Calendar navigation and analysis views (provided by controllers)

        // Core CRUD, rendering, and calculations
        function startNoonWatcher() {
            return;
        }

        function openEditIncome(id) {
            const incomes = parseStoredJSON(STORAGE_KEYS.INCOMES, []);
            const income = incomes.find(item => item.id === id);

            if (!income) {
                return;
            }

            editingIncomeId = id;
            setIncomeModalMode(true);
            document.getElementById('incomeName').value = income.name;
            document.getElementById('incomeAmount').value = income.amount;
            document.getElementById('incomeDate').value = formatDateToPolish(income.date);
            applyPlannedEntryCategoryToForm({
                type: 'income',
                selectId: 'incomeCategory',
                otherInputId: 'incomeCategoryOther',
                category: income.category || 'inne'
            });
            handleIncomeCategoryChange();
            selectIncomeFrequency(income.frequency || 'once');
            document.getElementById('incomeModal').classList.add('active');
        }

        function openEditPayment(id) {
            const payments = parseStoredJSON(STORAGE_KEYS.PAYMENTS, []);
            const payment = payments.find(item => item.id === id);

            if (!payment) {
                return;
            }

            editingPaymentId = id;
            setPaymentModalMode(true);
            document.getElementById('paymentName').value = payment.name;
            document.getElementById('paymentAmount').value = payment.amount;
            applyPlannedEntryCategoryToForm({
                type: 'expense',
                selectId: 'paymentCategory',
                otherInputId: 'paymentCategoryOther',
                category: payment.category || payment.name || 'inne'
            });
            handlePaymentCategoryChange();
            document.getElementById('paymentDate').value = formatDateToPolish(payment.date);
            selectPaymentFrequency(payment.frequency || 'once');
            selectedMonths = payment.frequency === 'selected' && Array.isArray(payment.months) ? [...payment.months] : [];
            syncMonthButtons();
            document.getElementById('paymentModal').classList.add('active');
        }

        function updateBalance() {
            const rawValue = document.getElementById('balanceInput').value.trim();
            if (!rawValue) {
                showToast('Podaj stan konta', 'warning');
                return;
            }

            const newBalance = parseFloat(rawValue);
            if (Number.isNaN(newBalance)) {
                showToast('Podaj poprawną kwotę', 'warning');
                return;
            }

            const currentBalance = parseFloat(appStorage.getItem(STORAGE_KEYS.BALANCE)) || 0;
            const difference = roundCurrency(newBalance - currentBalance);

            if (difference === 0) {
                closeBalanceModal();
                return;
            }

            if (difference < 0) {
                openBalanceCategoryModal('expense', Math.abs(difference), newBalance);
                return;
            }

            openBalanceCategoryModal('income', difference, newBalance);
        }

        function validateEntryCommonFields({ name, amount, rawDate }) {
            if (!name || Number.isNaN(amount) || !rawDate) {
                showToast('Wypełnij wszystkie pola', 'warning');
                return { ok: false, date: null };
            }

            const date = parseUserDateToISO(rawDate);
            if (!date) {
                showToast('Podaj poprawną datę w formacie dd/mm/yyyy', 'warning');
                return { ok: false, date: null };
            }

            return { ok: true, date };
        }

        function generateEntryId() {
            return Date.now() + Math.floor(Math.random() * 1000);
        }

        function saveEntry({
            type,
            editingId,
            nameInputId,
            amountInputId,
            dateInputId,
            frequency,
            selectedMonthsForPayments,
            category
        }) {
            const name = normalizeUserText(document.getElementById(nameInputId).value);
            const amount = parseFloat(document.getElementById(amountInputId).value);
            const rawDate = document.getElementById(dateInputId).value;

            const { ok, date } = validateEntryCommonFields({ name, amount, rawDate });
            if (!ok) {
                return false;
            }

            if (type === 'expense' && frequency === 'selected' && selectedMonthsForPayments.length === 0) {
                showToast('Wybierz co najmniej jeden miesiąc', 'warning');
                return false;
            }

            const storageKey = type === 'income' ? STORAGE_KEYS.INCOMES : STORAGE_KEYS.PAYMENTS;
            const existingEntries = parseStoredJSON(storageKey, []);

            let months = [];
            if (type === 'expense' && frequency === 'selected') {
                months = [...selectedMonthsForPayments].sort((a, b) => a - b);
            }

            const updatedEntries = editingId !== null
                ? existingEntries.map(entry => {
                    if (entry.id !== editingId) {
                        return entry;
                    }

                    const nextEntry = {
                        ...entry,
                        name,
                        amount,
                        date,
                        frequency,
                        ...(type === 'expense' ? { months } : {}),
                        category: category || 'inne',
                        type
                    };

                    return nextEntry;
                })
                : [
                    ...existingEntries,
                    (() => {
                        const baseEntry = {
                            id: generateEntryId(),
                            name,
                            amount,
                            date,
                            frequency,
                            ...(type === 'expense' ? { months } : {}),
                            category: category || 'inne',
                            type
                        };

                        return baseEntry;
                    })()
                ];

            appStorage.setItem(storageKey, JSON.stringify(updatedEntries));
            return true;
        }

        function saveIncome() {
            const incomeCategoryValue = resolvePlannedEntryCategory({
                selectId: 'incomeCategory',
                otherInputId: 'incomeCategoryOther',
                label: 'wpływu'
            });
            if (!incomeCategoryValue) {
                return;
            }
            syncPlannedEntryNameWithCategory({
                selectId: 'incomeCategory',
                otherInputId: 'incomeCategoryOther',
                nameInputId: 'incomeName'
            });

            const success = saveEntry({
                type: 'income',
                editingId: editingIncomeId,
                nameInputId: 'incomeName',
                amountInputId: 'incomeAmount',
                dateInputId: 'incomeDate',
                frequency: selectedIncomeFrequency,
                selectedMonthsForPayments: [],
                category: incomeCategoryValue
            });

            if (!success) {
                return;
            }

            closeIncomeModal();
            loadIncomes();
            updateCalculations();
        }

        function savePayment() {
            const paymentCategoryValue = resolvePlannedEntryCategory({
                selectId: 'paymentCategory',
                otherInputId: 'paymentCategoryOther',
                label: 'wydatku'
            });
            if (!paymentCategoryValue) {
                return;
            }

            syncPlannedEntryNameWithCategory({
                selectId: 'paymentCategory',
                otherInputId: 'paymentCategoryOther',
                nameInputId: 'paymentName'
            });

            const success = saveEntry({
                type: 'expense',
                editingId: editingPaymentId,
                nameInputId: 'paymentName',
                amountInputId: 'paymentAmount',
                dateInputId: 'paymentDate',
                frequency: selectedPaymentFrequency,
                selectedMonthsForPayments: selectedMonths,
                category: paymentCategoryValue
            });

            if (!success) {
                return;
            }

            closePaymentModal();
            loadPayments();
            updateCalculations();
        }

        function addIncome() {
            saveIncome();
        }

        function addPayment() {
            savePayment();
        }

        // List rendering for payments/incomes (provided by render controller)

        // Delete payment/income actions (provided by actions controller)

        // Admin actions: backup and PIN
        const {
            deletePaymentFromModal,
            deleteIncomeFromModal,
            exposePublicActions
        } = createActionsController({
            login,
            logout,
            changeViewMonth,
            goToCurrentMonth,
            toggleMonthToDateCard,
            togglePreviousMonthCard,
            openAdminPanel,
            closeAdminPanel,
            openExpenseAnalysisModal,
            closeExpenseAnalysisModal,
            openIncomeAnalysisModal,
            closeIncomeAnalysisModal,
            openIncomeAnalysisFromExpense,
            openTenantPaymentsModal,
            closeTenantPaymentsModal,
            changeTenantPaymentsMonth,
            renderTenantPayments,
            renderExpenseAnalysis,
            renderIncomeAnalysis,
            toggleExpenseDetails,
            closeExpenseEditModal,
            saveExpenseAmountFromAnalysis,
            editExpenseAmountFromAnalysis,
            openBalanceModal,
            closeBalanceModal,
            updateBalance,
            closeBalanceCategoryModal,
            addBalanceCategoryRow,
            removeBalanceCategoryRow,
            handleBalanceCategorySelectChange,
            cancelBalanceCategory,
            confirmBalanceCategory,
            openIncomeModal,
            closeIncomeModal,
            openPaymentModal,
            closePaymentModal,
            handleIncomeCategoryChange,
            handlePaymentCategoryChange,
            formatDateInput,
            normalizeDateInput,
            selectIncomeFrequency,
            selectPaymentFrequency,
            toggleMonth,
            saveTenantProfiles,
            toggleTenantDashboardPaid,
            markTenantAsPaid,
            undoTenantPayment,
            getEditingIncomeId: () => editingIncomeId,
            getEditingPaymentId: () => editingPaymentId,
            appStorage,
            storageKeys: STORAGE_KEYS,
            loadIncomes,
            loadPayments,
            updateCalculations,
            saveIncome,
            savePayment,
            changePin,
            downloadBackup,
            restoreBackup,
            installApp
        });

        exposePublicActions(window);

        // Global keyboard shortcuts for modals and forms
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                if (document.getElementById('incomeModal')?.classList.contains('active')) {
                    closeIncomeModal();
                }
                if (document.getElementById('paymentModal')?.classList.contains('active')) {
                    closePaymentModal();
                }
                if (document.getElementById('balanceModal')?.classList.contains('active')) {
                    closeBalanceModal();
                }
                if (document.getElementById('balanceCategoryModal')?.classList.contains('active')) {
                    closeBalanceCategoryModal();
                }
                if (document.getElementById('expenseAnalysisModal')?.classList.contains('active')) {
                    closeExpenseAnalysisModal();
                }
                if (document.getElementById('incomeAnalysisModal')?.classList.contains('active')) {
                    closeIncomeAnalysisModal();
                }
                if (document.getElementById('tenantPaymentsModal')?.classList.contains('active')) {
                    closeTenantPaymentsModal();
                }
            }

            if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
                if (document.getElementById('incomeModal')?.classList.contains('active')) {
                    e.preventDefault();
                    saveIncome();
                } else if (document.getElementById('paymentModal')?.classList.contains('active')) {
                    e.preventDefault();
                    savePayment();
                }
            }
        });

        // Bootstrapping
        document.getElementById('pin4').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                login();
            }
        });

        setupDatePickerControls();
        document.getElementById('incomeCategory')?.addEventListener('change', handleIncomeCategoryChange);
        document.getElementById('paymentCategory')?.addEventListener('change', handlePaymentCategoryChange);
        handleIncomeCategoryChange();
        handlePaymentCategoryChange();
        setupPwaInstallPrompt();
        registerServiceWorker();
        initializeStorage();
