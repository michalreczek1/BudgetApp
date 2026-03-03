import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');
const tempRoot = mkdtempSync(path.join(tmpdir(), 'budget-tenant-e2e-'));
const dbPath = path.join(tempRoot, 'tenant-e2e.db');
const backupDir = path.join(tempRoot, 'backups');
const port = 8147;
const baseUrl = `http://127.0.0.1:${port}`;

mkdirSync(backupDir, { recursive: true });

let serverProcess;

async function waitForServer() {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(`${baseUrl}/api/auth/status`);
            if (response.ok) {
                return;
            }
        } catch {
            // Retry until server is ready.
        }
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error('Server did not start in time');
}

test.beforeAll(async () => {
    serverProcess = spawn(
        'python',
        ['server.py', '--host', '127.0.0.1', '--port', String(port), '--db', dbPath],
        {
            cwd: projectRoot,
            env: {
                ...process.env,
                BACKUP_DIR: backupDir
            },
            stdio: 'pipe'
        }
    );

    serverProcess.stderr.on('data', chunk => {
        process.stderr.write(String(chunk));
    });

    await waitForServer();
});

test.afterAll(async () => {
    if (serverProcess && !serverProcess.killed) {
        serverProcess.kill('SIGTERM');
    }
    rmSync(tempRoot, { recursive: true, force: true });
});

async function login(page) {
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.fill('#pin1', '1');
    await page.fill('#pin2', '2');
    await page.fill('#pin3', '3');
    await page.fill('#pin4', '4');
    await page.getByRole('button', { name: 'Zaloguj się' }).click();
    await expect(page.locator('#mainApp')).toBeVisible();
}

test('tenant payments flow updates balance, analysis and monthly state', async ({ page }) => {
    await login(page);

    await expect(page.locator('#tenantDashboardSummary')).toContainText('Brak aktywnych najemców');
    await expect(page.locator('.tenant-report-section')).toBeVisible();

    await page.getByTitle('Wpłaty najemców').click();
    await expect(page.locator('#tenantPaymentsModal')).toBeVisible();

    await page.fill('#tenantName1', 'Kowalski');
    await page.fill('#tenantAmount1', '1800');
    await page.fill('#tenantDueDay1', '1');
    await page.getByRole('button', { name: 'Zapisz dane najemców' }).click();

    await expect(page.locator('#tenantPaymentsSummary')).toContainText('Po terminie: 1');
    await expect(page.locator('#tenantActive1')).toBeChecked();
    await expect(page.locator('#tenantDashboardSummary')).toContainText('Oczekuje 1 800');
    await expect(page.locator('#tenantDashboardList')).toContainText('Kowalski');
    await expect(page.locator('#tenantDashboardList')).toContainText('Po terminie');
    await expect(page.locator('#tenantDashboardList')).toContainText('Zapłacił');

    await page.locator('#tenantPaymentsModal').getByRole('button', { name: 'Zamknij' }).click();
    await page.locator('#tenantDashboardList').getByRole('button', { name: 'Zapłacił' }).click();
    await expect(page.locator('#currentBalance')).toContainText('1 800');
    await expect(page.locator('#tenantDashboardSummary')).toContainText('Wpłacono 1 800');
    await expect(page.locator('#tenantDashboardList')).toContainText('Zapłacono');
    await expect(page.locator('#tenantDashboardList')).toContainText('Cofnij');

    await page.getByTitle('Analiza wpływów').click();
    await expect(page.locator('#incomeAnalysisModal')).toBeVisible();
    await expect(page.locator('#incomeAnalysisList')).toContainText('najem');
    await page.locator('#incomeAnalysisModal').getByRole('button', { name: 'Zamknij' }).click();

    await page.getByTitle('Wpłaty najemców').click();
    await page.fill('#tenantPaymentsMonth', '2026-04');
    await page.locator('#tenantPaymentsMonth').dispatchEvent('change');
    await expect(page.locator('#tenantPaymentsSummary')).toContainText('Oczekuje: 1');
    await expect(page.locator('#tenantPaymentsSummary')).toContainText('Zapłacono: 0');

    await page.fill('#tenantPaymentsMonth', '2026-03');
    await page.locator('#tenantPaymentsMonth').dispatchEvent('change');
    await expect(page.locator('#tenantPaymentsSummary')).toContainText('Zapłacono: 1');
    await page.locator('#tenantPaymentsModal').getByRole('button', { name: 'Zamknij' }).click();
    await page.locator('#tenantDashboardList').getByRole('button', { name: 'Cofnij' }).click();
    await page.getByTitle('Wpłaty najemców').click();
    await expect(page.locator('#tenantPaymentsSummary')).toContainText('Po terminie: 1');
    await expect(page.locator('#currentBalance')).toContainText('0,00');
    await expect(page.locator('#tenantDashboardSummary')).toContainText('Oczekuje 1 800');
    await expect(page.locator('#tenantDashboardList')).toContainText('Po terminie');
});
