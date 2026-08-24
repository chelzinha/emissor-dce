const ROOT = document.querySelector('#elections-app');

function setText(node, value) {
  if (node && node.textContent !== value) node.textContent = value;
}

function applySimplifiedRelease() {
  if (!ROOT) return;

  ROOT.querySelectorAll('[data-mode="DCE_AUTHORIZED"]').forEach((button) => button.remove());
  ROOT.querySelectorAll('.card').forEach((card) => {
    const heading = card.querySelector('h2')?.textContent?.trim() || '';
    if (heading === 'DC-e com e-CNPJ') card.remove();
  });
  ROOT.querySelectorAll('.report-dce').forEach((card) => card.remove());

  const accessSubtitle = ROOT.querySelector('#client-access-card .section-title p');
  if (accessSubtitle && /Autorizar DC-e/i.test(accessSubtitle.textContent || '')) {
    setText(accessSubtitle, 'Crie ou vincule o usuário que acessará o Dashboard e o Simulador do Portal do Cliente.');
  }

  ROOT.querySelectorAll('.return-footnote').forEach((note) => {
    if (/DC-e/i.test(note.textContent || '')) {
      note.innerHTML = 'O registro pode ser salvo com pendências para auditoria, mas somente um retorno <strong>READY</strong> será liberado para Declaração Simplificada.';
    }
  });

  const returnHeading = [...ROOT.querySelectorAll('h1')].find((node) => node.textContent?.trim() === 'PDF + CSV das postagens');
  const page = returnHeading?.closest('.page');
  if (page && !page.querySelector('[data-simplified-release-note]')) {
    const note = document.createElement('div');
    note.className = 'notice';
    note.dataset.simplifiedReleaseNote = 'true';
    note.style.marginBottom = '16px';
    note.innerHTML = '<strong>Versão operacional atual:</strong> Declaração Simplificada. A DC-e permanece fora deste fluxo até a liberação específica da etapa fiscal.';
    const firstCard = page.querySelector(':scope > .card');
    if (firstCard) page.insertBefore(note, firstCard); else page.appendChild(note);
  }
}

const observer = new MutationObserver(() => queueMicrotask(applySimplifiedRelease));
if (ROOT) observer.observe(ROOT, { childList: true, subtree: true });
applySimplifiedRelease();
