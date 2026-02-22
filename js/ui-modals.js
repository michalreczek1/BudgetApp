export function createUiModalsController({
    getEditingIncomeId,
    setEditingIncomeId,
    getEditingPaymentId,
    setEditingPaymentId,
    getSelectedIncomeFrequency,
    setSelectedIncomeFrequency,
    getSelectedPaymentFrequency,
    setSelectedPaymentFrequency,
    getSelectedMonths,
    setSelectedMonths
}) {
    function openIncomeModal() {
        setEditingIncomeId(null);
        setIncomeModalMode(false);
        resetIncomeForm();
        document.getElementById('incomeModal').classList.add('active');
    }

    function closeIncomeModal() {
        document.getElementById('incomeModal').classList.remove('active');
        setEditingIncomeId(null);
        setIncomeModalMode(false);
        resetIncomeForm();
    }

    function setIncomeModalMode(isEdit) {
        document.getElementById('incomeModalTitle').textContent = isEdit ? '💵 Edytuj wpływ' : '💵 Dodaj wpływ';
        document.getElementById('incomeSubmitBtn').textContent = isEdit ? 'Zapisz' : 'Dodaj';
        document.getElementById('incomeDeleteBtn').classList.toggle('hidden', !isEdit);
        document.getElementById('incomeDeleteBtn').textContent =
            isEdit && getSelectedIncomeFrequency() !== 'once' ? 'Usuń serię' : 'Usuń';
    }

    function resetIncomeForm() {
        document.getElementById('incomeName').value = '';
        document.getElementById('incomeAmount').value = '';
        document.getElementById('incomeDate').value = '';
        selectIncomeFrequency('once');
    }

    function openPaymentModal() {
        setEditingPaymentId(null);
        setPaymentModalMode(false);
        resetPaymentForm();
        document.getElementById('paymentModal').classList.add('active');
    }

    function closePaymentModal() {
        document.getElementById('paymentModal').classList.remove('active');
        setEditingPaymentId(null);
        setPaymentModalMode(false);
        resetPaymentForm();
    }

    function setPaymentModalMode(isEdit) {
        document.getElementById('paymentModalTitle').textContent = isEdit ? '➕ Edytuj płatność' : '➕ Dodaj płatność';
        document.getElementById('paymentSubmitBtn').textContent = isEdit ? 'Zapisz' : 'Dodaj';
        document.getElementById('paymentDeleteBtn').classList.toggle('hidden', !isEdit);
        document.getElementById('paymentDeleteBtn').textContent =
            isEdit && getSelectedPaymentFrequency() !== 'once' ? 'Usuń serię' : 'Usuń';
    }

    function resetPaymentForm() {
        document.getElementById('paymentName').value = '';
        document.getElementById('paymentAmount').value = '';
        document.getElementById('paymentDate').value = '';
        setSelectedMonths([]);
        syncMonthButtons();
        selectPaymentFrequency('once');
    }

    function selectPaymentFrequency(freq) {
        setSelectedPaymentFrequency(freq);
        const options = document.querySelectorAll('#paymentModal .radio-option');
        options.forEach(opt => opt.classList.remove('selected'));

        if (freq === 'once') options[0].classList.add('selected');
        else if (freq === 'monthly') options[1].classList.add('selected');
        else if (freq === 'selected') options[2].classList.add('selected');

        document.getElementById('monthSelectorGroup').classList.toggle('hidden', freq !== 'selected');
        if (getEditingPaymentId() !== null) {
            document.getElementById('paymentDeleteBtn').textContent = freq !== 'once' ? 'Usuń serię' : 'Usuń';
        }
    }

    function selectIncomeFrequency(freq) {
        setSelectedIncomeFrequency(freq);
        const options = document.querySelectorAll('#incomeModal .radio-option');
        options.forEach(opt => opt.classList.remove('selected'));

        if (freq === 'once') options[0].classList.add('selected');
        else if (freq === 'monthly') options[1].classList.add('selected');
        if (getEditingIncomeId() !== null) {
            document.getElementById('incomeDeleteBtn').textContent = freq !== 'once' ? 'Usuń serię' : 'Usuń';
        }
    }

    function toggleMonth(month) {
        const currentMonths = Array.isArray(getSelectedMonths()) ? [...getSelectedMonths()] : [];
        const idx = currentMonths.indexOf(month);
        if (idx > -1) {
            currentMonths.splice(idx, 1);
        } else {
            currentMonths.push(month);
        }

        setSelectedMonths(currentMonths);
        syncMonthButtons();
    }

    function syncMonthButtons() {
        const selectedMonths = Array.isArray(getSelectedMonths()) ? getSelectedMonths() : [];
        const monthBtns = document.querySelectorAll('.month-btn');
        monthBtns.forEach((btn, index) => {
            btn.classList.toggle('selected', selectedMonths.includes(index + 1));
        });
    }

    return {
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
    };
}
