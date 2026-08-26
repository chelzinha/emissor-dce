from pathlib import Path
import re

path = Path('tests/e2e/operations-flow.spec.mjs')
source = path.read_text(encoding='utf-8')

source = source.replace('http://127.0.0.1:4173', 'http://localhost:4173')
source = source.replace(
    "import { PDFDocument } from 'pdf-lib';",
    "import { PDFDocument } from 'pdf-lib';\nimport { installOperationsBackend } from './operations-backend.mjs';",
)

source, count = re.subn(
    r"function installBackend\(page\) \{.*?\n\}\n\nasync function clickStage",
    "function installBackend(page) {\n  return installOperationsBackend(page, {\n    state: baseState(),\n    tracking: TRACKING,\n    header: CSV_HEADER,\n    row: CSV_ROW,\n  });\n}\n\nasync function clickStage",
    source,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit('Não foi possível substituir o backend antigo do teste.')

old = """  await page.goto(APP_URL);\n  await expect(page.getByText('Passo a passo da operação')).toBeVisible();"""
new = """  await page.goto(APP_URL);\n  await expect(page.locator('[data-operation-nav]')).toBeVisible({ timeout: 30_000 });"""
if old not in source:
    raise SystemExit('Trecho de entrada local não localizado no teste.')
source = source.replace(old, new)

source = source.replace(
    "  await page.locator('#base-file').setInputFiles(file);\n  await expect(page.getByText('SEDEX_250_26.08.csv')).toBeVisible({ timeout: 30_000 });\n  await page.getByRole('button', { name: 'Preparar base' }).click();",
    "  await page.locator('#base-file').setInputFiles(file);\n  await page.getByRole('button', { name: 'Importar base completa' }).click();\n  await expect(page.locator('[data-operation-nav]')).toBeVisible({ timeout: 30_000 });\n  await clickStage(page, 1);\n  await expect(page.getByText('SEDEX_250_26.08.csv', { exact: true })).toBeVisible({ timeout: 30_000 });",
)

source = source.replace(
    "await expect(page.getByText('Arquivos prontos para o Portal Postal.')).toBeVisible();\n\n  await clickStage(page, 2);",
    "await expect(page.getByText('Arquivos prontos para o Portal Postal.')).toBeVisible({ timeout: 30_000 });\n  await page.waitForTimeout(1_000);\n  await expect(page.locator('[data-operation-nav]')).toBeVisible({ timeout: 30_000 });\n\n  await clickStage(page, 2);",
)

source = source.replace("[data-region-overlay]", "[data-overlay]")
source = source.replace("[data-postage-mark]", "[data-stamp]")
source = source.replace("[data-save-setup]", "[data-save]")
source = source.replace(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4i8AAAAASUVORK5CYII=",
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGNkYGD4z8DAwMDEAAUADigBA0dwHFEAAAAASUVORK5CYII=",
)
source = source.replace(
    "  await expect(overlay).toBeVisible({ timeout: 30_000 });",
    "  await expect(overlay).toBeVisible({ timeout: 30_000 });\n  await expect(page.locator('.label-preview-loading')).toHaveCount(0, { timeout: 30_000 });",
)
source = source.replace(
    "  await page.locator('[data-font-scale]').fill('0.80');",
    "  await expect(page.locator('[data-check-stamp]')).toHaveClass(/ok/, { timeout: 10_000 });\n  await expect(page.locator('[data-check-region]')).toHaveClass(/ok/);\n  await page.locator('[data-font-scale]').fill('0.80');",
)
source = source.replace(
    "  await page.getByRole('button', { name: 'Gerar Declaração Simplificada' }).click();\n  await expect(page.locator('[data-volumes=\"prod-active\"]')).toBeVisible({ timeout: 30_000 });",
    "  await page.getByRole('button', { name: 'Gerar Declaração Simplificada' }).click();\n  await expect(page.locator('[data-operation-nav]')).toBeVisible({ timeout: 30_000 });\n  if (await page.locator('[data-volumes=\"prod-active\"]').count() === 0) {\n    await clickStage(page, 7);\n  }\n  await expect(page.locator('[data-volumes=\"prod-active\"]')).toBeVisible({ timeout: 30_000 });",
)
source = source.replace(
    "  await expect(activeCard.locator('[data-op=\"test\"]')).toBeVisible({ timeout: 30_000 });\n  await activeCard.locator('[data-op=\"test\"]').click();\n  await expect(page.locator('[data-label-test-dialog]')).toBeVisible();\n  await page.locator('[data-label-test-input]').fill(TRACKING);\n  await page.locator('[data-label-test-confirm]').click();\n  await expect(page.locator('[data-label-test-dialog]')).toHaveCount(0);",
    "  await expect(activeCard.locator('[data-op=\"test\"]')).toBeVisible({ timeout: 30_000 });\n  await activeCard.locator('[data-op=\"test\"]').click();\n  const labelTestModal = page.locator('#label-test-stability-modal');\n  await expect(labelTestModal).toBeVisible();\n  await labelTestModal.locator('input[name=\"tracking\"]').fill(TRACKING);\n  await labelTestModal.getByRole('button', { name: 'Confirmar leitura' }).click();\n  await expect(labelTestModal).toHaveCount(0);",
)

if "data-label-test-dialog" in source:
    raise SystemExit('Fluxo antigo da validação do SRO ainda está presente.')
if "name: 'Preparar base'" in source:
    raise SystemExit('Fluxo antigo de preparação da base ainda está presente.')

path.write_text(source, encoding='utf-8')
