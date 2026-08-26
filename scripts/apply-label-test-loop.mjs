import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function write(path, content) {
  fs.writeFileSync(path, content, 'utf8');
}

function replaceExact(path, before, after) {
  const source = read(path);
  if (!source.includes(before)) {
    throw new Error(`Trecho esperado não encontrado em ${path}: ${before.slice(0, 120)}`);
  }
  write(path, source.replace(before, after));
}

replaceExact(
  'src/matrix-engine.js',
  '  const keepCrops = options.keepCrops === true;\n  const onProgress = typeof options.onProgress === "function" ? options.onProgress : () => {};',
  '  const requestedTargets = options.targetTrackingCodes || globalThis.__AGF_MATRIX_CROP_TARGETS__ || [];\n  const targetCodes = new Set([...requestedTargets].map((value) => String(value || "").replace(/\\s/g, "").toUpperCase()).filter(Boolean));\n  const targeted = targetCodes.size > 0;\n  const keepCrops = options.keepCrops === true || targeted;\n  const onProgress = typeof options.onProgress === "function" ? options.onProgress : () => {};'
);

replaceExact(
  'src/matrix-engine.js',
  '        const textCodes = trackingCodesFromText(pageText);\n        const stripe = stripeFromTextContent(textContent, page.getViewport({ scale: 1 })) || "";\n\n        crop = await renderMatrixCrop(page, region, renderScale);',
  '        const textCodes = trackingCodesFromText(pageText);\n        const stripe = stripeFromTextContent(textContent, page.getViewport({ scale: 1 })) || "";\n        const targetOnPage = !targeted || textCodes.some((code) => targetCodes.has(code));\n\n        if (targeted && !targetOnPage) {\n          processed += 1;\n          onProgress({ processed, totalPages, object: null, origin: "", skipped: true });\n          continue;\n        }\n\n        crop = await renderMatrixCrop(page, region, renderScale);'
);

replaceExact(
  'src/matrix-engine.js',
  '          if (keepCrops) crops.set(object, selectedCrop.toDataURL("image/png"));',
  '          if (keepCrops && (!targeted || targetCodes.has(object))) {\n            crops.set(object, selectedCrop.toDataURL("image/png"));\n          }'
);

replaceExact(
  'src/production-label-generator.js',
  'async function matrixCrops(portalReturnId, onProgress) {',
  'async function matrixCrops(portalReturnId, trackingCodes, onProgress) {'
);

replaceExact(
  'src/production-label-generator.js',
  '  const cacheKey = `${portalReturnId}:${JSON.stringify(region)}`;\n  if (CROP_CACHE.has(cacheKey)) return CROP_CACHE.get(cacheKey);\n\n  const { pdfjsLib, ZXing } = await loadPostalVendors();\n  const documents = await loadPdfDocuments(assets.pdfFiles, pdfjsLib);\n  const audit = await auditPdfDocuments(documents, ZXing, { region, onProgress });\n  const verified = await verifyCrops(audit.crops, ZXing);\n  const failed = verified.filter((row) => !row.ok);\n  if (failed.length) throw new Error(`${failed.length} Data Matrix falharam na releitura antes da geração.`);\n  CROP_CACHE.set(cacheKey, audit.crops);\n  return audit.crops;',
  '  const targets = [...new Set((trackingCodes || []).map(normalizeTracking).filter(Boolean))].sort();\n  if (!targets.length) throw new Error(\'Nenhum SRO foi informado para gerar as etiquetas.\');\n  const cacheKey = `${portalReturnId}:${JSON.stringify(region)}:${targets.join("|")}`;\n  if (CROP_CACHE.has(cacheKey)) return CROP_CACHE.get(cacheKey);\n\n  const { pdfjsLib, ZXing } = await loadPostalVendors();\n  const documents = await loadPdfDocuments(assets.pdfFiles, pdfjsLib);\n  let audit;\n  try {\n    audit = await auditPdfDocuments(documents, ZXing, {\n      region,\n      onProgress,\n      targetTrackingCodes: targets,\n    });\n  } finally {\n    for (const item of documents) {\n      try { await item.doc.destroy?.(); } catch {}\n    }\n  }\n  const verified = await verifyCrops(audit.crops, ZXing);\n  const failed = verified.filter((row) => !row.ok);\n  const missing = targets.filter((code) => !audit.crops.has(code));\n  if (failed.length || missing.length) {\n    throw new Error(`${failed.length + missing.length} Data Matrix não puderam ser recuperados para a geração.`);\n  }\n  CROP_CACHE.set(cacheKey, audit.crops);\n  return audit.crops;'
);

