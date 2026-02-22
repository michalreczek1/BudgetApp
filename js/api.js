async function parseJsonSafe(response, fallbackValue = {}) {
    try {
        return await response.json();
    } catch {
        return fallbackValue;
    }
}

function buildHttpError(message, status, details) {
    const error = new Error(message);
    error.status = status;
    if (details !== undefined) {
        error.details = details;
    }
    return error;
}

export async function apiFetchState() {
    const response = await fetch('/api/state', {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        cache: 'no-store',
        credentials: 'same-origin'
    });

    if (!response.ok) {
        const details = await parseJsonSafe(response, {});
        throw buildHttpError(`GET /api/state failed: ${response.status}`, response.status, details);
    }

    return response.json();
}

export async function apiSaveState(payload) {
    const response = await fetch('/api/state', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'same-origin'
    });

    if (!response.ok) {
        const details = await parseJsonSafe(response, {});
        throw buildHttpError(`PUT /api/state failed: ${response.status}`, response.status, details);
    }

    return parseJsonSafe(response, {});
}

export async function apiFetchAuthStatus() {
    const response = await fetch('/api/auth/status', {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        cache: 'no-store',
        credentials: 'same-origin'
    });

    if (!response.ok) {
        throw buildHttpError(`GET /api/auth/status failed: ${response.status}`, response.status);
    }

    return response.json();
}

export async function apiRunSettlement(reason) {
    const response = await fetch('/api/settlements/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ reason })
    });

    const data = await parseJsonSafe(response, {});
    if (!response.ok) {
        throw buildHttpError(`POST /api/settlements/run failed: ${response.status}`, response.status, data);
    }

    return data;
}

export async function apiFetchTransactionsForAnalysis(entryType, monthValue) {
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
        const details = await parseJsonSafe(response, {});
        throw buildHttpError(`GET /api/transactions failed: ${response.status}`, response.status, details);
    }

    return response.json();
}
