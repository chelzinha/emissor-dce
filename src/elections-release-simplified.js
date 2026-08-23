const ROOT = document.querySelector('#elections-app');

function applySimplifiedRelease() {
  if (!ROOT) return;
  ROOT.querySelectorAll('[data-mode="DCE_AUTHORIZED"]').forEach((button) => button.remove());
  ROOT.querySelectorAll('.card').forEach((card) => {
    const heading = card.querySelector('h2')?.textContent?.trim() || '';
    if (heading === 'DC-e com e-CNPJ') card.remove();
  });
  const returnHeading = [...ROOT.querySelectorAll('h1')].find((node) => node.textContent?.trim() === 'PDF + CSV das postagens');
  const page = returnHeading?.closest('.page');
  if (page && !page.querySelector('[data-simplified-release-note]')) {
    const note = document.createElement('div');
    note.className = 'notice';
    note.dataset.simplifiedReleaseNote = 'true';
    note.style.marginBottom = '16px';
    note.innerHTML = '<strong>Versão atual:</strong> Declaração Simplificada. A autorização DC-e será liberada após a validação desta etapa operacional.';
    const firstCard = page.querySelector(':scope > .card');
    if (firstCard) page.insertBefore(note, firstCard); else page.appendChild(note);
  }
}

const observer = new MutationObserver(() => queueMicrotask(applySimplifiedRelease));
if (ROOT) observer.observe(ROOT, { childList: true, subtree: true });
applySimplifiedRelease();
