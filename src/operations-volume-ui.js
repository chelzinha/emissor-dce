import "./operations-volume.css";
import { dataAction, downloadBlob } from "./api.js";
import {
  buildPrintEvents,
  buildVolumeLabelModels,
  printStateFromOperations,
  validateVolumePlan,
  volumeSummary,
} from "./volume-workflow.js";
import { generateVolumeLabelsPdf } from "./volume-documents-pdf.js";
import { buildPostingProtocolModel } from "./posting-protocol.js";
import { generatePostingProtocolPdf } from "./posting-protocol-pdf.js";

const ROOT_SELECTOR = "#elections-app"; // compatibilidade temporaria; rename atomico planejado
let mounting = false;

function h(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}
function number(value) { return new Intl.NumberFormat("pt-BR").format(Number(value || 0)); }
function campaignId() { return document.querySelector("#campaign-select")?.value || ""; }
function operationName() { return document.querySelector("#campaign-select")?.selectedOptions?.[0]?.textContent?.trim() || "Operacao postal"; }
function pick(row, ...keys) { for (const key of keys) if (row?.[key] != null && row[key] !== "") return row[key]; return ""; }
function batchId(batch) { return String(pick(batch, "id", "ID")); }
function batchMode(batch) { return String(pick(batch, "documentMode", "DOCUMENT_MODE")); }
function batchTotal(batch) { return Number(pick(batch, "total", "TOTAL") || 0); }
function batchPortalReturnId(batch) { return String(pick(batch, "portalReturnId", "PORTAL_RETURN_ID")); }

async function allPostalObjects(cid, portalReturnId) {
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const chunk = await dataAction("postalObjects.list", { campaignId: cid, portalReturnId, limit: pageSize, offset });
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
    if (rows.length > 100000) throw new Error("Lote acima do limite de seguranca para gerar o protocolo.");
  }
  return rows;
}

function setStatus(card, message, type = "") {
  const slot = card.querySelector("[data-volume-status]");
  slot.className = `volume-status ${type}`;
  slot.textContent = message;
}

async function loadBatchState(batch) {
  const cid = campaignId();
  const id = batchId(batch);
  const [volumes, operations] = await Promise.all([
    dataAction("volumes.list", { campaignId: cid, productionBatchId: id }),
    dataAction("operations.list", { campaignId: cid }),
  ]);
  const validation = validateVolumePlan(volumes);
  const printState = printStateFromOperations(operations, id, validation.volumes);
  return { volumes: validation.volumes, validation, operations, printState };
}

function handoffReady(volumes) {
  return volumes.length > 0 && volumes.every((volume) => ["HANDED_OFF", "DELIVERED", "RECEIVED"].includes(volume.status));
}

function volumeRows(volumes) {
  return volumes.map((volume) => `<tr><td>${volume.number}/${volume.totalVolumes}</td><td><strong>${h(volume.service)}</strong></td><td>${number(volume.quantity)}</td><td>${h(volume.status || "PLANNED")}</td><td>${h(volume.receivedBy || "-")}</td></tr>`).join("");
}

function renderState(card, state) {
  const summary = volumeSummary(state.volumes);
  card.querySelector("[data-volume-summary]").innerHTML = `
    <span><strong>${number(summary.totalVolumes)}</strong><small>volumes</small></span>
    <span><strong>${number(summary.totalLabels)}</strong><small>etiquetas</small></span>
    <span><strong>${number(summary.SEDEX.labels)}</strong><small>SEDEX</small></span>
    <span><strong>${number(summary.PAC.labels)}</strong><small>PAC</small></span>`;
  card.querySelector("[data-volume-table]").innerHTML = volumeRows(state.volumes);
  const printed = state.printState.ready;
  const handed = handoffReady(state.volumes);
  card.querySelector("[data-print-confirm]").checked = printed;
  card.querySelector("[data-print-confirm]").disabled = printed;
  card.querySelector("[data-register-print]").disabled = printed || !state.validation.ready;
  card.querySelector("[data-register-handoff]").disabled = handed || !printed || !state.validation.ready;
  card.querySelector("[data-generate-volume-labels]").disabled = !state.validation.ready;
  card.querySelector("[data-generate-protocol]").disabled = !state.validation.ready;
  card.querySelector("[data-volume-badge]").textContent = handed ? "ENTREGUE A OPERACAO" : printed ? "IMPRESSO" : "PLANEJADO";
  card.querySelector("[data-volume-badge]").className = `volume-badge ${handed ? "ok" : printed ? "print" : ""}`;
  if (!state.validation.ready) setStatus(card, `Plano de volumes bloqueado: ${state.validation.problems.slice(0, 5).join(", ")}`, "bad");
  else if (handed) setStatus(card, `${number(summary.totalLabels)} etiquetas em ${number(summary.totalVolumes)} volumes ja foram entregues a operacao.`, "ok");
  else if (printed) setStatus(card, "Impressao fisica registrada. O protocolo de postagem usa as listas postais reais; a entrega dos volumes continua sendo um controle interno separado.", "ok");
  else setStatus(card, "Gerar o PDF nao registra impressao. Confirme a impressao fisica somente depois que ela realmente ocorrer.");
}

