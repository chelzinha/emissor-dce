// Tela "Etiquetas": gera as etiquetas 10 x 15 da MDPB com DACE resumida,
// a lista de postagem por âmbito e o CSV de conferência, direto das DC-e autorizadas.
// Não usa o Portal Postal. Somente leitura no backend (batches.list, dce.list, batch.get).

import "./mdpb-labels.css";

const STORAGE_PREFIX = "dce-facil:chancela:";
const CONFIG_FIELDS = [
  ["contract", "Nº do contrato", "9912398647"],
  ["contractYear", "Ano do contrato", "2016"],
  ["dr", "DR do contrato", "CE"],
  ["sigla", "Sigla do cliente na chancela", "AABNB"],
  ["postingCard", "Cartão de postagem (lista)", "72340509"],
  ["weightGrams", "Peso unitário (g)", "100"],
  ["senderName", "Nome do remetente na etiqueta", ""],
];

let labelModule = null;
async function lib() {
  if (!labelModule) labelModule = await import("./mdpb-label.js");
  return labelModule;
}

let logoBytes = null;
async function logo() {
  if (!logoBytes) {
    const response = await fetch("/correios-traco-positiva.png");
    if (!response.ok || !String(response.headers.get("content-type") || "").startsWith("image/")) throw new Error("Marca dos Correios não encontrada (/correios-traco-positiva.png).");
    logoBytes = new Uint8Array(await response.arrayBuffer());
  }
  return logoBytes;
}

function readStored(cnpj) {
  try { return JSON.parse(localStorage.getItem(STORAGE_PREFIX + cnpj) || "null"); } catch { return null; }
}
function writeStored(cnpj, config) {
  try { localStorage.setItem(STORAGE_PREFIX + cnpj, JSON.stringify(config)); } catch { /* armazenamento indisponível: segue com a configuração da tela */ }
}

