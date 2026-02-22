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
import { showToast } from './js/toast.js';
import { createPwaController } from './js/pwa.js';
import { createAdminController } from './js/admin.js';
import { createRenderController } from './js/render.js';
import { createAnalysisController } from './js/analysis.js';
import { createUiModalsController } from './js/ui-modals.js';
import { createActionsController } from './js/actions.js';
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
            INCOME_TOTALS: 'budget_income_totals'
        };
        const ADMIN_SUCCESS_DEFAULT_MESSAGE = 'PIN został pomyślnie zmieniony!';
        const MAX_TEXT_LENGTH = 120;
        const CLIENT_DEPRECATED_PIN_VALUE = '__deprecated__';

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
            incomeCategoryTotals: {}
        };

        // State sanitization and migration
        function sanitizeState(rawState) {
            const version = Number(rawState && rawState.version);
            const balance = Number(rawState && rawState.balance);
            const sanitizeTotals = (rawTotals) => {
                if (!rawTotals || typeof rawTotals !== 'object' || Array.isArray(rawTotals)) {
                    return {};
                }

                const cleaned = {};
                Object.entries(rawTotals).forEach(([category, value]) => {
                    const parsed = Number(value);
                    if (Number.isFinite(parsed)) {
                        cleaned[String(category)] = Math.round(parsed * 100) / 100;
                    }
                });
                return cleaned;
            };

            const sanitizeEntries = (rawEntries) => {
                if (!Array.isArray(rawEntries)) {
                    return [];
                }

                return rawEntries
                    .filter(entry => entry && typeof entry === 'object')
                    .map(entry => {
                        const parsedAmount = Number(entry.amount);
                        const amount = Number.isFinite(parsedAmount) ? Math.round(parsedAmount * 100) / 100 : 0;
                        return {
                            id: Number.isFinite(Number(entry.id)) ? Number(entry.id) : Date.now(),
                            amount: amount,
                            category: typeof entry.category === 'string' && entry.category.trim() ? entry.category.trim() : 'inne',
                            date: typeof entry.date === 'string' && entry.date ? entry.date : formatDateString(new Date()),
                            source: typeof entry.source === 'string' && entry.source ? entry.source : 'balance-update',
                            name: typeof entry.name === 'string' ? entry.name : '',
                            icon: typeof entry.icon === 'string' ? entry.icon : ''
                        };
                    });
            };

            return {
                pin: CLIENT_DEPRECATED_PIN_VALUE,
                version: Number.isFinite(version) && version > 0 ? Math.trunc(version) : 1,
                balance: Number.isFinite(balance) ? balance : 0,
                payments: Array.isArray(rawState?.payments) ? rawState.payments : [],
                incomes: Array.isArray(rawState?.incomes) ? rawState.incomes : [],
                expenseEntries: sanitizeEntries(rawState?.expenseEntries),
                incomeEntries: sanitizeEntries(rawState?.incomeEntries),
                expenseCategoryTotals: sanitizeTotals(rawState?.expenseCategoryTotals),
                incomeCategoryTotals: sanitizeTotals(rawState?.incomeCategoryTotals)
            };
        }

        function isStateEffectivelyEmpty(state) {
            return (
                Number(state.version) === 1 &&
                Number(state.balance) === 0 &&
                Array.isArray(state.payments) &&
                state.payments.length === 0 &&
                Array.isArray(state.incomes) &&
                state.incomes.length === 0 &&
                Array.isArray(state.expenseEntries) &&
                state.expenseEntries.length === 0 &&
                Array.isArray(state.incomeEntries) &&
                state.incomeEntries.length === 0 &&
                Object.keys(state.expenseCategoryTotals || {}).length === 0 &&
                Object.keys(state.incomeCategoryTotals || {}).length === 0
            );
        }

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
                }

                queueStateSave();
            }
        };

        const {
            updateViewMonthLabel,
            changeViewMonth,
            goToCurrentMonth,
            loadBalance,
            updateCalculations
        } = createRenderController({
            getCurrentViewDate: () => currentViewDate,
            setCurrentViewDate: nextDate => {
                currentViewDate = nextDate;
            },
            loadPayments,
            loadIncomes,
            appStorage,
            storageKeys: STORAGE_KEYS,
            normalizeDate,
            getPaymentOccurrenceForMonth,
            isOccurrencePaid,
            formatCurrencyPLN
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
            const isOther = select.value === 'inne';
            otherInput.classList.toggle('hidden', !isOther);
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
            setIncomeModalMode,
            resetIncomeForm,
            openPaymentModal,
            closePaymentModal,
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

        function buildCategoryTotals(entries) {
            const totals = {};
            entries.forEach(entry => {
                const category = entry.category || 'inne';
                totals[category] = roundCurrency((totals[category] || 0) + (Number(entry.amount) || 0));
            });
            return totals;
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
            const stored = appStorage.getItem(STORAGE_KEYS.INCOMES);
            const incomes = stored ? JSON.parse(stored) : [];
            const income = incomes.find(item => item.id === id);

            if (!income) {
                return;
            }

            editingIncomeId = id;
            setIncomeModalMode(true);
            document.getElementById('incomeName').value = income.name;
            document.getElementById('incomeAmount').value = income.amount;
            document.getElementById('incomeDate').value = formatDateToPolish(income.date);
            selectIncomeFrequency(income.frequency || 'once');
            document.getElementById('incomeModal').classList.add('active');
        }

        function openEditPayment(id) {
            const stored = appStorage.getItem(STORAGE_KEYS.PAYMENTS);
            const payments = stored ? JSON.parse(stored) : [];
            const payment = payments.find(item => item.id === id);

            if (!payment) {
                return;
            }

            editingPaymentId = id;
            setPaymentModalMode(true);
            document.getElementById('paymentName').value = payment.name;
            document.getElementById('paymentAmount').value = payment.amount;
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

        function saveIncome() {
            const name = normalizeUserText(document.getElementById('incomeName').value);
            const amount = parseFloat(document.getElementById('incomeAmount').value);
            const rawDate = document.getElementById('incomeDate').value;
            const date = parseUserDateToISO(rawDate);

            if (!name || Number.isNaN(amount) || !rawDate) {
                showToast('Wypełnij wszystkie pola', 'warning');
                return;
            }

            if (!date) {
                showToast('Podaj poprawną datę w formacie dd/mm/yyyy', 'warning');
                return;
            }

            let incomes = [];
            const stored = appStorage.getItem(STORAGE_KEYS.INCOMES);
            if (stored) {
                incomes = JSON.parse(stored);
            }

            if (editingIncomeId !== null) {
                incomes = incomes.map(income => {
                    if (income.id !== editingIncomeId) {
                        return income;
                    }

                    return {
                        ...income,
                        name: name,
                        amount: amount,
                        date: date,
                        frequency: selectedIncomeFrequency,
                        type: 'income'
                    };
                });
            } else {
                incomes.push({
                    id: Date.now(),
                    name: name,
                    amount: amount,
                    date: date,
                    frequency: selectedIncomeFrequency,
                    type: 'income'
                });
            }

            appStorage.setItem(STORAGE_KEYS.INCOMES, JSON.stringify(incomes));

            closeIncomeModal();
            loadIncomes();
            updateCalculations();
        }

        function savePayment() {
            const name = normalizeUserText(document.getElementById('paymentName').value);
            const amount = parseFloat(document.getElementById('paymentAmount').value);
            const rawDate = document.getElementById('paymentDate').value;
            const date = parseUserDateToISO(rawDate);

            if (!name || Number.isNaN(amount) || !rawDate) {
                showToast('Wypełnij wszystkie pola', 'warning');
                return;
            }

            if (!date) {
                showToast('Podaj poprawną datę w formacie dd/mm/yyyy', 'warning');
                return;
            }

            if (selectedPaymentFrequency === 'selected' && selectedMonths.length === 0) {
                showToast('Wybierz co najmniej jeden miesiąc', 'warning');
                return;
            }

            const months = selectedPaymentFrequency === 'selected'
                ? [...selectedMonths].sort((a, b) => a - b)
                : [];

            let payments = [];
            const stored = appStorage.getItem(STORAGE_KEYS.PAYMENTS);
            if (stored) {
                payments = JSON.parse(stored);
            }

            if (editingPaymentId !== null) {
                payments = payments.map(payment => {
                    if (payment.id !== editingPaymentId) {
                        return payment;
                    }

                    return {
                        ...payment,
                        name: name,
                        amount: amount,
                        date: date,
                        frequency: selectedPaymentFrequency,
                        months: months,
                        type: 'expense'
                    };
                });
            } else {
                payments.push({
                    id: Date.now(),
                    name: name,
                    amount: amount,
                    date: date,
                    frequency: selectedPaymentFrequency,
                    months: months,
                    type: 'expense'
                });
            }

            appStorage.setItem(STORAGE_KEYS.PAYMENTS, JSON.stringify(payments));

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

        function loadIncomes() {
            const stored = appStorage.getItem(STORAGE_KEYS.INCOMES);
            const incomes = stored ? JSON.parse(stored) : [];
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

            // Update next income countdown
            if (nextIncome) {
                const nextDate = parseDateString(nextIncome.date);
                
                const diffTime = nextDate - today;
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                document.getElementById('daysToIncome').textContent = diffDays >= 0 ? diffDays + ' dni' : '0 dni';
                document.getElementById('nextIncomeDate').textContent = 'Wpływ: ' + formatDateToPolish(nextIncome.date);
            } else {
                document.getElementById('daysToIncome').textContent = '-- dni';
                document.getElementById('nextIncomeDate').textContent = 'Brak zaplanowanych wpływów';
            }
        }

        function loadPayments() {
            const stored = appStorage.getItem(STORAGE_KEYS.PAYMENTS);
            const payments = stored ? JSON.parse(stored) : [];
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

        function deletePayment(id) {
            const stored = appStorage.getItem(STORAGE_KEYS.PAYMENTS);
            let payments = stored ? JSON.parse(stored) : [];
            const payment = payments.find(p => p.id === id);
            if (!payment) {
                return false;
            }

            const isRecurring = payment.frequency !== 'once';
            const shouldDelete = confirm(isRecurring
                ? 'Usunąć całą serię płatności?'
                : 'Usunąć tę płatność?');
            if (!shouldDelete) {
                return false;
            }

            payments = payments.filter(p => p.id !== id);
            appStorage.setItem(STORAGE_KEYS.PAYMENTS, JSON.stringify(payments));
            loadPayments();
            updateCalculations();
            return true;
        }

        function deleteIncome(id) {
            const stored = appStorage.getItem(STORAGE_KEYS.INCOMES);
            let incomes = stored ? JSON.parse(stored) : [];
            const income = incomes.find(i => i.id === id);
            if (!income) {
                return false;
            }

            const isRecurring = income.frequency !== 'once';
            const shouldDelete = confirm(isRecurring
                ? 'Usunąć całą serię wpływów?'
                : 'Usunąć ten wpływ?');
            if (!shouldDelete) {
                return false;
            }

            incomes = incomes.filter(i => i.id !== id);
            appStorage.setItem(STORAGE_KEYS.INCOMES, JSON.stringify(incomes));
            loadIncomes();
            updateCalculations();
            return true;
        }

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
            openAdminPanel,
            closeAdminPanel,
            openExpenseAnalysisModal,
            closeExpenseAnalysisModal,
            openIncomeAnalysisModal,
            closeIncomeAnalysisModal,
            openIncomeAnalysisFromExpense,
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
            cancelBalanceCategory,
            confirmBalanceCategory,
            openIncomeModal,
            closeIncomeModal,
            openPaymentModal,
            closePaymentModal,
            formatDateInput,
            normalizeDateInput,
            selectIncomeFrequency,
            selectPaymentFrequency,
            toggleMonth,
            getEditingIncomeId: () => editingIncomeId,
            getEditingPaymentId: () => editingPaymentId,
            deleteIncome,
            deletePayment,
            saveIncome,
            savePayment,
            changePin,
            downloadBackup,
            restoreBackup,
            installApp
        });

        exposePublicActions(window);

        // Bootstrapping
        document.getElementById('pin4').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                login();
            }
        });

        setupPwaInstallPrompt();
        registerServiceWorker();
        initializeStorage();