function cardTemplate(batch) {
  const id = batchId(batch);
  return `<article class="volume-card" data-volume-batch="${h(id)}" data-document-mode="${h(batchMode(batch))}">
    <div class="volume-card-head"><div><h3>Lote ${h(id.slice(0, 8))}</h3><p>${number(batchTotal(batch))} objetos · volumes fisicos de no maximo 250 · PAC e SEDEX separados</p></div><span class="volume-badge" data-volume-badge>CARREGANDO</span></div>
    <div class="volume-summary" data-volume-summary></div>
    <div class="volume-table-wrap"><table><thead><tr><th>Volume</th><th>Servico</th><th>Etiquetas</th><th>Status</th><th>Recebido por</th></tr></thead><tbody data-volume-table></tbody></table></div>
    <div class="volume-actions">
      <button class="secondary" data-generate-volume-labels>Gerar etiquetas dos volumes</button>
      <button class="secondary" data-generate-protocol>Gerar protocolo de postagem</button>
    </div>
    <div class="volume-control-grid">
      <label class="volume-confirm"><input type="checkbox" data-print-confirm> Confirmo que todas as etiquetas deste lote foram fisicamente impressas.</label>
      <button class="primary" data-register-print>Registrar impressao</button>
      <label>Recebido por<input data-received-by placeholder="Nome de quem recebeu os volumes"></label>
      <label>Observacao<input data-handoff-note placeholder="Opcional"></label>
      <label class="volume-confirm wide"><input type="checkbox" data-handoff-confirm> Confirmo que os volumes acima foram efetivamente entregues a operacao.</label>
      <button class="success wide" data-register-handoff>Registrar entrega a operacao</button>
    </div>
    <div class="volume-status" data-volume-status>Carregando volumes...</div>
  </article>`;
}

