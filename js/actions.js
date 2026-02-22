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
    deleteIncome,
    deletePayment,
    saveIncome,
    savePayment,
    changePin,
    downloadBackup,
    restoreBackup,
    installApp
}) {
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
        deletePaymentFromModal,
        deleteIncomeFromModal,
        publicActions,
        exposePublicActions
    };
}
