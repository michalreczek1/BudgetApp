export function createActionsController({
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
    getEditingIncomeId,
    getEditingPaymentId,
    appStorage,
    storageKeys,
    loadIncomes,
    loadPayments,
    updateCalculations,
    saveIncome,
    savePayment,
    changePin,
    downloadBackup,
    restoreBackup,
    installApp
}) {
    function deletePayment(id) {
        const stored = appStorage.getItem(storageKeys.PAYMENTS);
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
        appStorage.setItem(storageKeys.PAYMENTS, JSON.stringify(payments));
        loadPayments();
        updateCalculations();
        return true;
    }

    function deleteIncome(id) {
        const stored = appStorage.getItem(storageKeys.INCOMES);
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
        appStorage.setItem(storageKeys.INCOMES, JSON.stringify(incomes));
        loadIncomes();
        updateCalculations();
        return true;
    }

    function deletePaymentFromModal() {
        const editingPaymentId = getEditingPaymentId();
        if (editingPaymentId === null) {
            return;
        }

        if (deletePayment(editingPaymentId)) {
            closePaymentModal();
        }
    }

    function deleteIncomeFromModal() {
        const editingIncomeId = getEditingIncomeId();
        if (editingIncomeId === null) {
            return;
        }

        if (deleteIncome(editingIncomeId)) {
            closeIncomeModal();
        }
    }

    const publicActions = {
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
        deleteIncomeFromModal,
        deletePaymentFromModal,
        saveIncome,
        savePayment,
        changePin,
        downloadBackup,
        restoreBackup,
        installApp
    };

    function exposePublicActions(windowTarget) {
        Object.assign(windowTarget, publicActions);
    }

    return {
        deletePayment,
        deleteIncome,
        deletePaymentFromModal,
        deleteIncomeFromModal,
        publicActions,
        exposePublicActions
    };
}