async function bindCard(card, batch) {
  let state = await loadBatchState(batch);
  renderState(card, state);

  card.querySelector("[data-generate-volume-labels]").addEventListener("click", async () => {
    try {
      const models = buildVolumeLabelModels({
        productionBatchId: batchId(batch),
        volumes: state.volumes,
        operationName: operationName(),
        documentMode: batchMode(batch),
      });
      const pdf = await generateVolumeLabelsPdf(models);
      downloadBlob(pdf, `etiquetas_volumes_${batchId(batch).slice(0, 8)}_${models.length}.pdf`);
      setStatus(card, `Geradas ${number(models.length)} etiquetas 10x15 de volume. Cada uma informa apenas o conteudo real daquele volume.`, "ok");
    } catch (error) { setStatus(card, error.message || String(error), "bad"); }
  });

  card.querySelector("[data-generate-protocol]").addEventListener("click", async () => {
    try {
      const cid = campaignId();
      setStatus(card, "Carregando dados consolidados das listas postais...");
      const protocol = await dataAction("production.protocol.data", { campaignId: cid, productionBatchId: batchId(batch) });
      const objects = (protocol.rows || []).map((row) => ({
        trackingCode: row.trackingCode,
        service: row.service,
        postal: {
          LISTA: row.listNumber,
          CODIGO_SERVICO: row.serviceCode,
          DATA_POSTAGEM: row.postingDate,
          HORA_POSTAGEM: row.postingTime,
        },
        recipient: { name: row.recipient, address: { zip: row.zip } },
      }));
      const model = buildPostingProtocolModel(objects, { senderName: protocol.senderName, cnpj: protocol.cnpj });
      if (!model.valid) throw new Error(`Protocolo bloqueado: ${model.errors.slice(0, 8).join(", ")}`);
      const pdf = await generatePostingProtocolPdf(model);
      downloadBlob(pdf, `protocolo_postagem_a_vista_${batchId(batch).slice(0, 8)}.pdf`);
      setStatus(card, `Protocolo gerado no modelo operacional de postagem a vista, com ${number(model.total)} objetos agrupados em ${number(model.lists.length)} lista(s) postais.`, "ok");
    } catch (error) { setStatus(card, error.message || String(error), "bad"); }
  });

  card.querySelector("[data-register-print]").addEventListener("click", async () => {
    if (!card.querySelector("[data-print-confirm]").checked) return setStatus(card, "Marque a confirmacao somente depois da impressao fisica do lote.", "warn");
    try {
      card.querySelector("[data-register-print]").disabled = true;
      const confirmations = buildPrintEvents({ campaignId: campaignId(), productionBatchId: batchId(batch), volumes: state.volumes });
      for (const item of confirmations) {
        await dataAction("production.print.confirm", {
          campaignId: campaignId(),
          productionBatchId: batchId(batch),
          service: item.service,
          quantity: item.quantity,
        });
      }
      state = await loadBatchState(batch);
      renderState(card, state);
    } catch (error) {
      setStatus(card, error.message || String(error), "bad");
      card.querySelector("[data-register-print]").disabled = false;
    }
  });

  card.querySelector("[data-register-handoff]").addEventListener("click", async () => {
    if (!state.printState.ready) return setStatus(card, "Registre primeiro a impressao fisica do lote.", "warn");
    if (!card.querySelector("[data-handoff-confirm]").checked) return setStatus(card, "Confirme a entrega somente quando os volumes tiverem sido efetivamente recebidos.", "warn");
    const receiver = card.querySelector("[data-received-by]").value.trim();
    if (receiver.length < 2) return setStatus(card, "Informe quem recebeu os volumes.", "warn");
    try {
      card.querySelector("[data-register-handoff]").disabled = true;
      await dataAction("production.handoff.confirm", {
        campaignId: campaignId(),
        productionBatchId: batchId(batch),
        receiver,
        note: card.querySelector("[data-handoff-note]").value.trim(),
      });
      state = await loadBatchState(batch);
      renderState(card, state);
    } catch (error) {
      setStatus(card, error.message || String(error), "bad");
      card.querySelector("[data-register-handoff]").disabled = false;
    }
  });
}

async function renderVolumeFlow(slot) {
  const cid = campaignId();
  if (!cid) return;
  const batches = await dataAction("production.list", { campaignId: cid });
  slot.innerHTML = `<section class="volume-workflow"><div class="volume-workflow-head"><div><p class="eyebrow">EXPEDICAO FISICA</p><h2>Volumes, impressao e entrega</h2><p>Impressao e entrega sao etapas diferentes. O sistema nao considera um PDF gerado como material impresso nem um lote impresso como entregue.</p></div><span>MAX. 250 / VOLUME</span></div><div class="volume-workflow-body">${batches.map(cardTemplate).join("") || '<div class="empty">Nenhum lote de producao.</div>'}</div></section>`;
  for (const [index, card] of [...slot.querySelectorAll("[data-volume-batch]")].entries()) await bindCard(card, batches[index]);
}

async function mount() {
  if (mounting) return;
  const root = document.querySelector(ROOT_SELECTOR);
  if (!root) return;
  const heading = [...root.querySelectorAll("h1")].find((node) => node.textContent?.trim() === "Lotes documentais e volumes");
  if (!heading) return;
  const page = heading.closest(".page");
  if (!page || page.querySelector("#volume-workflow-slot")) return;
  mounting = true;
  try {
    const slot = document.createElement("div");
    slot.id = "volume-workflow-slot";
    page.appendChild(slot);
    await renderVolumeFlow(slot);
  } finally { mounting = false; }
}

const observer = new MutationObserver(() => queueMicrotask(mount));
observer.observe(document.documentElement, { childList: true, subtree: true });
mount();
