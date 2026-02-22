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
        let editingExpenseEntryId = null;
        let pendingBalanceCategoryChange = null;
        let balanceCategoryRowCounter = 0;
        let expenseDetailsVisible = false;
        let currentViewDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        let noonWatcherStarted = false;
        let isAuthenticated = false;
        let stateReady = false;
        let saveTimerId = null;
        let saveInProgress = false;
        let savePending = false;
        let expenseAnalysisRequestId = 0;
        let incomeAnalysisRequestId = 0;
        let deferredInstallPrompt = null;
        let appState = {
            pin: '1234',
            version: 1,
            balance: 0,
            payments: [],
            incomes: [],
            expenseEntries: [],
            incomeEntries: [],
            expenseCategoryTotals: {},
            incomeCategoryTotals: {}
        };

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
                pin: typeof rawState?.pin === 'string' && rawState.pin.length > 0 ? rawState.pin : '1234',
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
                state.pin === '1234' &&
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
                    pin: legacyPin || '1234',
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

        async function fetchStateFromServer() {
            const response = await fetch('/api/state', {
                method: 'GET',
                headers: { 'Accept': 'application/json' },
                cache: 'no-store',
                credentials: 'same-origin'
            });

            if (!response.ok) {
                let details = {};
                try {
                    details = await response.json();
                } catch {
                    details = {};
                }
                const error = new Error(`GET /api/state failed: ${response.status}`);
                error.status = response.status;
                error.details = details;
                throw error;
            }

            const data = await response.json();
            appState = sanitizeState(data);
        }

        async function saveStateToServer() {
            const payload = JSON.parse(JSON.stringify(appState));
            delete payload.pin;
            payload.version = Number(appState.version) || 1;
            const response = await fetch('/api/state', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                credentials: 'same-origin'
            });

            if (!response.ok) {
                let details = {};
                try {
                    details = await response.json();
                } catch {
                    details = {};
                }
                const error = new Error(`PUT /api/state failed: ${response.status}`);
                error.status = response.status;
                error.details = details;
                throw error;
            }

            const result = await response.json().catch(() => ({}));
            const updatedVersion = Number(result?.state?.version);
            if (Number.isFinite(updatedVersion) && updatedVersion > 0) {
                appState.version = Math.trunc(updatedVersion);
            }
        }

        async function fetchAuthStatus() {
            const response = await fetch('/api/auth/status', {
                method: 'GET',
                headers: { 'Accept': 'application/json' },
                cache: 'no-store',
                credentials: 'same-origin'
            });

            if (!response.ok) {
                const error = new Error(`GET /api/auth/status failed: ${response.status}`);
                error.status = response.status;
                throw error;
            }

            return response.json();
        }

        function isAndroidMobile() {
            return /Android/i.test(navigator.userAgent || '');
        }

        function isStandaloneMode() {
            return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
        }

        function updateInstallButtonVisibility() {
            const installButton = document.getElementById('installAppBtn');
            const mainAppVisible = !document.getElementById('mainApp').classList.contains('hidden');
            const shouldShow = Boolean(
                installButton &&
                mainAppVisible &&
                isAndroidMobile() &&
                !isStandaloneMode() &&
                deferredInstallPrompt
            );
            installButton.classList.toggle('visible', shouldShow);
        }

        function setupPwaInstallPrompt() {
            window.addEventListener('beforeinstallprompt', event => {
                event.preventDefault();
                deferredInstallPrompt = event;
                updateInstallButtonVisibility();
            });

            window.addEventListener('appinstalled', () => {
                deferredInstallPrompt = null;
                updateInstallButtonVisibility();
            });
        }

        async function installApp() {
            if (!deferredInstallPrompt) {
                alert('Aby dodać aplikację, użyj menu Chrome i wybierz "Dodaj do ekranu głównego".');
                return;
            }

            deferredInstallPrompt.prompt();
            try {
                await deferredInstallPrompt.userChoice;
            } catch (error) {
                console.error('Prompt instalacji został anulowany:', error);
            }
            deferredInstallPrompt = null;
            updateInstallButtonVisibility();
        }

        function registerServiceWorker() {
            if (!('serviceWorker' in navigator)) {
                return;
            }

            window.addEventListener('load', () => {
                navigator.serviceWorker.register('/service-worker.js').catch(error => {
                    console.error('Nie udało się zarejestrować service worker:', error);
                });
            });
        }

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
                        alert('Wykryto błąd walidacji lub wersji danych. Stan został odświeżony z serwera.');
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
                    alert('Dane zostały zmienione w innej sesji. Odświeżono aktualny stan z serwera.');
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

        const appStorage = {
            getItem(key) {
                if (key === STORAGE_KEYS.PIN) {
                    return appState.pin;
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
                    appState.pin = String(value || '1234');
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

        async function initializeStorage() {
            try {
                const authStatus = await fetchAuthStatus();
                isAuthenticated = authStatus?.authenticated === true;
            } catch (error) {
                console.error('Nie udało się sprawdzić statusu autoryzacji:', error);
                alert('Brak połączenia z API. Uruchom serwer aplikacji (server.py).');
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
                ? `Saldo zmniejszyło się o ${amount.toFixed(2)} zł. Podziel kwotę na kategorie. Pozycja 1 wylicza się automatycznie.`
                : `Saldo zwiększyło się o ${amount.toFixed(2)} zł. Podziel kwotę na kategorie. Pozycja 1 wylicza się automatycznie.`;

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
                alert('Brak danych zmiany salda');
                return;
            }

            syncBalanceCategoryFirstRowAmount();

            const rows = Array.from(document.querySelectorAll('#balanceCategorySplitList .balance-split-row'));
            if (rows.length === 0) {
                alert('Dodaj co najmniej jedną kategorię');
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
                    alert(`Podaj poprawną kwotę w pozycji ${index + 1}`);
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
                alert('Suma dodatkowych kategorii przekracza całą różnicę.');
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
                        alert(`Wpisz nazwę kategorii "inne" w pozycji ${index + 1}`);
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
                alert('Brak kwot do zapisania. Uzupełnij podział kategorii.');
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

        function openIncomeModal() {
            editingIncomeId = null;
            setIncomeModalMode(false);
            resetIncomeForm();
            document.getElementById('incomeModal').classList.add('active');
        }

        function closeIncomeModal() {
            document.getElementById('incomeModal').classList.remove('active');
            editingIncomeId = null;
            setIncomeModalMode(false);
            resetIncomeForm();
        }

        function setIncomeModalMode(isEdit) {
            document.getElementById('incomeModalTitle').textContent = isEdit ? '💵 Edytuj wpływ' : '💵 Dodaj wpływ';
            document.getElementById('incomeSubmitBtn').textContent = isEdit ? 'Zapisz' : 'Dodaj';
            document.getElementById('incomeDeleteBtn').classList.toggle('hidden', !isEdit);
            document.getElementById('incomeDeleteBtn').textContent = isEdit && selectedIncomeFrequency !== 'once' ? 'Usuń serię' : 'Usuń';
        }

        function resetIncomeForm() {
            document.getElementById('incomeName').value = '';
            document.getElementById('incomeAmount').value = '';
            document.getElementById('incomeDate').value = '';
            selectIncomeFrequency('once');
        }

        function openPaymentModal() {
            editingPaymentId = null;
            setPaymentModalMode(false);
            resetPaymentForm();
            document.getElementById('paymentModal').classList.add('active');
        }

        function closePaymentModal() {
            document.getElementById('paymentModal').classList.remove('active');
            editingPaymentId = null;
            setPaymentModalMode(false);
            resetPaymentForm();
        }

        function setPaymentModalMode(isEdit) {
            document.getElementById('paymentModalTitle').textContent = isEdit ? '➕ Edytuj płatność' : '➕ Dodaj płatność';
            document.getElementById('paymentSubmitBtn').textContent = isEdit ? 'Zapisz' : 'Dodaj';
            document.getElementById('paymentDeleteBtn').classList.toggle('hidden', !isEdit);
            document.getElementById('paymentDeleteBtn').textContent = isEdit && selectedPaymentFrequency !== 'once' ? 'Usuń serię' : 'Usuń';
        }

        function resetPaymentForm() {
            document.getElementById('paymentName').value = '';
            document.getElementById('paymentAmount').value = '';
            document.getElementById('paymentDate').value = '';
            selectedMonths = [];
            syncMonthButtons();
            selectPaymentFrequency('once');
        }

        function openAdminPanel() {
            document.getElementById('adminModal').classList.add('active');
            document.getElementById('currentPin').value = '';
            document.getElementById('newPin').value = '';
            document.getElementById('confirmPin').value = '';
            document.getElementById('backupFileInput').value = '';
            document.getElementById('adminError').style.display = 'none';
            document.getElementById('adminSuccess').textContent = ADMIN_SUCCESS_DEFAULT_MESSAGE;
            document.getElementById('adminSuccess').style.display = 'none';
        }

        function closeAdminPanel() {
            document.getElementById('adminModal').classList.remove('active');
        }

        function selectPaymentFrequency(freq) {
            selectedPaymentFrequency = freq;
            const options = document.querySelectorAll('#paymentModal .radio-option');
            options.forEach(opt => opt.classList.remove('selected'));
            
            if (freq === 'once') options[0].classList.add('selected');
            else if (freq === 'monthly') options[1].classList.add('selected');
            else if (freq === 'selected') options[2].classList.add('selected');

            document.getElementById('monthSelectorGroup').classList.toggle('hidden', freq !== 'selected');
            if (editingPaymentId !== null) {
                document.getElementById('paymentDeleteBtn').textContent = freq !== 'once' ? 'Usuń serię' : 'Usuń';
            }
        }

        function selectIncomeFrequency(freq) {
            selectedIncomeFrequency = freq;
            const options = document.querySelectorAll('#incomeModal .radio-option');
            options.forEach(opt => opt.classList.remove('selected'));
            
            if (freq === 'once') options[0].classList.add('selected');
            else if (freq === 'monthly') options[1].classList.add('selected');
            if (editingIncomeId !== null) {
                document.getElementById('incomeDeleteBtn').textContent = freq !== 'once' ? 'Usuń serię' : 'Usuń';
            }
        }

        function toggleMonth(month) {
            const idx = selectedMonths.indexOf(month);
            if (idx > -1) {
                selectedMonths.splice(idx, 1);
            } else {
                selectedMonths.push(month);
            }

            syncMonthButtons();
        }

        function syncMonthButtons() {
            const monthBtns = document.querySelectorAll('.month-btn');
            monthBtns.forEach((btn, index) => {
                btn.classList.toggle('selected', selectedMonths.includes(index + 1));
            });
        }

        function parseDateString(dateString) {
            if (!dateString || typeof dateString !== 'string') {
                return new Date(NaN);
            }

            let year;
            let month;
            let day;

            if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
                [year, month, day] = dateString.split('-').map(Number);
            } else {
                const match = dateString.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
                if (!match) {
                    return new Date(NaN);
                }

                day = Number(match[1]);
                month = Number(match[2]);
                year = Number(match[3]);
            }

            const parsedDate = new Date(year, month - 1, day);
            if (
                parsedDate.getFullYear() !== year ||
                parsedDate.getMonth() !== month - 1 ||
                parsedDate.getDate() !== day
            ) {
                return new Date(NaN);
            }

            return parsedDate;
        }

        function formatDateString(date) {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        }

        function roundCurrency(value) {
            return Math.round((Number(value) || 0) * 100) / 100;
        }

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
            return parsedDate.toLocaleDateString('pl-PL');
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

        function formatDateToPolish(dateString) {
            const date = parseDateString(dateString);
            if (Number.isNaN(date.getTime())) {
                return '';
            }

            const day = String(date.getDate()).padStart(2, '0');
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const year = date.getFullYear();
            return `${day}/${month}/${year}`;
        }

        function parseUserDateToISO(inputValue) {
            const value = (inputValue || '').trim();
            if (!value) {
                return null;
            }

            const parsedDate = parseDateString(value);
            if (Number.isNaN(parsedDate.getTime())) {
                return null;
            }

            return formatDateString(parsedDate);
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

        function isSameMonthAndYear(dateToCheck, referenceDate) {
            return (
                dateToCheck.getMonth() === referenceDate.getMonth() &&
                dateToCheck.getFullYear() === referenceDate.getFullYear()
            );
        }

        function normalizeDate(date) {
            const result = new Date(date);
            result.setHours(0, 0, 0, 0);
            return result;
        }

        function isSameCalendarDate(firstDate, secondDate) {
            return formatDateString(firstDate) === formatDateString(secondDate);
        }

        function getMonthOccurrenceDate(baseDate, year, monthIndex) {
            const lastDayOfMonth = new Date(year, monthIndex + 1, 0).getDate();
            const day = Math.min(baseDate.getDate(), lastDayOfMonth);
            return normalizeDate(new Date(year, monthIndex, day));
        }

        function isOccurrencePaid(payment, occurrenceDateString) {
            return Array.isArray(payment.paidDates) && payment.paidDates.includes(occurrenceDateString);
        }

        function addPaidOccurrence(payment, occurrenceDateString) {
            if (!Array.isArray(payment.paidDates)) {
                payment.paidDates = [];
            }

            if (!payment.paidDates.includes(occurrenceDateString)) {
                payment.paidDates.push(occurrenceDateString);
                payment.paidDates.sort();
            }
        }

        function isIncomeOccurrenceReceived(income, occurrenceDateString) {
            return Array.isArray(income.receivedDates) && income.receivedDates.includes(occurrenceDateString);
        }

        function addReceivedOccurrence(income, occurrenceDateString) {
            if (!Array.isArray(income.receivedDates)) {
                income.receivedDates = [];
            }

            if (!income.receivedDates.includes(occurrenceDateString)) {
                income.receivedDates.push(occurrenceDateString);
                income.receivedDates.sort();
            }
        }

        function getIncomeOccurrenceForMonth(income, monthDate) {
            const baseDate = parseDateString(income.date);
            const monthStart = normalizeDate(new Date(monthDate.getFullYear(), monthDate.getMonth(), 1));

            if (income.frequency === 'once') {
                return isSameMonthAndYear(baseDate, monthStart) ? formatDateString(baseDate) : null;
            }

            if (income.frequency === 'monthly') {
                const occurrenceDate = getMonthOccurrenceDate(baseDate, monthStart.getFullYear(), monthStart.getMonth());
                return occurrenceDate >= baseDate ? formatDateString(occurrenceDate) : null;
            }

            return null;
        }

        function getPaymentOccurrenceForMonth(payment, monthDate) {
            const baseDate = parseDateString(payment.date);
            const monthStart = normalizeDate(new Date(monthDate.getFullYear(), monthDate.getMonth(), 1));

            if (payment.frequency === 'once') {
                return isSameMonthAndYear(baseDate, monthStart) ? formatDateString(baseDate) : null;
            }

            if (payment.frequency === 'monthly') {
                const occurrenceDate = getMonthOccurrenceDate(baseDate, monthStart.getFullYear(), monthStart.getMonth());
                return occurrenceDate >= baseDate ? formatDateString(occurrenceDate) : null;
            }

            if (payment.frequency === 'selected') {
                const selectedMonth = monthStart.getMonth() + 1;
                if (!Array.isArray(payment.months) || !payment.months.includes(selectedMonth)) {
                    return null;
                }

                const occurrenceDate = getMonthOccurrenceDate(baseDate, monthStart.getFullYear(), monthStart.getMonth());
                return occurrenceDate >= baseDate ? formatDateString(occurrenceDate) : null;
            }

            return null;
        }

        function getNextIncomeOccurrenceFromDate(income, fromDate) {
            const startDate = normalizeDate(fromDate);
            const baseDate = parseDateString(income.date);

            if (income.frequency === 'once') {
                const onceDate = formatDateString(baseDate);
                if (isIncomeOccurrenceReceived(income, onceDate)) {
                    return null;
                }
                return baseDate >= startDate ? onceDate : null;
            }

            if (income.frequency === 'monthly') {
                for (let i = 0; i < 36; i++) {
                    const probeMonth = new Date(startDate.getFullYear(), startDate.getMonth() + i, 1);
                    const occurrenceDateString = getIncomeOccurrenceForMonth(income, probeMonth);
                    if (!occurrenceDateString) {
                        continue;
                    }

                    if (isIncomeOccurrenceReceived(income, occurrenceDateString)) {
                        continue;
                    }

                    const occurrenceDate = parseDateString(occurrenceDateString);
                    if (occurrenceDate >= startDate) {
                        return occurrenceDateString;
                    }
                }
            }

            return null;
        }

        function settlePaymentOccurrence(payment, occurrenceDateString) {
            const amount = parseFloat(payment.amount) || 0;
            if (isOccurrencePaid(payment, occurrenceDateString)) {
                return 0;
            }

            if (payment.frequency === 'once') {
                payment._delete = true;
                return amount;
            }

            addPaidOccurrence(payment, occurrenceDateString);
            return amount;
        }

        function settleIncomeOccurrence(income, occurrenceDateString) {
            const amount = parseFloat(income.amount) || 0;
            if (isIncomeOccurrenceReceived(income, occurrenceDateString)) {
                return 0;
            }

            if (income.frequency === 'once') {
                income._delete = true;
                return amount;
            }

            addReceivedOccurrence(income, occurrenceDateString);
            return amount;
        }

        function updateBalanceBy(deltaAmount) {
            const currentBalance = parseFloat(appStorage.getItem(STORAGE_KEYS.BALANCE)) || 0;
            const updatedBalance = Math.round((currentBalance + deltaAmount) * 100) / 100;
            appStorage.setItem(STORAGE_KEYS.BALANCE, updatedBalance.toString());
        }

        function isPaymentDueOnDate(payment, targetDate) {
            const normalizedDate = normalizeDate(targetDate);
            const targetDateString = formatDateString(normalizedDate);

            if (payment.frequency === 'once') {
                return formatDateString(parseDateString(payment.date)) === targetDateString;
            }

            const occurrenceForMonth = getPaymentOccurrenceForMonth(payment, normalizedDate);
            return occurrenceForMonth === targetDateString;
        }

        function isIncomeDueOnDate(income, targetDate) {
            const normalizedDate = normalizeDate(targetDate);
            const targetDateString = formatDateString(normalizedDate);

            if (income.frequency === 'once') {
                return formatDateString(parseDateString(income.date)) === targetDateString;
            }

            const occurrenceForMonth = getIncomeOccurrenceForMonth(income, normalizedDate);
            return occurrenceForMonth === targetDateString;
        }

        function getDuePaymentOccurrencesUpToDate(payment, todayDate, includeTodayOccurrence) {
            const dueOccurrences = [];
            const todayString = formatDateString(todayDate);
            const baseDate = parseDateString(payment.date);
            if (Number.isNaN(baseDate.getTime())) {
                return dueOccurrences;
            }

            if (payment.frequency === 'once') {
                const occurrence = formatDateString(baseDate);
                const isDue = occurrence < todayString || (includeTodayOccurrence && occurrence === todayString);
                if (isDue && !isOccurrencePaid(payment, occurrence)) {
                    dueOccurrences.push(occurrence);
                }
                return dueOccurrences;
            }

            const baseMonth = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
            const targetMonth = new Date(todayDate.getFullYear(), todayDate.getMonth(), 1);

            for (
                let probeMonth = new Date(baseMonth);
                probeMonth <= targetMonth;
                probeMonth = new Date(probeMonth.getFullYear(), probeMonth.getMonth() + 1, 1)
            ) {
                const occurrence = getPaymentOccurrenceForMonth(payment, probeMonth);
                if (!occurrence || isOccurrencePaid(payment, occurrence)) {
                    continue;
                }

                const isDue = occurrence < todayString || (includeTodayOccurrence && occurrence === todayString);
                if (isDue) {
                    dueOccurrences.push(occurrence);
                }
            }

            return dueOccurrences;
        }

        function getDueIncomeOccurrencesUpToDate(income, todayDate, includeTodayOccurrence) {
            const dueOccurrences = [];
            const todayString = formatDateString(todayDate);
            const baseDate = parseDateString(income.date);
            if (Number.isNaN(baseDate.getTime())) {
                return dueOccurrences;
            }

            if (income.frequency === 'once') {
                const occurrence = formatDateString(baseDate);
                const isDue = occurrence < todayString || (includeTodayOccurrence && occurrence === todayString);
                if (isDue && !isIncomeOccurrenceReceived(income, occurrence)) {
                    dueOccurrences.push(occurrence);
                }
                return dueOccurrences;
            }

            const baseMonth = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
            const targetMonth = new Date(todayDate.getFullYear(), todayDate.getMonth(), 1);

            for (
                let probeMonth = new Date(baseMonth);
                probeMonth <= targetMonth;
                probeMonth = new Date(probeMonth.getFullYear(), probeMonth.getMonth() + 1, 1)
            ) {
                const occurrence = getIncomeOccurrenceForMonth(income, probeMonth);
                if (!occurrence || isIncomeOccurrenceReceived(income, occurrence)) {
                    continue;
                }

                const isDue = occurrence < todayString || (includeTodayOccurrence && occurrence === todayString);
                if (isDue) {
                    dueOccurrences.push(occurrence);
                }
            }

            return dueOccurrences;
        }

        async function runServerSettlement(reason) {
            const response = await fetch('/api/settlements/run', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ reason: normalizeUserText(reason || 'manual') })
            });

            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                if (response.status === 401) {
                    handleUnauthorizedSession('Sesja wygasła. Zaloguj się ponownie.');
                }
                const error = new Error(`POST /api/settlements/run failed: ${response.status}`);
                error.status = response.status;
                error.details = data;
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
                alert('Nie udało się oznaczyć płatności jako opłaconej.');
            }
        }

        async function markIncomeAsReceived(id, occurrenceDateString) {
            try {
                await runServerSettlement(`manual-income-${id}-${occurrenceDateString}`);
                loadData();
            } catch (error) {
                console.error('Błąd księgowania wpływu po stronie serwera:', error);
                alert('Nie udało się oznaczyć wpływu jako zaksięgowanego.');
            }
        }

        function updateViewMonthLabel() {
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
            currentViewDate = new Date(currentViewDate.getFullYear(), currentViewDate.getMonth() + offset, 1);
            updateViewMonthLabel();
            loadPayments();
            loadIncomes();
        }

        function goToCurrentMonth() {
            const today = new Date();
            currentViewDate = new Date(today.getFullYear(), today.getMonth(), 1);
            updateViewMonthLabel();
            loadPayments();
            loadIncomes();
        }

        function openExpenseAnalysisModal() {
            const monthInput = document.getElementById('expenseAnalysisMonth');
            monthInput.value = getMonthInputValue(currentViewDate);
            expenseDetailsVisible = false;
            document.getElementById('expenseDetailsSection').classList.add('hidden');
            document.getElementById('expenseDetailsBtn').textContent = 'Szczegóły';
            renderExpenseAnalysis();
            document.getElementById('expenseAnalysisModal').classList.add('active');
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

        function openIncomeAnalysisModal() {
            const monthInput = document.getElementById('incomeAnalysisMonth');
            monthInput.value = getMonthInputValue(currentViewDate);
            renderIncomeAnalysis();
            document.getElementById('incomeAnalysisModal').classList.add('active');
        }

        function closeIncomeAnalysisModal() {
            document.getElementById('incomeAnalysisModal').classList.remove('active');
        }

        function openIncomeAnalysisFromExpense() {
            const expenseMonth = document.getElementById('expenseAnalysisMonth').value;
            closeExpenseAnalysisModal();
            const monthInput = document.getElementById('incomeAnalysisMonth');
            monthInput.value = expenseMonth || getMonthInputValue(currentViewDate);
            renderIncomeAnalysis();
            document.getElementById('incomeAnalysisModal').classList.add('active');
        }

        async function fetchTransactionsForAnalysis(entryType, monthValue) {
            if (!/^\d{4}-\d{2}$/.test(String(monthValue || ''))) {
                return {
                    entries: [],
                    totalsByCategory: {},
                    totalAmount: 0
                };
            }

            const response = await fetch(
                `/api/transactions?type=${encodeURIComponent(entryType)}&month=${encodeURIComponent(monthValue)}`,
                {
                    method: 'GET',
                    headers: { 'Accept': 'application/json' },
                    cache: 'no-store',
                    credentials: 'same-origin'
                }
            );

            if (!response.ok) {
                let details = {};
                try {
                    details = await response.json();
                } catch {
                    details = {};
                }
                const error = new Error(`GET /api/transactions failed: ${response.status}`);
                error.status = response.status;
                error.details = details;
                throw error;
            }

            return response.json();
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
                alert('Nie udało się odczytać identyfikatora wydatku.');
                return;
            }

            const entries = parseStoredJSON(STORAGE_KEYS.EXPENSE_ENTRIES, []);
            const entryIndex = entries.findIndex(entry => Number(entry.id) === normalizedId);
            if (entryIndex === -1) {
                alert('Nie znaleziono wydatku. Odśwież analizę i spróbuj ponownie.');
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
                alert('Nie wybrano wydatku do edycji.');
                return;
            }

            const rawValue = document.getElementById('expenseEditAmountInput').value;
            const parsedAmount = Number(String(rawValue).replace(',', '.').trim());
            const newAmount = roundCurrency(parsedAmount);
            if (!Number.isFinite(newAmount) || newAmount <= 0) {
                alert('Podaj poprawną kwotę większą od zera.');
                return;
            }

            const entries = parseStoredJSON(STORAGE_KEYS.EXPENSE_ENTRIES, []);
            const entryIndex = entries.findIndex(entry => Number(entry.id) === editingExpenseEntryId);
            if (entryIndex === -1) {
                closeExpenseEditModal();
                alert('Nie znaleziono wydatku. Odśwież analizę i spróbuj ponownie.');
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

            appStorage.setItem(STORAGE_KEYS.EXPENSE_ENTRIES, JSON.stringify(entries));
            appStorage.setItem(STORAGE_KEYS.EXPENSE_TOTALS, JSON.stringify(buildCategoryTotals(entries)));

            const currentBalance = parseFloat(appStorage.getItem(STORAGE_KEYS.BALANCE)) || 0;
            const updatedBalance = roundCurrency(currentBalance + currentAmount - newAmount);
            appStorage.setItem(STORAGE_KEYS.BALANCE, updatedBalance.toString());

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
                            <span class="analysis-category-total">-${roundCurrency(total).toFixed(2)} zł</span>
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
                                    <div class="analysis-entry-amount-expense">-${roundCurrency(entry.amount).toFixed(2)} zł</div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
            }).join('') + `
                <div class="analysis-category-card">
                    <div class="analysis-category-header">
                        <span>🧮 Suma wydatków</span>
                        <span class="analysis-category-total">-${totalExpenses.toFixed(2)} zł</span>
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
                            <span class="analysis-category-total analysis-income-total">+${roundCurrency(total).toFixed(2)} zł</span>
                        </div>
                        <div class="analysis-entry-list">
                            ${categoryEntries.map(entry => `
                                <div class="analysis-entry">
                                    <div>
                                        <div>${escapeHtml(entry.name || category)}</div>
                                        <div class="analysis-entry-meta">${formatEntryDate(entry.date)}</div>
                                    </div>
                                    <div class="analysis-entry-amount-income">+${roundCurrency(entry.amount).toFixed(2)} zł</div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
            }).join('') + `
                <div class="analysis-category-card">
                    <div class="analysis-category-header">
                        <span>🧮 Suma wpływów</span>
                        <span class="analysis-category-total analysis-income-total">+${totalIncome.toFixed(2)} zł</span>
                    </div>
                </div>
            `;
        }

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
                alert('Podaj stan konta');
                return;
            }

            const newBalance = parseFloat(rawValue);
            if (Number.isNaN(newBalance)) {
                alert('Podaj poprawną kwotę');
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

        function loadBalance() {
            const balance = parseFloat(appStorage.getItem(STORAGE_KEYS.BALANCE)) || 0;
            document.getElementById('currentBalance').textContent = balance.toFixed(2) + ' zł';
        }

        function saveIncome() {
            const name = normalizeUserText(document.getElementById('incomeName').value);
            const amount = parseFloat(document.getElementById('incomeAmount').value);
            const rawDate = document.getElementById('incomeDate').value;
            const date = parseUserDateToISO(rawDate);

            if (!name || Number.isNaN(amount) || !rawDate) {
                alert('Wypełnij wszystkie pola');
                return;
            }

            if (!date) {
                alert('Podaj poprawną datę w formacie dd/mm/yyyy');
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
                alert('Wypełnij wszystkie pola');
                return;
            }

            if (!date) {
                alert('Podaj poprawną datę w formacie dd/mm/yyyy');
                return;
            }

            if (selectedPaymentFrequency === 'selected' && selectedMonths.length === 0) {
                alert('Wybierz co najmniej jeden miesiąc');
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
                    dateNode.textContent = parseDateString(income.date).toLocaleDateString('pl-PL');
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
                    amount.textContent = `+${Number(income.amount || 0).toFixed(2)} zł`;
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
                document.getElementById('nextIncomeDate').textContent = 'Wpływ: ' + nextDate.toLocaleDateString('pl-PL');
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
                dateNode.textContent = parseDateString(payment.date).toLocaleDateString('pl-PL');
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
                amount.textContent = `-${Number(payment.amount || 0).toFixed(2)} zł`;
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

        function deletePaymentFromModal() {
            if (editingPaymentId === null) {
                return;
            }

            if (deletePayment(editingPaymentId)) {
                closePaymentModal();
            }
        }

        function deleteIncomeFromModal() {
            if (editingIncomeId === null) {
                return;
            }

            if (deleteIncome(editingIncomeId)) {
                closeIncomeModal();
            }
        }

        function updateCalculations() {
            const balance = parseFloat(appStorage.getItem(STORAGE_KEYS.BALANCE)) || 0;

            let totalPayments = 0;
            const paymentsStored = appStorage.getItem(STORAGE_KEYS.PAYMENTS);
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
            afterPaymentsElement.textContent = afterPayments.toFixed(2) + ' zł';
            
            if (afterPayments > 0) {
                afterPaymentsElement.classList.add('positive');
                afterPaymentsElement.classList.remove('negative');
            } else if (afterPayments < 0) {
                afterPaymentsElement.classList.add('negative');
                afterPaymentsElement.classList.remove('positive');
            }
        }

        async function downloadBackup() {
            const errorElement = document.getElementById('adminError');
            const successElement = document.getElementById('adminSuccess');
            errorElement.style.display = 'none';
            successElement.style.display = 'none';

            try {
                const response = await fetch('/api/backup/download?format=sqlite', {
                    method: 'GET',
                    headers: { 'Accept': 'application/octet-stream' },
                    credentials: 'same-origin'
                });

                if (!response.ok) {
                    if (response.status === 401) {
                        errorElement.textContent = 'Sesja wygasła. Zaloguj się ponownie.';
                        handleUnauthorizedSession();
                    } else {
                        errorElement.textContent = 'Nie udało się pobrać backupu.';
                    }
                    errorElement.style.display = 'block';
                    return;
                }

                const blob = await response.blob();
                const contentDisposition = response.headers.get('Content-Disposition') || '';
                const filenameMatch = contentDisposition.match(/filename="([^"]+)"/i);
                const defaultName = `budget_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.db`;
                const filename = filenameMatch && filenameMatch[1] ? filenameMatch[1] : defaultName;

                const objectUrl = URL.createObjectURL(blob);
                const anchor = document.createElement('a');
                anchor.href = objectUrl;
                anchor.download = filename;
                document.body.appendChild(anchor);
                anchor.click();
                anchor.remove();
                URL.revokeObjectURL(objectUrl);

                successElement.textContent = 'Backup bazy .db został pobrany.';
                successElement.style.display = 'block';
            } catch (error) {
                console.error('Błąd pobierania backupu:', error);
                errorElement.textContent = 'Błąd połączenia z serwerem.';
                errorElement.style.display = 'block';
            }
        }

        async function restoreBackup() {
            const errorElement = document.getElementById('adminError');
            const successElement = document.getElementById('adminSuccess');
            const fileInput = document.getElementById('backupFileInput');
            const selectedFile = fileInput?.files?.[0];

            errorElement.style.display = 'none';
            successElement.style.display = 'none';

            if (!selectedFile) {
                errorElement.textContent = 'Wybierz plik backupu .db';
                errorElement.style.display = 'block';
                return;
            }

            const fileName = String(selectedFile.name || '').toLowerCase();
            if (!fileName.endsWith('.db')) {
                errorElement.textContent = 'Do przywracania wybierz plik SQLite .db';
                errorElement.style.display = 'block';
                return;
            }

            const shouldProceed = window.confirm(
                'Przywrócenie backupu zastąpi aktualne dane. Przed operacją serwer utworzy snapshot bezpieczeństwa. Kontynuować?'
            );
            if (!shouldProceed) {
                return;
            }

            try {
                const response = await fetch('/api/backup/restore', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-sqlite3'
                    },
                    credentials: 'same-origin',
                    body: selectedFile
                });
                const data = await response.json().catch(() => ({}));

                if (!response.ok) {
                    if (response.status === 401) {
                        errorElement.textContent = 'Sesja wygasła. Zaloguj się ponownie.';
                        handleUnauthorizedSession();
                    } else if (response.status === 413 || data?.error === 'backup_too_large') {
                        errorElement.textContent = 'Plik backupu jest za duży.';
                    } else if (response.status === 422) {
                        errorElement.textContent = 'Plik backupu jest nieprawidłowy lub niekompatybilny.';
                    } else {
                        errorElement.textContent = 'Nie udało się przywrócić backupu.';
                    }
                    errorElement.style.display = 'block';
                    return;
                }

                const snapshotName = data?.preRestoreBackup ? ` Snapshot: ${data.preRestoreBackup}` : '';
                successElement.textContent = `Backup został przywrócony.${snapshotName} Zaloguj się ponownie.`;
                successElement.style.display = 'block';

                isAuthenticated = false;
                stateReady = false;
                savePending = false;
                if (saveTimerId) {
                    clearTimeout(saveTimerId);
                    saveTimerId = null;
                }
                appState = sanitizeState({});
                setTimeout(() => {
                    closeAdminPanel();
                    showLoginScreen();
                }, 500);
            } catch (error) {
                console.error('Błąd przywracania backupu:', error);
                errorElement.textContent = 'Błąd połączenia z serwerem.';
                errorElement.style.display = 'block';
            }
        }

        async function changePin() {
            const currentPin = document.getElementById('currentPin').value;
            const newPin = document.getElementById('newPin').value;
            const confirmPin = document.getElementById('confirmPin').value;

            const errorElement = document.getElementById('adminError');
            const successElement = document.getElementById('adminSuccess');

            errorElement.style.display = 'none';
            successElement.style.display = 'none';

            if (!currentPin || !newPin || !confirmPin) {
                errorElement.textContent = 'Wypełnij wszystkie pola';
                errorElement.style.display = 'block';
                return;
            }

            if (newPin.length !== 4 || !/^\d+$/.test(newPin)) {
                errorElement.textContent = 'PIN musi składać się z 4 cyfr';
                errorElement.style.display = 'block';
                return;
            }

            if (newPin !== confirmPin) {
                errorElement.textContent = 'Nowe PINy nie pasują do siebie';
                errorElement.style.display = 'block';
                return;
            }

            try {
                const response = await fetch('/api/auth/change-pin', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify({
                        currentPin: currentPin,
                        newPin: newPin
                    })
                });
                const data = await response.json().catch(() => ({}));

                if (!response.ok) {
                    if (response.status === 401 && data?.error === 'invalid_current_pin') {
                        errorElement.textContent = 'Nieprawidłowy aktualny PIN';
                    } else if (response.status === 401 && data?.error === 'unauthorized') {
                        errorElement.textContent = 'Sesja wygasła. Zaloguj się ponownie.';
                        handleUnauthorizedSession();
                    } else if (response.status === 400 && data?.error === 'pin_unchanged') {
                        errorElement.textContent = 'Nowy PIN musi być inny niż aktualny';
                    } else {
                        errorElement.textContent = 'Nie udało się zmienić PINu';
                    }
                    errorElement.style.display = 'block';
                    return;
                }

                successElement.textContent = ADMIN_SUCCESS_DEFAULT_MESSAGE;
                successElement.style.display = 'block';
                setTimeout(() => {
                    closeAdminPanel();
                }, 2000);
            } catch (error) {
                console.error('Błąd zmiany PINu:', error);
                errorElement.textContent = 'Błąd połączenia z serwerem';
                errorElement.style.display = 'block';
            }
        }

        document.getElementById('pin4').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                login();
            }
        });

        setupPwaInstallPrompt();
        registerServiceWorker();
        initializeStorage();