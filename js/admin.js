export function createAdminController({
    adminSuccessDefaultMessage,
    handleUnauthorizedSession,
    onRestoreStateReset,
    showLoginScreen
}) {
    function openAdminPanel() {
        document.getElementById('adminModal').classList.add('active');
        document.getElementById('currentPin').value = '';
        document.getElementById('newPin').value = '';
        document.getElementById('confirmPin').value = '';
        document.getElementById('backupFileInput').value = '';
        document.getElementById('adminError').style.display = 'none';
        document.getElementById('adminSuccess').textContent = adminSuccessDefaultMessage;
        document.getElementById('adminSuccess').style.display = 'none';
    }

    function closeAdminPanel() {
        document.getElementById('adminModal').classList.remove('active');
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

            onRestoreStateReset();
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

            successElement.textContent = adminSuccessDefaultMessage;
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

    return {
        openAdminPanel,
        closeAdminPanel,
        downloadBackup,
        restoreBackup,
        changePin
    };
}
