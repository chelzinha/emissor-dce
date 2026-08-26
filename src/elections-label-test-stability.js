import { dataAction } from './api.js';

const ROOT = document.querySelector('#elections-app');
const STAGE_KEY = 'AGF_OPERATION_STAGE_FULL_1_11';
const RESUME_KEY = 'AGF_OPERATIONS_RESUME_V1';
let running = false;

function campaignId() {
  return ROOT?.querySelector('#campaign-select')?.value || '';
}

function pinProductionStage(stageNumber = 7) {
  const stage = Number(stageNumber) === 8 ? 8 : 7;
  try {
    sessionStorage.setItem(STAGE_KEY, String(stage));
    sessionStorage.removeItem(RESUME_KEY);
  } catch {}
  if (ROOT) ROOT.dataset.operationStage = String(stage);
}

function notify(message, type = 'info') {
  const box = document.querySelector('#elections-toast');
  if (!box) return;
  box.textContent = message;
  box.className = `elections-toast show ${type}`;
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
    overlay.innerHTML = `<form class="busy-card" style="width:min(520px,calc(100vw - 32px));text-align:left">
      <strong style="display:block;font-size:18px">Validar etiqueta teste</strong>
      <p style="margin:10px 0;color:#607085">Imprima a etiqueta teste e digite ou leia com o scanner o SRO impresso.</p>
      <label class="field"><span>SRO esperado</span><input value="${expected}" readonly></label>
      <label class="field" style="margin-top:10px"><span>SRO lido na etiqueta</span><input name="tracking" autocomplete="off" spellcheck="false" required></label>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
        <button type="button" class="ghost" data-cancel>Cancelar</button>
        <button type="submit" class="primary">Confirmar leitura</button>
      </div>
    </form>`;
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
  pinProductionStage(7);
  try {
    const data = await dataAction('production.labelTest.data', {
      campaignId: cid,
      productionBatchId: batchId,
    });
    pinProductionStage(7);
    const readTrackingCode = await askTrackingCode(String(data.trackingCode || ''));
    pinProductionStage(7);
    if (readTrackingCode == null) return;
    await dataAction('production.labelTest.approve', {
      campaignId: cid,
      productionBatchId: batchId,
      readTrackingCode,
    });
    pinProductionStage(7);
    remountCard(button);
    notify('Etiqueta teste aprovada. O lote está pronto para avançar à impressão.', 'success');
  } catch (error) {
    pinProductionStage(7);
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

  const testGenerationButton = event.target.closest?.('[data-generate-test]');
  if (testGenerationButton && ROOT?.contains(testGenerationButton)) {
    pinProductionStage(7);
    return;
  }

  const volumeGenerationButton = event.target.closest?.('[data-generate-volume]');
  if (volumeGenerationButton && ROOT?.contains(volumeGenerationButton)) {
    pinProductionStage(8);
  }
}, true);