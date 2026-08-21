import { buildHandoffRecord, derivePostProductionStatus, summarizePrintConfirmations } from "./post-production.js";

function h(value) {
  return String(value ?? "").replace(/[&<>'\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

export function postProductionCard(snapshot) {
  const objects = snapshot.objects || [];
  const approvals = snapshot.labelTestApprovals || [];
  const prints = snapshot.printConfirmations || [];
  const status = derivePostProductionStatus({ objects, approvals, printConfirmations: prints, handedOff: snapshot.handedOff });
  const summary = summarizePrintConfirmations(objects, prints);
  const serviceRows = summary.requiredServices.map((service) => {
    const row = summary.byService[service];
    return `<div class="post-prod-service"><strong>${h(service)}</strong><span>${row.confirmed}/${row.expected} impressas</span>${row.ready ? '<b class="ok">OK</b>' : '<b class="warn">Pendente</b>'}</div>`;
  }).join("");
  return `<section class="card post-production" data-production-batch="${h(snapshot.productionBatchId)}">
    <div class="section-title"><div><h2>Pos-producao</h2><p>Impressao, volumes e entrega fisica ficam separados da geracao do PDF.</p></div><span class="status">${h(status)}</span></div>
    <div class="post-prod-services">${serviceRows || '<div class="empty">Sem objetos.</div>'}</div>
    <div class="actions">
      <button class="secondary" data-post-prod-action="volume-pdf">Etiquetas dos volumes</button>
      <button class="secondary" data-post-prod-action="protocol-pdf">Protocolo de postagem</button>
      <button class="primary" data-post-prod-action="handoff" ${summary.ready ? "" : "disabled"}>Registrar entrega a operacao</button>
    </div>
  </section>`;
}

export function buildHandoffFromForm(snapshot, formData) {
  return buildHandoffRecord({
    productionBatchId: snapshot.productionBatchId,
    campaignId: snapshot.campaignId,
    objects: snapshot.objects || [],
    volumes: snapshot.volumes || [],
    approvals: snapshot.labelTestApprovals || [],
    printConfirmations: snapshot.printConfirmations || [],
    receiver: formData.receiver,
    occurredAt: formData.occurredAt || "",
  });
}
