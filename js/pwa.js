function isAndroidMobile() {
    return /Android/i.test(navigator.userAgent || '');
}

function isStandaloneMode() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

export function createPwaController({ showToast }) {
    let deferredInstallPrompt = null;

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
            showToast('Aby dodać aplikację, użyj menu Chrome i wybierz "Dodaj do ekranu głównego".', 'info');
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

    return {
        updateInstallButtonVisibility,
        setupPwaInstallPrompt,
        installApp,
        registerServiceWorker
    };
}
