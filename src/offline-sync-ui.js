import { dataAction } from './api.js';
import { loadPostalVendors } from './postal-vendors.js';
import { parseOfflineManifest } from './offline-manifest.js';
import {
  OFFLINE_SYNC_MODES,
  offlineObjectSetSha256,
  rawFileFingerprints,
  verifyOfflineSourceFiles,
  buildOfflineSyncInspectPayload,
  buildOfflineSyncStartPayload,
  chunkOfflineRows,
  summarizeOfflineSyncPlan,
  sha256Hex,
} from './offline-sync.js';
import { analyzePortalReturn } from './portal-return-service.js';
import { buildPortalReturnBackendRows } from './portal-return.js';

const sessions = new WeakMap();

function text(value) { return String(value == null ? '' : value).trim(); }
function h(value) { return text(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
function number(value) { return new Intl.NumberFormat('pt-BR').format(Number(value || 0)); }
function code(value) { return text(value).replace(/\s/g, '').toUpperCase(); }
function service(value) {
  const current = text(value).toUpperCase();
  if (current.includes('SEDEX')) return 'SEDEX';
  if (current.startsWith('PAC') || current.startsWith('MINI')) return 'PAC';
  return current;
}

function setStatus(root, message, type = '') {
  const slot = root.querySelector('[data-offline-sync-status]');
  if (!slot) return;
  slot.className = `offline-sync-status ${type}`;
  slot.innerHTML = message;
}

function renderManifest(root, session) {
  const slot = root.querySelector('[data-offline-manifest-summary]');
  if (!slot || !session?.manifest) return;
  const m = session.manifest;
  slot.innerHTML = `<div class="offline-sync-summary-grid">
    <span><b>${number(m.summary?.total)}</b><small>objetos</small></span>
    <span><b>${number(m.summary?.pac)}</b><small>PAC</small></span>
    <span><b>${number(m.summary?.sedex)}</b><small>SEDEX</small></span>
    <span><b>${number(m.volumes?.length)}</b><small>volumes</small></span>
  </div>
  <p><b>Lote local:</b> ${h(m.batchId)} · <b>modo:</b> ${h(m.documentMode)}</p>
  <p><b>Referência:</b> ${h(m.operationReference || '—')} · <b>eventos físicos:</b> ${number(m.operationEvents?.length || 0)}</p>`;
}

function renderInspect(root, session) {
  const slot = root.querySelector('[data-offline-inspect]');
  const sources = root.querySelector('[data-offline-sources]');
  const action = root.querySelector('[data-offline-sync-run]');
  if (!slot || !session?.inspect) return;
  const plan = summarizeOfflineSyncPlan({ manifest: session.manifest, inspectResult: session.inspect, sourceVerification: session.sourceVerification });
  const modeLabel = {
    NEW_IMPORT: 'NOVO LOTE',
    RECONCILE_EXISTING: 'RECONCILIAR LOTE EXISTENTE',
    EXISTING_UNASSIGNED: 'REVISÃO NECESSÁRIA',
    CONFLICT: 'CONFLITO',
    RESUME: 'SINCRONIZAÇÃO JÁ INICIADA',
  }[session.inspect.mode] || session.inspect.mode;
  slot.innerHTML = `<strong>${h(modeLabel)}</strong><p>${h(plan.message)}</p>`;
  slot.className = `offline-sync-inspect ${plan.canProceed ? 'ok' : (session.inspect.mode === OFFLINE_SYNC_MODES.CONFLICT ? 'bad' : 'warn')}`;
  if (sources) sources.hidden = !plan.needsSourceFiles;
  if (action) action.disabled = !plan.canProceed;
}

async function loadManifest(root, campaignId) {
  const file = root.querySelector('[data-offline-manifest-file]')?.files?.[0];
  if (!file) return setStatus(root, 'Selecione um arquivo .agf.', 'warn');
  if (!campaignId) return setStatus(root, 'Selecione a operação/campanha antes de importar o manifesto.', 'warn');
  setStatus(root, 'Validando manifesto e consultando possíveis objetos já existentes...', 'busy');
  try {
    const content = await file.text();
    const manifest = parseOfflineManifest(content);
    const [objectSetSha256, manifestSha256] = await Promise.all([offlineObjectSetSha256(manifest), sha256Hex(await file.arrayBuffer())]);
    const inspectPayload = buildOfflineSyncInspectPayload({ campaignId, manifest, objectSetSha256, manifestSha256 });
    const inspect = await dataAction('offlineSync.inspect', inspectPayload);
    const session = { manifestFile: file, manifest, objectSetSha256, manifestSha256, inspect, sourceVerification: null, sourceFiles: [] };
    sessions.set(root, session);
    renderManifest(root, session);
    renderInspect(root, session);
    setStatus(root, inspect.mode === OFFLINE_SYNC_MODES.CONFLICT ? 'Conflito detectado. Nenhuma gravação foi feita.' : 'Manifesto validado. Revise o plano abaixo antes de sincronizar.', inspect.mode === OFFLINE_SYNC_MODES.CONFLICT ? 'bad' : 'ok');
  } catch (error) {
    sessions.delete(root);
    setStatus(root, h(error.message || error), 'bad');
  }
}

async function verifySources(root) {
  const session = sessions.get(root);
  if (!session?.manifest) return;
  const csv = root.querySelector('[data-offline-source-csv]')?.files?.[0] || null;
  const pdfs = [...(root.querySelector('[data-offline-source-pdfs]')?.files || [])];
  const files = [csv, ...pdfs].filter(Boolean);
  if (!csv || !pdfs.length) {
    session.sourceVerification = null;
    renderInspect(root, session);
    return setStatus(root, 'Para um lote novo, selecione o CSV e todos os PDFs originais usados na contingência.', 'warn');
  }
  setStatus(root, 'Calculando SHA-256 dos arquivos originais...', 'busy');
  try {
    const fingerprints = await rawFileFingerprints(files);
    const verification = verifyOfflineSourceFiles(session.manifest, fingerprints);
    session.sourceVerification = verification;
    session.sourceFiles = files;
    session.csvFile = csv;
    session.pdfFiles = pdfs;
    renderInspect(root, session);
    if (!verification.exact) {
      setStatus(root, `Arquivos não conferem com o manifesto. Fontes ausentes: ${h(verification.missing.map((item) => item.name || item.sha256.slice(0, 12)).join(', '))}`, 'bad');
    } else {
      setStatus(root, 'Arquivos originais conferidos por SHA-256.', 'ok');
    }
  } catch (error) { setStatus(root, h(error.message || error), 'bad'); }
}

function compareAnalysisToManifest(manifest, backendRows) {
  const expected = new Map((manifest.objects || []).map((item) => [code(item.trackingCode), service(item.service)]));
  const actual = new Map();
  const problems = [];
  for (const row of backendRows) {
    const trackingCode = code(row.trackingCode);
    const currentService = service(row.service);
    if (actual.has(trackingCode)) problems.push(`SRO_DUPLICADO:${trackingCode}`);
    actual.set(trackingCode, currentService);
    if (!expected.has(trackingCode)) problems.push(`SRO_NAO_PERTENCE_AO_MANIFESTO:${trackingCode}`);
    else if (expected.get(trackingCode) !== currentService) problems.push(`SERVICO_DIVERGENTE:${trackingCode}`);
    if (!['AUTO_VERIFIED', 'VERIFIED'].includes(text(row.matrix?.status).toUpperCase())) problems.push(`MATRIX_NAO_VERIFICADO:${trackingCode}`);
  }
  for (const trackingCode of expected.keys()) if (!actual.has(trackingCode)) problems.push(`SRO_AUSENTE:${trackingCode}`);
  return { exact: problems.length === 0 && expected.size === actual.size, problems };
}

async function analyzeNewImport(root, session) {
  if (!session.sourceVerification?.exact) throw new Error('Arquivos originais ainda não foram conferidos por SHA-256.');
  setStatus(root, 'Reauditando o Data Matrix dos PDFs originais antes de enviar qualquer linha...', 'busy');
  const { pdfjsLib, ZXing } = await loadPostalVendors();
  const analysis = await analyzePortalReturn({
    csvFile: session.csvFile,
    pdfFiles: session.pdfFiles,
    pdfjsLib,
    ZXing,
    onProgress: (progress) => {
      if (progress?.stage === 'matrix') setStatus(root, `Reauditando Data Matrix: ${number(progress.processed)} / ${number(progress.totalPages)} páginas...`, 'busy');
    },
  });
  if (!analysis.summary?.readyForProduction) throw new Error(`Retorno reanalisado não está 100% pronto: ${number(analysis.summary?.matrixVerified)} de ${number(analysis.summary?.total)} Matrix verificados.`);
  const backendRows = buildPortalReturnBackendRows(analysis.rows);
  const comparison = compareAnalysisToManifest(session.manifest, backendRows);
  if (!comparison.exact) throw new Error(`Objetos reconstruídos divergem do manifesto: ${comparison.problems.slice(0, 8).join(', ')}`);
  return backendRows;
}

async function runSync(root, campaignId) {
  const session = sessions.get(root);
  if (!session?.manifest || !session.inspect) return;
  const plan = summarizeOfflineSyncPlan({ manifest: session.manifest, inspectResult: session.inspect, sourceVerification: session.sourceVerification });
  if (!plan.canProceed) return setStatus(root, plan.message, 'warn');
  const button = root.querySelector('[data-offline-sync-run]');
  if (button) button.disabled = true;
  try {
    let reconstructedRows = null;
    const needsReconstruction = session.inspect.mode === OFFLINE_SYNC_MODES.NEW_IMPORT || (session.inspect.mode === OFFLINE_SYNC_MODES.RESUME && session.inspect.sync?.mode === OFFLINE_SYNC_MODES.NEW_IMPORT && session.inspect.sync?.status === 'RECEIVING');
    if (needsReconstruction) reconstructedRows = await analyzeNewImport(root, session);
    setStatus(root, 'Abrindo sincronização idempotente...', 'busy');
    const sync = await dataAction('offlineSync.start', buildOfflineSyncStartPayload({
      campaignId,
      manifest: session.manifest,
      objectSetSha256: session.objectSetSha256,
      manifestSha256: session.manifestSha256,
    }));
    if (reconstructedRows) {
      const chunks = chunkOfflineRows(reconstructedRows, 200);
      for (let index = 0; index < chunks.length; index += 1) {
        setStatus(root, `Enviando bloco ${index + 1} de ${chunks.length}...`, 'busy');
        await dataAction('offlineSync.append', { campaignId, syncId: sync.id, rows: chunks[index] });
      }
    }
    setStatus(root, 'Conferindo objetos e reconciliando eventos físicos...', 'busy');
    const finished = await dataAction('offlineSync.finish', { campaignId, syncId: sync.id });
    session.inspect = { mode: OFFLINE_SYNC_MODES.RESUME, completed: true, sync: finished };
    renderInspect(root, session);
    setStatus(root, `Sincronização concluída. Lote conectado ${h((finished.productionBatchId || '').slice(0, 8)) || 'registrado'} com ${number(finished.total)} objetos.`, 'ok');
    window.dispatchEvent(new CustomEvent('agf:offline-sync-completed', { detail: finished }));
  } catch (error) {
    setStatus(root, h(error.message || error), 'bad');
  } finally {
    if (button) button.disabled = false;
  }
}

export function mountOfflineSyncPanel(container, options = {}) {
  if (!container || container.querySelector('[data-offline-sync-panel]')) return;
  container.insertAdjacentHTML('afterbegin', `<section class="offline-sync-panel" data-offline-sync-panel>
    <div class="offline-sync-head"><div><p class="eyebrow">CONTINGÊNCIA</p><h2>Sincronizar lote concluído offline</h2><p>Importe o manifesto .agf. O sistema verifica hashes, SROs e sobreposição antes de criar ou reconciliar qualquer lote.</p></div><span>SEM DUPLICAÇÃO</span></div>
    <div class="offline-sync-body">
      <label>Manifesto .agf<input type="file" accept=".agf,application/json" data-offline-manifest-file></label>
      <button class="secondary" data-offline-manifest-check>Validar manifesto</button>
      <div data-offline-manifest-summary></div>
      <div data-offline-inspect></div>
      <div class="offline-sync-sources" data-offline-sources hidden>
        <p><b>Lote novo.</b> Para não transportar dados pessoais dentro do manifesto, selecione novamente os arquivos originais. Eles só serão aceitos se os SHA-256 coincidirem.</p>
        <label>CSV original<input type="file" accept=".csv,text/csv" data-offline-source-csv></label>
        <label>PDFs originais<input type="file" accept=".pdf,application/pdf" multiple data-offline-source-pdfs></label>
      </div>
      <div class="offline-sync-status" data-offline-sync-status>Aguardando manifesto.</div>
      <button class="primary" data-offline-sync-run disabled>Sincronizar com o sistema</button>
    </div>
  </section>`);
  const root = container.querySelector('[data-offline-sync-panel]');
  const campaignId = () => typeof options.campaignId === 'function' ? options.campaignId() : text(options.campaignId);
  root.querySelector('[data-offline-manifest-check]').addEventListener('click', () => loadManifest(root, campaignId()));
  root.querySelector('[data-offline-source-csv]').addEventListener('change', () => verifySources(root));
  root.querySelector('[data-offline-source-pdfs]').addEventListener('change', () => verifySources(root));
  root.querySelector('[data-offline-sync-run]').addEventListener('click', () => runSync(root, campaignId()));
}