replaceExact(
  'src/production-label-generator.js',
  '  const crops = await matrixCrops(data.portalReturnId, (progress) => onProgress?.(`Lendo Data Matrix: ${progress.processed || 0}/${progress.totalPages || 0}`));',
  '  const targetTrackingCodes = data.objects.map((object) => normalizeTracking(object.trackingCode));\n  const crops = await matrixCrops(data.portalReturnId, targetTrackingCodes, (progress) => onProgress?.(`Localizando Data Matrix: ${progress.processed || 0}/${progress.totalPages || 0}`));'
);

const sessionResume = `const ROOT = document.querySelector('#elections-app');
const KEY = 'AGF_OPERATIONS_RESUME_V1';
const MAX_AGE_MS = 10 * 60 * 1000;
const MAX_RESTORE_ATTEMPTS = 120;

function clearResume() {
  try { sessionStorage.removeItem(KEY); } catch {}
}

function readResume() {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    if (!value || !value.savedAt || Date.now() - Number(value.savedAt) > MAX_AGE_MS) {
      clearResume();
      return null;
    }
    return value;
  } catch {
    clearResume();
    return null;
  }
}

function saveResume() {
  const view = ROOT?.querySelector('.app-nav button.active[data-view]')?.dataset.view || '';
  const campaignId = ROOT?.querySelector('#campaign-select')?.value || '';
  if (!view || !campaignId) return;
  try { sessionStorage.setItem(KEY, JSON.stringify({ view, campaignId, savedAt: Date.now() })); } catch {}
}

let restoring = false;
let finished = false;
let attempts = 0;
let scheduled = false;
let observer;

function finishRestore() {
  finished = true;
  observer?.disconnect();
}

function restoreOnce() {
  if (finished || restoring) return;
  const saved = readResume();
  if (!saved) {
    finishRestore();
    return;
  }

  const select = ROOT?.querySelector('#campaign-select');
  if (!select) {
    if (++attempts >= MAX_RESTORE_ATTEMPTS) {
      clearResume();
      finishRestore();
    }
    return;
  }

  const hasCampaign = [...select.options].some((option) => option.value === saved.campaignId);
  if (!hasCampaign) {
    clearResume();
    finishRestore();
    return;
  }

  if (select.value !== saved.campaignId) {
    restoring = true;
    select.value = saved.campaignId;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    restoring = false;
    return;
  }

  const button = ROOT.querySelector(\`.app-nav button[data-view="\${CSS.escape(saved.view)}"]\`);
  if (!button) {
    if (++attempts >= MAX_RESTORE_ATTEMPTS) {
      clearResume();
      finishRestore();
    }
    return;
  }

  clearResume();
  finishRestore();
  if (!button.classList.contains('active')) button.click();
}

function scheduleRestore() {
  if (finished || scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    restoreOnce();
  });
}

window.addEventListener('beforeunload', saveResume);
ROOT?.addEventListener('click', (event) => {
  if (event.target.closest?.('#signout')) clearResume();
});

observer = new MutationObserver(scheduleRestore);
if (ROOT) observer.observe(ROOT, { childList: true, subtree: true });
scheduleRestore();
`;
write('src/elections-session-resume.js', sessionResume);

