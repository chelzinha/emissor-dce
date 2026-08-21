import "./agency-dce-preparation.css";
import { downloadBlob } from "./api.js";
import {
  downloadFiscalEnrichmentTemplate,
  loadAllDcePreparationObjects,
  loadDcePreparationContext,
  prepareDceAuthorizationPackage,
} from "./agency-dce-preparation-ui.js";
import { parseFiscalEnrichmentCsv, preflightDcePreparation } from "./agency-dce-preparation.js";

function h(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" }[char]));
}
function fmt(value) { return new Intl.NumberFormat("pt-BR").format(Number(value || 0)); }

const BLOCKER_LABELS = Object.freeze({
  RECIPIENT_DOCUMENT_REQUIRED:"CPF/CNPJ do destinatário",
  RECIPIENT_CPF_INVALID:"CPF inválido",
  RECIPIENT_CNPJ_INVALID:"CNPJ inválido",
  RECIPIENT_CITY_CODE_REQUIRED:"Código IBGE do destinatário",
  ITEM_QUANTITY_REQUIRED:"Quantidade do conteúdo",
  ITEM_UNIT_VALUE_REQUIRED:"Valor unitário",
  ITEM_DESCRIPTION_REQUIRED:"Descrição do conteúdo",
  MATRIX_NOT_VERIFIED:"Data Matrix não verificado",
  ISSUER_NON_ICMS_NOT_CONFIRMED:"Declaração fiscal do cliente",
  ISSUER_NO_INVOICE_NOT_CONFIRMED:"Declaração fiscal do cliente",
  ISSUER_PROFILE_NOT_ACTIVE:"Perfil fiscal do cliente",
});

function blockerLabel(code) { return BLOCKER_LABELS[code] || String(code || "Pendência").replaceAll("_", " "); }

function preflightSummary(preflight) {
  const blockers = Object.entries(preflight.blockerCounts || {}).sort((a,b)=>b[1]-a[1]);
  return `<div class="dce-preflight-summary">
    <div><span>Total</span><strong>${fmt(preflight.total)}</strong></div>
    <div><span>Prontos</span><strong>${fmt(preflight.readyCount)}</strong></div>
    <div><span>Bloqueados</span><strong>${fmt(preflight.blockedCount)}</strong></div>
  </div>
  ${blockers.length ? `<div class="dce-blockers">${blockers.slice(0,10).map(([code,count])=>`<div><span>${h(blockerLabel(code))}</span><strong>${fmt(count)}</strong></div>`).join("")}</div>` : '<div class="dce-ready-banner">Todos os objetos passaram pelo pré-flight fiscal.</div>'}`;
}

