function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getMonthValue(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function getYearValue(date = new Date()) {
    return String(date.getFullYear());
}

function formatPercent(value) {
    return `${Math.round(Number(value || 0) * 1000) / 10}%`;
}

function getStatusLabel(status) {
    const labels = {
        unpaid: 'Niezapłacone',
        partial: 'Częściowo',
        paid: 'Zapłacone',
        overpaid: 'Nadpłata',
        late: 'Po terminie',
        inactive: 'Nieaktywny'
    };
    return labels[status] || 'Do sprawdzenia';
}

function getStatusClass(status) {
    if (status === 'paid') {
        return 'is-paid';
    }
    if (status === 'late') {
        return 'is-late';
    }
    if (status === 'partial' || status === 'overpaid') {
        return 'is-review';
    }
    return 'is-unpaid';
}

function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('file_read_failed'));
        reader.readAsText(file);
    });
}

export function createRentalsController({
    apiFetchRentalsOverview,
    apiPreviewRentalBankImport,
    formatCurrencyPLN,
    showToast
}) {
    let activeView = 'month';
    let latestOverview = null;
    let isLoading = false;

    function money(value) {
        if (typeof formatCurrencyPLN === 'function') {
            return formatCurrencyPLN(Number(value) || 0);
        }
        return `${(Number(value) || 0).toFixed(2)} zł`;
    }

    function moneyOrDash(value) {
        return value === null || value === undefined || value === '' ? '<span class="rental-muted">-</span>' : money(value);
    }

    function hasSettlementData(overview) {
        return Boolean(overview?.hasSettlementData);
    }

    function renderSettlementNotice(overview) {
        if (hasSettlementData(overview)) {
            return '';
        }
        return `
            <div class="rental-empty rental-note">
                <strong>To jest podgląd statusów wpłat, nie pełne rozliczenie podatkowe.</strong>
                <span>${escapeHtml(overview?.calculationNotice || 'Rozbicie na czynsz, media, Zarządzanie Marek, Mój przychód i podatek pojawi się po poprawnym imporcie Excela albo po wygenerowaniu miesięcznych naliczeń.')}</span>
                <button type="button" class="btn btn-secondary tenant-open-btn" onclick="openTenantPaymentsModal()">Otwórz dotychczasowe wpłaty</button>
            </div>
        `;
    }

    function getSelectedMonth() {
        const input = document.getElementById('rentalMonthInput');
        if (!input) {
            return getMonthValue();
        }
        if (!/^\d{4}-\d{2}$/.test(input.value || '')) {
            input.value = getMonthValue();
        }
        return input.value;
    }

    function getSelectedYear() {
        const input = document.getElementById('rentalYearInput');
        if (!input) {
            return getYearValue();
        }
        if (!/^\d{4}$/.test(input.value || '')) {
            input.value = getYearValue();
        }
        return input.value;
    }

    function ensureDefaultInputs() {
        const monthInput = document.getElementById('rentalMonthInput');
        const yearInput = document.getElementById('rentalYearInput');
        if (monthInput && !/^\d{4}-\d{2}$/.test(monthInput.value || '')) {
            monthInput.value = getMonthValue();
        }
        if (yearInput && !/^\d{4}$/.test(yearInput.value || '')) {
            yearInput.value = getYearValue();
        }
    }

    function renderKpiCards(summary, yearTax) {
        const target = document.getElementById('rentalKpiGrid');
        if (!target) {
            return;
        }

        target.innerHTML = `
            <div class="rental-kpi">
                <span>Wpłaty miesiąca</span>
                <strong>${money(summary.paidTotal)} / ${money(summary.expectedTotal)}</strong>
            </div>
            <div class="rental-kpi">
                <span>Zaległości</span>
                <strong>${money(summary.arrearsTotal)}</strong>
            </div>
            <div class="rental-kpi">
                <span>Rozliczenia z Excela</span>
                <strong>${summary.hasSettlementData ? 'Gotowe' : 'Do importu'}</strong>
            </div>
            <div class="rental-kpi">
                <span>Podatek roczny</span>
                <strong>${summary.hasSettlementData ? money(yearTax?.tax || 0) : '-'}</strong>
            </div>
        `;
    }

    function renderMonthView(overview) {
        const target = document.getElementById('rentalMonthView');
        if (!target) {
            return;
        }
        const rows = overview?.monthRows || [];
        if (rows.length === 0) {
            target.innerHTML = `
                <div class="rental-empty">
                    <strong>Brak aktywnych najemców w tym miesiącu.</strong>
                    <span>Dodaj najemców w obecnym module wpłat, a ten widok pokaże rozliczenie miesięczne.</span>
                </div>
            `;
            return;
        }

        target.innerHTML = `
            ${renderSettlementNotice(overview)}
            <div class="rental-table-wrap">
                <table class="rental-table">
                    <thead>
                        <tr>
                            <th>Najemca</th>
                            <th>Termin</th>
                            <th>Przelew</th>
                            <th>Zapłacono</th>
                            <th>Status</th>
                            <th>Czynsz</th>
                            <th>Media</th>
                            <th>Zarządzanie Marek</th>
                            <th>Mój przychód</th>
                            <th>Podatek</th>
                            <th>Źródło</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.map(row => `
                            <tr>
                                <td>${escapeHtml(row.tenantName)}</td>
                                <td>${escapeHtml(row.dueDate)}</td>
                                <td>${money(row.expectedTotal)}</td>
                                <td>${money(row.paidAmount)}</td>
                                <td><span class="rental-status ${getStatusClass(row.paymentStatus)}">${getStatusLabel(row.paymentStatus)}</span></td>
                                <td>${moneyOrDash(row.rentAmount)}</td>
                                <td>${moneyOrDash(row.utilitiesAdvance)}</td>
                                <td>${moneyOrDash(row.managementMarekAmount)}</td>
                                <td>${moneyOrDash(row.ownerIncomeAmount)}</td>
                                <td>${moneyOrDash(row.taxAmount)}</td>
                                <td>${row.hasSettlementData ? 'Rozliczenie' : 'Wpłaty'}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    function renderYearView(overview) {
        const target = document.getElementById('rentalYearView');
        if (!target) {
            return;
        }
        const months = overview?.yearMonths || [];
        target.innerHTML = `
            ${renderSettlementNotice(overview)}
            <div class="rental-year-roll">
                ${months.map(month => {
                    const summary = month.summary || {};
                    return `
                        <section class="rental-year-month">
                            <div class="rental-year-month-head">
                                <strong>${escapeHtml(month.month)}</strong>
                                <span>${money(summary.paidTotal)} / ${money(summary.expectedTotal)}</span>
                                <span>Podatek narastająco: ${summary.hasSettlementData ? money(summary.taxYearToDate) : '-'}</span>
                            </div>
                            <div class="rental-table-wrap rental-table-wrap-compact">
                                <table class="rental-table rental-table-compact">
                                    <thead>
                                        <tr>
                                            <th>Najemca</th>
                                            <th>Status</th>
                                            <th>Przelew</th>
                                            <th>Czynsz</th>
                                            <th>Media pobrane</th>
                                            <th>Media zapłacone</th>
                                            <th>Zarządzanie Marek</th>
                                            <th>Mój przychód</th>
                                            <th>Podatek</th>
                                            <th>Zaległość</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${(month.rows || []).map(row => `
                                            <tr>
                                                <td>${escapeHtml(row.tenantName)}</td>
                                                <td><span class="rental-status ${getStatusClass(row.paymentStatus)}">${getStatusLabel(row.paymentStatus)}</span></td>
                                                <td>${money(row.expectedTotal)}</td>
                                                <td>${moneyOrDash(row.rentAmount)}</td>
                                                <td>${moneyOrDash(row.utilitiesAdvance)}</td>
                                                <td>${moneyOrDash(row.utilitiesPaidAmount)}</td>
                                                <td>${moneyOrDash(row.managementMarekAmount)}</td>
                                                <td>${moneyOrDash(row.ownerIncomeAmount)}</td>
                                                <td>${moneyOrDash(row.taxAmount)}</td>
                                                <td>${money(Math.max(0, Number(row.expectedTotal || 0) - Number(row.paidAmount || 0)))}</td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                            </div>
                        </section>
                    `;
                }).join('')}
            </div>
        `;
    }

    function renderTenantsView(overview) {
        const target = document.getElementById('rentalTenantsView');
        if (!target) {
            return;
        }
        const byTenant = new Map();
        (overview?.yearMonths || []).forEach(month => {
            (month.rows || []).forEach(row => {
                if (!byTenant.has(row.tenantId)) {
                    byTenant.set(row.tenantId, {
                        name: row.tenantName,
                        expected: 0,
                        paid: 0,
                        late: 0
                    });
                }
                const item = byTenant.get(row.tenantId);
                item.expected += Number(row.expectedTotal || 0);
                item.paid += Number(row.paidAmount || 0);
                if (row.paymentStatus === 'late') {
                    item.late += 1;
                }
            });
        });
        const tenants = [...byTenant.values()];
        target.innerHTML = tenants.length === 0
            ? '<div class="rental-empty"><strong>Brak najemców do pokazania.</strong><span>Uzupełnij obecny moduł wpłat najemców.</span></div>'
            : `
                ${renderSettlementNotice(overview)}
                <div class="rental-table-wrap">
                    <table class="rental-table">
                        <thead>
                            <tr>
                                <th>Najemca</th>
                                <th>Oczekiwane z obecnych wpłat</th>
                                <th>Zapłacone z obecnych wpłat</th>
                                <th>Miesiące po terminie</th>
                                <th>Nowa karta najemcy</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${tenants.map(tenant => `
                                <tr>
                                    <td>${escapeHtml(tenant.name)}</td>
                                    <td>${money(tenant.expected)}</td>
                                    <td>${money(tenant.paid)}</td>
                                    <td>${tenant.late}</td>
                                    <td>Umowy, pokoje i aliasy po migracji danych</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
    }

    function renderImportView() {
        const target = document.getElementById('rentalImportView');
        if (!target || target.dataset.ready === 'true') {
            return;
        }
        target.dataset.ready = 'true';
        target.innerHTML = `
            <div class="rental-import-box">
                <div>
                    <strong>Import banku</strong>
                    <span>Na tym etapie działa tylko bezpieczny podgląd CSV/TXT. Import Excela rozliczeń i PDF/XLSX banku zostaje wyłączony, dopóki parser nie przejdzie walidacji na prawdziwym arkuszu.</span>
                </div>
                <input type="file" id="rentalBankFileInput" accept=".csv,.txt">
                <button type="button" class="btn btn-primary" id="rentalBankPreviewBtn">Sprawdź dopasowania</button>
            </div>
            <div class="rental-import-results" id="rentalBankImportResults"></div>
        `;
        document.getElementById('rentalBankPreviewBtn')?.addEventListener('click', previewBankImport);
    }

    function renderReportsView(overview) {
        const target = document.getElementById('rentalReportsView');
        if (!target) {
            return;
        }
        if (!hasSettlementData(overview)) {
            target.innerHTML = `
                ${renderSettlementNotice(overview)}
                <div class="rental-empty rental-note">
                    <strong>Raport dla księgowego jest zablokowany do czasu poprawnego rozbicia danych.</strong>
                    <span>Bez pól z Excela aplikacja zna tylko oczekiwane i zapłacone przelewy, więc eksport podatku byłby mylący.</span>
                </div>
            `;
            return;
        }
        const tax = overview?.yearTax || {};
        target.innerHTML = `
            <div class="rental-report-grid">
                <div class="rental-report-tile">
                    <span>Przychód opodatkowany</span>
                    <strong>${money(tax.taxableIncome || 0)}</strong>
                </div>
                <div class="rental-report-tile">
                    <span>Próg 8,5%</span>
                    <strong>${money(tax.firstBucket || 0)}</strong>
                </div>
                <div class="rental-report-tile">
                    <span>Próg 12,5%</span>
                    <strong>${money(tax.secondBucket || 0)}</strong>
                </div>
                <div class="rental-report-tile">
                    <span>Podatek roczny</span>
                    <strong>${money(tax.tax || 0)}</strong>
                </div>
            </div>
            <div class="rental-empty rental-note">
                <strong>Eksport XLSX/PDF/CSV</strong>
                <span>Widok raportów ma już docelowe wyliczenia. Eksport plików będzie kolejnym zamkniętym krokiem wdrożenia.</span>
            </div>
        `;
    }

    function renderTaxesView(overview) {
        const target = document.getElementById('rentalTaxesView');
        if (!target) {
            return;
        }
        if (!hasSettlementData(overview)) {
            target.innerHTML = `
                ${renderSettlementNotice(overview)}
                <div class="rental-empty rental-note">
                    <strong>Podatek nie jest liczony z samej kwoty przelewu.</strong>
                    <span>Najpierw trzeba mieć rozbicie na czynsz opodatkowany, zaliczki na media, Inne opłaty i konfigurację składników typu kościelna.</span>
                </div>
            `;
            return;
        }
        const tax = overview?.yearTax || {};
        const months = overview?.yearMonths || [];
        target.innerHTML = `
            <div class="rental-report-grid">
                <div class="rental-report-tile">
                    <span>Przychód opodatkowany</span>
                    <strong>${money(tax.taxableIncome || 0)}</strong>
                </div>
                <div class="rental-report-tile">
                    <span>Limit 8,5%</span>
                    <strong>${money(tax.firstThreshold || 100000)}</strong>
                </div>
                <div class="rental-report-tile">
                    <span>Nadwyżka 12,5%</span>
                    <strong>${money(tax.secondBucket || 0)}</strong>
                </div>
                <div class="rental-report-tile">
                    <span>Podatek roczny</span>
                    <strong>${money(tax.tax || 0)}</strong>
                </div>
            </div>
            <div class="rental-table-wrap">
                <table class="rental-table">
                    <thead>
                        <tr>
                            <th>Miesiąc</th>
                            <th>Czynsz opodatkowany</th>
                            <th>Inne opłaty</th>
                            <th>Podatek miesiąca</th>
                            <th>Przychód narastająco</th>
                            <th>Podatek narastająco</th>
                            <th>Mój przychód</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${months.map(month => `
                            <tr>
                                <td>${escapeHtml(month.month)}</td>
                                <td>${money(month.summary?.rentTaxableTotal || 0)}</td>
                                <td>${money(month.summary?.otherChargesTotal || 0)}</td>
                                <td>${money(month.summary?.taxTotal || 0)}</td>
                                <td>${money(month.summary?.taxableYearToDate || 0)}</td>
                                <td>${money(month.summary?.taxYearToDate || 0)}</td>
                                <td>${money(month.summary?.ownerIncomeTotal || 0)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    function renderAllViews(overview) {
        renderKpiCards(overview?.monthSummary || {}, overview?.yearTax || {});
        renderMonthView(overview);
        renderYearView(overview);
        renderTaxesView(overview);
        renderTenantsView(overview);
        renderImportView();
        renderReportsView(overview);
    }

    async function renderRentalsPanel() {
        ensureDefaultInputs();
        const panel = document.getElementById('rentalsPanel');
        if (!panel || isLoading) {
            return;
        }
        isLoading = true;
        panel.classList.add('is-loading');
        try {
            latestOverview = await apiFetchRentalsOverview(getSelectedMonth(), getSelectedYear());
            renderAllViews(latestOverview);
        } catch (error) {
            console.error('Nie udało się pobrać modułu najmu:', error);
            if (typeof showToast === 'function') {
                showToast('Nie udało się odświeżyć modułu najmu.', 'error');
            }
        } finally {
            isLoading = false;
            panel.classList.remove('is-loading');
        }
    }

    function switchRentalView(viewName) {
        activeView = ['month', 'year', 'taxes', 'tenants', 'import', 'reports'].includes(viewName) ? viewName : 'month';
        document.querySelectorAll('[data-rental-tab]').forEach(button => {
            button.classList.toggle('active', button.dataset.rentalTab === activeView);
        });
        document.querySelectorAll('[data-rental-view]').forEach(view => {
            view.classList.toggle('active', view.dataset.rentalView === activeView);
        });
        if (latestOverview) {
            renderAllViews(latestOverview);
        } else {
            renderRentalsPanel();
        }
    }

    function openRentalsPanel() {
        const panel = document.getElementById('rentalsPanel');
        if (!panel) {
            return;
        }
        panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        renderRentalsPanel();
    }

    async function previewBankImport() {
        const input = document.getElementById('rentalBankFileInput');
        const results = document.getElementById('rentalBankImportResults');
        const file = input?.files?.[0];
        if (!file) {
            if (typeof showToast === 'function') {
                showToast('Wybierz plik wyciągu bankowego.', 'warning');
            }
            return;
        }
        if (!/\.(csv|txt)$/i.test(file.name || '')) {
            if (results) {
                results.innerHTML = '<div class="rental-empty"><strong>Ten importer przyjmuje teraz tylko CSV/TXT.</strong><span>XLSX/PDF wrócą po zrobieniu walidowanego parsera, żeby nie produkować błędnych danych.</span></div>';
            }
            return;
        }
        if (results) {
            results.innerHTML = '<div class="rental-empty"><strong>Analizuję plik...</strong><span>Parser przygotowuje sugestie dopasowania.</span></div>';
        }
        try {
            const content = await readFileAsText(file);
            const preview = await apiPreviewRentalBankImport({
                fileName: file.name,
                content
            });
            renderBankImportPreview(preview);
        } catch (error) {
            console.error('Import bankowy nie powiódł się:', error);
            if (results) {
                results.innerHTML = '<div class="rental-empty"><strong>Nie udało się przeanalizować pliku.</strong><span>Sprawdź format albo spróbuj z CSV.</span></div>';
            }
        }
    }

    function renderBankImportPreview(preview) {
        const results = document.getElementById('rentalBankImportResults');
        if (!results) {
            return;
        }
        const warnings = Array.isArray(preview?.warnings) ? preview.warnings : [];
        const suggestions = Array.isArray(preview?.suggestions) ? preview.suggestions : [];
        results.innerHTML = `
            ${warnings.map(warning => `<div class="rental-warning">${escapeHtml(warning)}</div>`).join('')}
            <div class="rental-import-summary">Transakcje: ${Number(preview?.transactionCount || 0)} • Tryb AI: ${escapeHtml(preview?.llmMode || 'pomocniczy')}</div>
            ${suggestions.length === 0 ? '<div class="rental-empty"><strong>Brak transakcji do pokazania.</strong><span>Sprawdź, czy CSV/TXT ma nagłówki daty, kwoty, opisu i kontrahenta.</span></div>' : `
                <div class="rental-table-wrap">
                    <table class="rental-table">
                        <thead>
                            <tr>
                                <th>Data</th>
                                <th>Kwota</th>
                                <th>Opis</th>
                                <th>Sugestia</th>
                                <th>Pewność</th>
                                <th>Decyzja</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${suggestions.map(item => `
                                <tr>
                                    <td>${escapeHtml(item.transaction?.date || '')}</td>
                                    <td>${money(item.transaction?.amount || 0)}</td>
                                    <td>${escapeHtml(item.transaction?.title || item.transaction?.contractor || '')}</td>
                                    <td>${escapeHtml(item.tenantName || 'Do ręcznego sprawdzenia')}</td>
                                    <td>${formatPercent(item.confidence || 0)}</td>
                                    <td>${item.requiresReview ? 'Wymaga zatwierdzenia' : 'Gotowe do zatwierdzenia'}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `}
        `;
    }

    return {
        openRentalsPanel,
        renderRentalsPanel,
        switchRentalView,
        changeRentalMonth: renderRentalsPanel,
        changeRentalYear: renderRentalsPanel,
        previewBankImport
    };
}
