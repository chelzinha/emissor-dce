const ROOT = document.querySelector('#elections-app');

const LABELS = Object.freeze({
  READY: 'Pronto',
  ACTIVE: 'Ativa',
  FINISHED: 'Finalizado',
  EXPORTED: 'Exportado',
  IN_PRODUCTION: 'Em produção',
  READY_FOR_UNIFIED_LABEL: 'Pronto para produção',
  REVIEW: 'Revisar',
  UPLOADING: 'Importando',
  CLEANING: 'Higienizando',
  AWAITING_DCE_PREPARATION: 'Aguardando preparação da DC-e',
  ERROR: 'Erro',
  REJECTED: 'Rejeitado',
  BLOCKED: 'Bloqueado',
  PLANNED: 'Planejado',
  DELIVERED: 'Entregue',
  PREPARED: 'Preparado',
  PROCESSING: 'Processando',
  PARTIAL: 'Parcial',
  AUTHORIZED: 'Autorizado',
  AUTO_VERIFIED: 'Autoverificado',
  VERIFIED: 'Verificado',
  TEXT_ONLY: 'Identificado pelo texto',
  MANUAL_REVIEW: 'Revisão manual',
  MISSING: 'Ausente',
  DIVERGENT: 'Divergente',
  RECEIVED: 'Recebida',
  DCE_PREPARED: 'DC-e preparada',
  DCE_RESERVED: 'DC-e em autorização',
  DCE_PARTIAL: 'DC-e parcial',
  ADDRESS_LIST_RECEIVED: 'Base recebida',
  ADDRESS_CLEANING_COMPLETED: 'Higienização de endereços concluída',
  PORTAL_CSV_EXPORTED: 'Arquivo exportado para o Portal Postal',
  PORTAL_RETURN_IMPORTED: 'Retorno do Portal importado',
  LABEL_GENERATED: 'Etiquetas geradas',
  MATRIX_100_VERIFIED: 'Data Matrix 100% verificado',
  LABEL_TEST_APPROVED: 'Etiqueta teste aprovada',
  LABEL_PRINTED: 'Etiquetas impressas',
  LABEL_HANDOFF: 'Entrega à operação registrada',
  DCE_AUTHORIZED: 'DC-e autorizada',
  POSTING_COMPLETED: 'Postagem concluída',
  TRACKING_DELIVERED: 'Entrega pelos Correios registrada',
  TRACKING_UPDATE_IMPORTED: 'Atualização de rastreamento importada',
  INTERNAL_DELIVERY_PLANNED: 'Entrega interna planejada',
  OPERATION_CLOSED: 'Operação encerrada',
  OPERATION_REOPENED: 'Operação reaberta',
});

const WORDS = Object.freeze({
  ADDRESS: 'endereço', LIST: 'base', RECEIVED: 'recebida', CLEANING: 'higienização', COMPLETED: 'concluída',
  PORTAL: 'Portal', CSV: 'CSV', EXPORTED: 'exportado', RETURN: 'retorno', IMPORTED: 'importado', LABEL: 'etiqueta',
  GENERATED: 'gerada', PRINTED: 'impressa', HANDOFF: 'entrega à operação', TEST: 'teste', APPROVED: 'aprovada',
  MATRIX: 'Data Matrix', VERIFIED: 'verificado', DCE: 'DC-e', PREPARED: 'preparada', AUTHORIZED: 'autorizada',
  POSTING: 'postagem', TRACKING: 'rastreamento', DELIVERED: 'entregue', UPDATE: 'atualização', OPERATION: 'operação',
  CLOSED: 'encerrada', REOPENED: 'reaberta', INTERNAL: 'interna', DELIVERY: 'entrega', PLANNED: 'planejada',
  READY: 'pronto', FOR: 'para', UNIFIED: 'unificada', PRODUCTION: 'produção', AWAITING: 'aguardando',
  RESERVATION: 'reserva', RESERVED: 'reservada', PARTIAL: 'parcial', ERROR: 'erro', REJECTED: 'rejeitado',
});

function translate(code) {
  const normalized = String(code || '').trim().toUpperCase();
  if (!normalized) return '';
  if (LABELS[normalized]) return LABELS[normalized];
  if (!/^[A-Z0-9]+(?:_[A-Z0-9]+)+$/.test(normalized)) return '';
  const translated = normalized.split('_').map((word) => WORDS[word] || word).join(' ');
  return translated.charAt(0).toUpperCase() + translated.slice(1);
}

function localizeElement(element) {
  if (!element || element.children.length) return;
  const original = String(element.textContent || '').trim();
  const translated = translate(original);
  if (!translated || translated === original) return;
  element.dataset.systemCode ||= original.toUpperCase();
  element.title ||= `Código interno: ${element.dataset.systemCode}`;
  element.textContent = translated;
}

function localize() {
  if (!ROOT) return;
  ROOT.querySelectorAll('.status,.pill,.timeline-item strong,.timeline strong,.timeline b,.tracking-event span,td strong,td span,.production-gate strong').forEach(localizeElement);
}

let scheduled = false;
const observer = new MutationObserver(() => {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    localize();
  });
});
if (ROOT) observer.observe(ROOT, { childList: true, subtree: true });
localize();
