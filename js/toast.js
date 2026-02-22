function ensureToastContainer() {
    let container = document.getElementById('toastContainer');
    if (container) {
        return container;
    }

    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    container.setAttribute('aria-live', 'polite');
    container.setAttribute('aria-atomic', 'false');
    document.body.appendChild(container);
    return container;
}

export function showToast(message, type = 'info', durationMs = 4200) {
    const normalizedMessage = String(message || '').trim();
    if (!normalizedMessage) {
        return;
    }

    const allowedTypes = new Set(['info', 'success', 'warning', 'error']);
    const toastType = allowedTypes.has(type) ? type : 'info';
    const container = ensureToastContainer();
    const toast = document.createElement('div');
    toast.className = `toast toast--${toastType}`;
    toast.setAttribute('role', toastType === 'error' ? 'alert' : 'status');
    toast.textContent = normalizedMessage;
    container.appendChild(toast);

    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    const removeToast = () => {
        if (!toast.isConnected) {
            return;
        }
        toast.classList.remove('show');
        toast.classList.add('hide');
        setTimeout(() => {
            if (toast.isConnected) {
                toast.remove();
            }
        }, 220);
    };

    setTimeout(removeToast, Math.max(1500, Number(durationMs) || 0));
}
