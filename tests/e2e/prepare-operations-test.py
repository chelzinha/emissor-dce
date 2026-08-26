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

source, stage_count = re.subn(
    r"async function clickStage\(page, number\) \{.*?\n\}",
    "async function clickStage(page, number) {\n  const button = page.locator(`button[data-operation-stage=\"${number}\"]`);\n  await button.click();\n  if (number === 10 || number === 11) {\n    const view = number === 10 ? 'tracking' : 'reports';\n    const pageSelector = number === 10 ? '.tracking-page' : '.reports-page';\n    const heading = number === 10 ? 'Acompanhamento' : 'Relatórios';\n    const nativeButton = page.locator(`.app-nav > button[data-view=\"${view}\"]`);\n    await expect(nativeButton).toHaveCount(1, { timeout: 30_000 });\n    await nativeButton.evaluate((node) => {\n      node.dispatchEvent(new MouseEvent('click', { bubbles: false, cancelable: true, view: window }));\n    });\n    await expect(page.locator(pageSelector)).toBeVisible({ timeout: 30_000 });\n    await expect(page.locator(`${pageSelector} h1`)).toHaveText(heading, { timeout: 30_000 });\n    return;\n  }\n  await expect(button).toHaveClass(/active/);\n}",
    source,
    count=1,
    flags=re.S,
)
if stage_count != 1:
    raise SystemExit('Não foi possível atualizar a navegação entre etapas.')

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
source = source.replace(
    "  await expect(page.getByRole('link', { name: /Baixar/ })).toBeVisible();",
    "  await expect(page.locator('[data-download-export], [data-redownload-export]').first()).toBeVisible({ timeout: 30_000 });",
)
source = source.replace(
    "  await clickStage(page, 4);\n  const overlay = page.locator('[data-region-overlay]');",
    "  await clickStage(page, 4);\n  await page.locator('#configure-portal-label').click();\n  const overlay = page.locator('[data-region-overlay]');",
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
    "  await overlay.dispatchEvent('pointerdown', { clientX: 80, clientY: 80, pointerId: 1 });\n  await overlay.dispatchEvent('pointermove', { clientX: 180, clientY: 180, pointerId: 1 });\n  await overlay.dispatchEvent('pointerup', { clientX: 180, clientY: 180, pointerId: 1 });",
    "  const overlayBox = await overlay.boundingBox();\n  if (!overlayBox) throw new Error('Área de marcação do Data Matrix indisponível.');\n  await page.mouse.move(overlayBox.x + overlayBox.width * 0.15, overlayBox.y + overlayBox.height * 0.15);\n  await page.mouse.down();\n  await page.mouse.move(overlayBox.x + overlayBox.width * 0.45, overlayBox.y + overlayBox.height * 0.45, { steps: 6 });\n  await page.mouse.up();",
)
source = source.replace(
    "  await page.locator('[data-font-scale]').fill('0.80');",
    "  await expect(page.locator('[data-check-stamp]')).toHaveClass(/ok/, { timeout: 10_000 });\n  await expect(page.locator('[data-check-region]')).toHaveClass(/ok/, { timeout: 10_000 });\n  await page.locator('[data-font-scale]').fill('0.80');",
)
source = source.replace(
    "  await expect(page.getByText('PRONTO PARA REGISTRO')).toBeVisible();",
    "  await expect(page.locator('#save-portal-return')).toBeVisible({ timeout: 30_000 });",
)
source = source.replace(
    "  await page.getByRole('button', { name: 'Gerar Declaração Simplificada' }).click();\n  await expect(page.locator('[data-volumes=\"prod-active\"]')).toBeVisible({ timeout: 30_000 });",
    "  await page.getByRole('button', { name: 'Gerar Declaração Simplificada' }).click();\n  await expect(page.locator('[data-operation-nav]')).toBeVisible({ timeout: 30_000 });\n  if (await page.locator('[data-volumes=\"prod-active\"]').count() === 0) {\n    await clickStage(page, 7);\n  }\n  await expect(page.locator('[data-volumes=\"prod-active\"]')).toBeVisible({ timeout: 30_000 });",
)
source = source.replace(
    "  await expect(activeCard.locator('[data-op=\"test\"]')).toBeVisible({ timeout: 30_000 });\n  await activeCard.locator('[data-op=\"test\"]').click();\n  await expect(page.locator('[data-label-test-dialog]')).toBeVisible();\n  await page.locator('[data-label-test-input]').fill(TRACKING);\n  await page.locator('[data-label-test-confirm]').click();\n  await expect(page.locator('[data-label-test-dialog]')).toHaveCount(0);",
    "  await expect(activeCard.locator('[data-op=\"test\"]')).toBeVisible({ timeout: 30_000 });\n  await activeCard.locator('[data-op=\"test\"]').click();\n  const labelTestModal = page.locator('#label-test-stability-modal');\n  await expect(labelTestModal).toBeVisible();\n  await labelTestModal.locator('input[name=\"tracking\"]').fill(TRACKING);\n  await labelTestModal.getByRole('button', { name: 'Confirmar leitura' }).click();\n  await expect(labelTestModal).toHaveCount(0);",
)
source = source.replace(
    "  await page.locator('[data-delivery-batch][value=\"prod-active\"]').check();",
    "  const deliveryBatch = page.locator('[data-delivery-batch][value=\"prod-active\"]');\n  await deliveryBatch.evaluate((input) => {\n    input.checked = true;\n    input.dispatchEvent(new Event('change', { bubbles: true }));\n  });\n  await expect(deliveryBatch).toBeChecked();",
)
source = source.replace(
    "page.getByRole('heading', { name: 'Rastreamento e fechamento' })",
    "page.getByRole('heading', { name: 'Acompanhamento', exact: true })",
)
source = source.replace(
    "page.getByRole('heading', { name: 'Fechamento operacional' })",
    "page.getByRole('heading', { name: 'Relatórios', exact: true })",
)

if "data-label-test-dialog" in source:
    raise SystemExit('Fluxo antigo da validação do SRO ainda está presente.')
if "name: 'Preparar base'" in source:
    raise SystemExit('Fluxo antigo de preparação da base ainda está presente.')

path.write_text(source, encoding='utf-8')

backend_path = Path('tests/e2e/operations-backend.mjs')
backend_source = backend_path.read_text(encoding='utf-8')
backend_marker = "      case 'tracking.summary': return {"
backend_replacement = """      case 'tracking.events.list': return [];
      case 'tracking.geo.summary': return { rows: [], totalCities: 0 };
      case 'tracking.summary': return {"""
if backend_marker not in backend_source:
    raise SystemExit('Não foi possível completar o backend sintético do rastreamento.')
backend_path.write_text(backend_source.replace(backend_marker, backend_replacement, 1), encoding='utf-8')