const labelTestStability = `import { dataAction } from './api.js';

const ROOT = document.querySelector('#elections-app');
const STAGE_KEY = 'AGF_OPERATION_STAGE_FULL_1_11';
const RESUME_KEY = 'AGF_OPERATIONS_RESUME_V1';
let running = false;

function campaignId() {
  return ROOT?.querySelector('#campaign-select')?.value || '';
}

function pinProductionStage() {
  try {
    sessionStorage.setItem(STAGE_KEY, '7');
    sessionStorage.removeItem(RESUME_KEY);
  } catch {}
  if (ROOT) ROOT.dataset.operationStage = '7';
}

function notify(message, type = 'info') {
  const box = document.querySelector('#elections-toast');
  if (!box) return;
  box.textContent = message;
  box.className = \`elections-toast show \${type}\`;
  clearTimeout(box._labelTestStabilityTimer);
  box._labelTestStabilityTimer = setTimeout(() => { box.className = 'elections-toast'; }, 5200);
}

function batchIdFromButton(button) {
  return String(button.closest('.card')?.querySelector('[data-volumes]')?.dataset.volumes || '');
}

function askTrackingCode(expected) {
  return new Promise((resolve) => {
    document.querySelector('#label-test-stability-modal')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'label-test-stability-modal';
    overlay.className = 'busy-overlay';
    overlay.innerHTML = \`<form class="busy-card" style="width:min(520px,calc(100vw - 32px));text-align:left">
      <strong style="display:block;font-size:18px">Validar etiqueta teste</strong>
      <p style="margin:10px 0;color:#607085">Imprima a etiqueta teste e digite ou leia com o scanner o SRO impresso.</p>
      <label class="field"><span>SRO esperado</span><input value="\${expected}" readonly></label>
      <label class="field" style="margin-top:10px"><span>SRO lido na etiqueta</span><input name="tracking" autocomplete="off" spellcheck="false" required></label>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
        <button type="button" class="ghost" data-cancel>Cancelar</button>
        <button type="submit" class="primary">Confirmar leitura</button>
      </div>
    </form>\`;
    document.body.appendChild(overlay);
    const form = overlay.querySelector('form');
    const input = form.querySelector('input[name="tracking"]');
    input.focus();
    const finish = (value) => {
      overlay.remove();
      resolve(value);
    };
    form.onsubmit = (event) => {
      event.preventDefault();
      finish(input.value);
    };
    form.querySelector('[data-cancel]').onclick = () => finish(null);
  });
}

function remountCard(button) {
  const card = button.closest('.card');
  card?.querySelector('.production-ops-gates')?.remove();
  card?.querySelector('.production-documents')?.remove();
}

async function approveLabelTest(button) {
  if (running) return;
  const cid = campaignId();
  const batchId = batchIdFromButton(button);
  if (!cid || !batchId) {
    notify('Não foi possível identificar a operação ou o lote.', 'error');
    return;
  }

  running = true;
  button.disabled = true;
  pinProductionStage();
  try {
    const data = await dataAction('production.labelTest.data', {
      campaignId: cid,
      productionBatchId: batchId,
    });
    pinProductionStage();
    const readTrackingCode = await askTrackingCode(String(data.trackingCode || ''));
    pinProductionStage();
    if (readTrackingCode == null) return;
    await dataAction('production.labelTest.approve', {
      campaignId: cid,
      productionBatchId: batchId,
      readTrackingCode,
    });
    pinProductionStage();
    remountCard(button);
    notify('Etiqueta teste aprovada. O lote está pronto para avançar à impressão.', 'success');
  } catch (error) {
    pinProductionStage();
    notify(error.message || 'Não foi possível validar a etiqueta teste.', 'error');
  } finally {
    running = false;
    button.disabled = false;
  }
}

document.addEventListener('click', (event) => {
  const testButton = event.target.closest?.('[data-op="test"]');
  if (testButton && ROOT?.contains(testButton)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    approveLabelTest(testButton);
    return;
  }

  const generationButton = event.target.closest?.('[data-generate-test],[data-generate-volume]');
  if (generationButton && ROOT?.contains(generationButton)) pinProductionStage();
}, true);
`;
write('src/elections-label-test-stability.js', labelTestStability);

replaceExact(
  'eleicoes.html',
  '    <script type="module" src="/src/elections-production-ops-ui.js"></script>\n    <script type="module" src="/src/elections-production-matrix-inheritance.js"></script>',
  '    <script type="module" src="/src/elections-production-ops-ui.js"></script>\n    <script type="module" src="/src/elections-label-test-stability.js"></script>\n    <script type="module" src="/src/elections-production-matrix-inheritance.js"></script>'
);

const test = `import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const matrix = fs.readFileSync(new URL('../src/matrix-engine.js', import.meta.url), 'utf8');
const generator = fs.readFileSync(new URL('../src/production-label-generator.js', import.meta.url), 'utf8');
const resume = fs.readFileSync(new URL('../src/elections-session-resume.js', import.meta.url), 'utf8');
const stability = fs.readFileSync(new URL('../src/elections-label-test-stability.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../eleicoes.html', import.meta.url), 'utf8');

test('geração busca apenas Data Matrix dos SROs necessários', () => {
  assert.match(matrix, /targetTrackingCodes/);
  assert.match(matrix, /targeted && !targetOnPage/);
  assert.match(generator, /matrixCrops\(portalReturnId, trackingCodes, onProgress\)/);
  assert.match(generator, /targetTrackingCodes: targets/);
  assert.match(generator, /targets\.join\("\\\|"\)/);
});

test('restauração de sessão encerra o observer após uma única recuperação', () => {
  assert.match(resume, /function finishRestore/);
  assert.match(resume, /observer\?\.disconnect\(\)/);
  assert.match(resume, /function restoreOnce/);
});

test('etiqueta teste usa modal estável e mantém etapa de produção', () => {
  assert.match(stability, /data-op="test"/);
  assert.match(stability, /askTrackingCode/);
  assert.match(stability, /sessionStorage\.removeItem\(RESUME_KEY\)/);
  assert.doesNotMatch(stability, /location\.reload/);
  assert.match(html, /elections-label-test-stability\.js/);
});
`;
write('tests/label-test-loop.test.mjs', test);