export async function openAgencyDcePreparation({ campaignId, productionBatchId, toast, busy, onDone }) {
  document.querySelector("#agency-dce-modal")?.remove();
  const stop = busy?.("Carregando preparo fiscal…") || (()=>{});
  let context, objects;
  try {
    context = await loadDcePreparationContext(campaignId, productionBatchId);
    objects = await loadAllDcePreparationObjects(campaignId, productionBatchId, ({loaded,total})=>{
      const label=document.querySelector(".busy-card strong"); if(label) label.textContent=`Carregando objetos ${loaded} de ${total}…`;
    });
  } catch(error) { stop(); toast?.(error.message,"error"); return; }
  stop();

  const modal=document.createElement("div"); modal.id="agency-dce-modal"; modal.className="modal-backdrop";
  const issuer=context.issuerProfile || {};
  modal.innerHTML=`<section class="agency-dce-modal" role="dialog" aria-modal="true">
    <header><div><p class="eyebrow">PREPARAÇÃO FISCAL</p><h2>Preparar pacote de DC-e</h2><p>Lote ${h(String(productionBatchId).slice(0,8))} · ${fmt(context.objectCount)} objetos. Nenhum documento será enviado ao cliente enquanto houver pendências.</p></div><button id="close-agency-dce" class="ghost">Fechar</button></header>
    <div class="dce-profile-strip ${issuer.status === "ACTIVE" ? "ok" : "warn"}"><div><strong>Perfil fiscal do emitente</strong><span>${issuer.status === "ACTIVE" ? `${h(issuer.name || "")} · série ${fmt(issuer.series)}` : "Aguardando confirmação do cliente no Perfil fiscal."}</span></div><span class="status ${issuer.status === "ACTIVE" ? "ok" : "warn"}">${h(issuer.status || "NÃO CADASTRADO")}</span></div>
    <div class="grid two dce-prep-grid">
      <section class="card"><div class="section-title"><div><h3>Padrões do conteúdo</h3><p>Use apenas quando esses dados forem iguais para todo o lote. Campos vazios não são inferidos.</p></div></div>
        <div class="form-grid"><label class="field"><span>Quantidade por objeto</span><input id="dce-default-qty" type="number" min="0.0001" step="any"></label><label class="field"><span>Valor unitário (R$)</span><input id="dce-default-value" type="number" min="0.01" step="0.01"></label><label class="field"><span>NCM opcional</span><input id="dce-default-ncm"></label><label class="field"><span>Ambiente</span><select id="dce-environment"><option value="2" selected>Homologação</option><option value="1">Produção</option></select></label></div>
      </section>
      <section class="card"><div class="section-title"><div><h3>Complemento fiscal por SRO</h3><p>Para CPF/CNPJ, código IBGE, quantidade ou valor que não estejam no cadastro.</p></div></div>
        <input id="dce-enrichment-file" type="file" accept=".csv,text/csv"><div class="actions" style="margin-top:12px"><button id="dce-template" class="ghost">Baixar modelo CSV</button><button id="dce-preflight" class="secondary">Verificar lote</button></div>
      </section>
    </div>
    <section class="card" style="margin-top:16px"><div class="section-title"><div><h3>Pré-flight</h3><p>CPF/CNPJ, endereço fiscal, IBGE, conteúdo, quantidade, valor, serviço e Data Matrix são validados antes da numeração.</p></div></div><div id="dce-preflight-result"><div class="empty">Clique em Verificar lote.</div></div></section>
    <footer class="agency-dce-actions"><span id="dce-package-range">A numeração só é reservada após o lote passar integralmente.</span><button id="dce-submit" class="primary" disabled>Preparar para autorização do cliente</button></footer>
  </section>`;
  document.body.appendChild(modal);
  modal.querySelector("#close-agency-dce").addEventListener("click",()=>modal.remove());
  modal.addEventListener("click",(event)=>{ if(event.target===modal) modal.remove(); });
  modal.querySelector("#dce-template").addEventListener("click",()=>downloadBlob(downloadFiscalEnrichmentTemplate(),"complemento_fiscal_dce.csv"));

  let currentPreflight=null;
  let enrichmentCsvText="";
  async function runPreflight() {
    const qtyText=modal.querySelector("#dce-default-qty").value;
    const valueText=modal.querySelector("#dce-default-value").value;
    const ncm=modal.querySelector("#dce-default-ncm").value;
    const file=modal.querySelector("#dce-enrichment-file").files[0];
    enrichmentCsvText=file ? await file.text() : "";
    let enrichments=[];
    if(enrichmentCsvText){ const parsed=parseFiscalEnrichmentCsv(enrichmentCsvText); if(parsed.errors.length) throw new Error(parsed.errors.join(" ")); enrichments=parsed.rows; }
    const defaults={};
    if(qtyText) defaults.quantity=Number(qtyText);
    if(valueText) defaults.unitValue=Number(valueText);
    if(ncm) defaults.ncm=ncm;
    currentPreflight=preflightDcePreparation({objects,issuerProfile:issuer,defaults,enrichments});
    modal.querySelector("#dce-preflight-result").innerHTML=preflightSummary(currentPreflight);
    modal.querySelector("#dce-submit").disabled=!currentPreflight.ready;
    modal.dataset.defaults=JSON.stringify(defaults);
    return currentPreflight;
  }

  modal.querySelector("#dce-preflight").addEventListener("click",async()=>{
    try { await runPreflight(); if(currentPreflight.ready) toast?.("Lote fiscal pronto para preparação.","success"); }
    catch(error){ toast?.(error.message,"error"); }
  });

  modal.querySelector("#dce-submit").addEventListener("click",async()=>{
    const stopSubmit=busy?.("Preparando pacote de DC-e…") || (()=>{});
    try {
      await runPreflight();
      if(!currentPreflight.ready) throw new Error("O lote ainda possui pendências fiscais.");
      const result=await prepareDceAuthorizationPackage({
        campaignId,productionBatchId,objects,issuerProfile:issuer,
        defaults:JSON.parse(modal.dataset.defaults || "{}"),enrichmentCsvText,environment:modal.querySelector("#dce-environment").value,
        onProgress:(progress)=>{ const label=document.querySelector(".busy-card strong"); if(label) label.textContent=progress.message || "Preparando pacote…"; }
      });
      const pkg=result.package;
      toast?.(`${fmt(pkg.total)} DC-e preparadas para autorização do cliente.`,"success");
      modal.remove(); await onDone?.(pkg);
    } catch(error){ toast?.(error.message,"error"); }
    finally{ stopSubmit(); }
  });
}