export function createLabelsView({ shell, h, toast, setBusy, dataAction, downloadBlob, getState }) {
  const view = { batches: [], dceRows: [], selected: new Set(), result: null, config: null, loadedAt: null, cut: {} };
  const app = () => document.querySelector("#app");

  function issuer() {
    return getState().company?.profile || {};
  }

  async function ensureConfig() {
    if (view.config) return view.config;
    const { defaultChancelaConfig, digitsOnly } = await lib();
    const profile = issuer();
    view.config = { ...defaultChancelaConfig(profile), ...(readStored(digitsOnly(profile.cnpj)) || {}) };
    return view.config;
  }

  function authorizedCount(batchId) {
    return view.dceRows.filter((row) => String(row.BATCH_ID) === String(batchId) && String(row.STATUS) === "AUTHORIZED").length;
  }

  function batchesTemplate() {
    const rows = view.batches.map((batch) => {
      const count = authorizedCount(batch.ID);
      const production = String(batch.ENVIRONMENT) === "1";
      return `<label class="lb-batch ${view.selected.has(String(batch.ID)) ? "is-on" : ""}"><input type="checkbox" data-batch="${h(batch.ID)}" ${view.selected.has(String(batch.ID)) ? "checked" : ""}><span><b>${h(String(batch.CREATED_AT || "").slice(0, 16).replace("T", " "))}</b><small>${h(batch.ID)}</small></span><span class="status-chip ${production ? "ok" : ""}">${production ? "Produção" : "Homologação"}</span><strong>${count.toLocaleString("pt-BR")} autorizadas</strong></label>`;
    }).join("");
    return rows || '<div class="empty small"><b>Nenhum lote com DC-e autorizada</b><span>Autorize as DC-e primeiro (Emitir ou /autorizar).</span></div>';
  }

  function configTemplate(config) {
    return CONFIG_FIELDS.map(([name, label, placeholder]) => `<label class="field ${name === "senderName" ? "wide" : ""}"><span>${h(label)}</span><input name="${name}" value="${h(config[name] ?? "")}" placeholder="${h(placeholder)}" ${name === "postingCard" ? "" : "required"}></label>`).join("");
  }

  function resultTemplate() {
    const result = view.result;
    if (!result) return "";
    const skipped = result.skipped;
    const notes = [
      skipped.notMdpb ? `${skipped.notMdpb} DC-e de PAC/SEDEX ignoradas` : "",
      skipped.notAuthorized ? `${skipped.notAuthorized} documentos não autorizados ignorados` : "",
      skipped.duplicated ? `${skipped.duplicated} duplicadas removidas` : "",
      skipped.invalidZip ? `${skipped.invalidZip} com CEP inválido fora das etiquetas` : "",
    ].filter(Boolean);
    const homolog = result.entries.some((entry) => entry.environment !== "1");
    const groups = result.groups.map((group) => `<div class="lb-group"><div class="lb-group-head"><div><p class="eyebrow">ÂMBITO</p><h3>${h(group.ambito)}</h3></div><strong>${group.entries.length.toLocaleString("pt-BR")} objetos</strong></div><div class="lb-actions">${group.parts.map((part) => `<button class="primary" data-labels="${h(group.ambito)}" data-part="${part.index}">Etiquetas${part.total > 1 ? ` parte ${part.index}/${part.total}` : ""}<small>${(part.start + 1).toLocaleString("pt-BR")} a ${(part.start + part.entries.length).toLocaleString("pt-BR")}</small></button>`).join("")}<button class="secondary" data-list="${h(group.ambito)}">Lista de postagem<small>${group.entries.length.toLocaleString("pt-BR")} linhas</small></button></div>${view.cut[group.ambito] ? `<p class="lb-warn">${view.cut[group.ambito]} linha(s) de texto foram encurtadas para caber. Confira no CSV de conferência.</p>` : ""}</div>`).join("");
    return `<section class="card lb-result"><div class="section-title"><div><h2>${result.entries.length.toLocaleString("pt-BR")} etiquetas prontas</h2><p>Ordem por âmbito e CEP crescente. A lista de postagem segue a mesma ordem.</p></div><button class="ghost" id="lb-csv">CSV de conferência</button></div>${homolog ? '<p class="lb-warn strong">Há DC-e de homologação: essas etiquetas saem com a marca "HOMOLOGAÇÃO - SEM VALOR FISCAL" e não servem para postagem.</p>' : ""}${notes.length ? `<p class="lb-note">${h(notes.join(" · "))}</p>` : ""}<div class="lb-groups">${groups}</div><div class="lb-print"><b>Impressão</b><span>Etiqueta térmica 100 x 150 mm, escala 100% (sem "ajustar à página"), preto, mínimo 300 dpi. Separe os objetos por âmbito e entregue cada lote com a sua lista de postagem.</span></div></section>`;
  }

  function render() {
    const config = view.config || {};
    shell(`<div class="page-head"><div><p class="eyebrow">POSTAGEM</p><h1>Etiquetas MDPB</h1><p>Etiqueta 10 x 15 com chancela e DACE resumida, gerada a partir das DC-e autorizadas. Sem Portal Postal.</p></div><span class="status-chip">${view.result ? `${view.result.entries.length} etiquetas` : "Selecione os lotes"}</span></div>
      <section class="card"><div class="section-title"><div><h2>1. Lotes autorizados</h2><p>Marque os lotes que entram nesta postagem.</p></div><div class="button-row"><button class="ghost" id="lb-all">Marcar produção</button><button class="ghost" id="lb-reload">Atualizar</button></div></div><div class="lb-batches">${batchesTemplate()}</div></section>
      <form class="card lb-config" id="lb-config"><div class="section-title"><div><h2>2. Dados da chancela</h2><p>Contrato aprovado pelos Correios. Fica salvo neste navegador para o CNPJ ${h(issuer().cnpj || "")}.</p></div></div><div class="form-grid">${configTemplate(config)}</div><div class="form-actions"><button class="primary" type="submit">Montar etiquetas</button></div></form>
      ${resultTemplate()}`);
    bind();
  }

  // Guarda o que foi digitado antes de redesenhar a tela.
  function captureForm() {
    const form = app().querySelector("#lb-config");
    if (!form) return;
    const data = new FormData(form);
    view.config = { ...(view.config || {}), ...Object.fromEntries(CONFIG_FIELDS.map(([name]) => [name, String(data.get(name) || "").trim()])) };
  }

  function bind() {
    const root = app();
    root.querySelectorAll("[data-batch]").forEach((input) => input.addEventListener("change", () => {
      const id = input.dataset.batch;
      if (input.checked) view.selected.add(id); else view.selected.delete(id);
      captureForm(); view.result = null; render();
    }));
    root.querySelector("#lb-all")?.addEventListener("click", () => { captureForm(); selectProduction(); view.result = null; render(); });
    root.querySelector("#lb-reload")?.addEventListener("click", () => { captureForm(); open(true); });
    root.querySelector("#lb-config")?.addEventListener("submit", (event) => { event.preventDefault(); build(new FormData(event.currentTarget)); });
    root.querySelectorAll("[data-labels]").forEach((button) => button.addEventListener("click", () => downloadLabels(button.dataset.labels, Number(button.dataset.part))));
    root.querySelectorAll("[data-list]").forEach((button) => button.addEventListener("click", () => downloadList(button.dataset.list)));
    root.querySelector("#lb-csv")?.addEventListener("click", downloadCsv);
  }

  function selectProduction() {
    view.selected = new Set(view.batches.filter((batch) => String(batch.ENVIRONMENT) === "1" && authorizedCount(batch.ID) > 0).map((batch) => String(batch.ID)));
  }

  async function open(reload = false) {
    await ensureConfig();
    if (reload || !view.loadedAt) {
      setBusy(true, "Lendo lotes autorizados…");
      try {
        const [batches, dceRows] = await Promise.all([dataAction("batches.list", {}), dataAction("dce.list", {})]);
        view.dceRows = Array.isArray(dceRows) ? dceRows : [];
        view.batches = (Array.isArray(batches) ? batches : []).filter((batch) => authorizedCount(batch.ID) > 0);
        view.loadedAt = Date.now();
        view.result = null;
        selectProduction();
      } catch (error) { toast(error?.message || String(error), "error"); }
      finally { setBusy(false); }
    }
    render();
  }

  async function build(form) {
    const m = await lib();
    const config = Object.fromEntries(CONFIG_FIELDS.map(([name]) => [name, String(form.get(name) || "").trim()]));
    config.dr = config.dr.toUpperCase().replace(/^DR\/?/, "");
    config.sigla = config.sigla.toUpperCase();
    const errors = m.validateChancelaConfig(config);
    if (errors.length) { toast(errors.join(" "), "error"); return; }
    view.config = config;
    writeStored(m.digitsOnly(issuer().cnpj), config);
    const batches = view.batches.filter((batch) => view.selected.has(String(batch.ID)));
    if (!batches.length) { toast("Marque pelo menos um lote.", "error"); return; }
    setBusy(true, "Buscando remessas…");
    try {
      const documentsByBatch = {};
      for (let index = 0; index < batches.length; index += 1) {
        setBusy(true, `Buscando remessas do lote ${index + 1} de ${batches.length}…`);
        const stored = await dataAction("batch.get", { batchId: batches[index].ID });
        documentsByBatch[batches[index].ID] = stored.documents || [];
      }
      const { entries, skipped } = m.buildLabelEntries({ batches, documentsByBatch, dceRows: view.dceRows });
      if (!entries.length) throw new Error("Nenhuma DC-e autorizada de Mala Direta nos lotes marcados.");
      const groups = m.groupByAmbito(entries).map((group) => ({ ...group, parts: m.splitParts(group.entries) }));
      view.result = { entries, skipped, groups };
      view.cut = {};
      toast(`${entries.length} etiquetas prontas para gerar.`, "success");
    } catch (error) { toast(error?.message || String(error), "error"); }
    finally { setBusy(false); }
    render();
  }

  function stamp() {
    const now = new Date();
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  }

  async function downloadLabels(ambito, partIndex) {
    const group = view.result?.groups.find((item) => item.ambito === ambito);
    const part = group?.parts.find((item) => item.index === partIndex);
    if (!part) return;
    setBusy(true, `Gerando ${part.entries.length} etiquetas ${ambito}…`);
    try {
      const m = await lib();
      await new Promise((resolve) => setTimeout(resolve, 30));
      const { bytes, report } = await m.createLabelsPdf(part.entries, view.config, await logo());
      if (report.cut) view.cut[ambito] = (view.cut[ambito] || 0) + report.cut;
      const suffix = part.total > 1 ? `_parte${part.index}de${part.total}` : "";
      downloadBlob(new Blob([bytes], { type: "application/pdf" }), `ETIQUETAS_MDPB_${view.config.sigla}_${ambito}${suffix}_${stamp()}.pdf`);
      toast(`Etiquetas ${ambito}${suffix ? ` parte ${part.index}` : ""} geradas.`, "success");
    } catch (error) { toast(error?.message || String(error), "error"); }
    finally { setBusy(false); render(); }
  }

  async function downloadList(ambito) {
    const group = view.result?.groups.find((item) => item.ambito === ambito);
    if (!group) return;
    setBusy(true, `Gerando lista de postagem ${ambito}…`);
    try {
      const m = await lib();
      const bytes = await m.createPostingListPdf(group.entries, view.config);
      downloadBlob(new Blob([bytes], { type: "application/pdf" }), `LISTA_POSTAGEM_MDPB_${view.config.sigla}_${ambito}_${stamp()}.pdf`);
    } catch (error) { toast(error?.message || String(error), "error"); }
    finally { setBusy(false); }
  }

  async function downloadCsv() {
    if (!view.result) return;
    const m = await lib();
    downloadBlob(new Blob([m.conferenceCsv(view.result.entries)], { type: "text/csv;charset=utf-8" }), `CONFERENCIA_ETIQUETAS_MDPB_${view.config.sigla}_${stamp()}.csv`);
  }

  return { open };
}
