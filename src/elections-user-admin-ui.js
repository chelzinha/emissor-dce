import './elections-user-admin-ui.css';

const ROOT = document.querySelector('#elections-app');

function h(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function notify(message, type = 'info') {
  const box = document.querySelector('#elections-toast');
  if (!box) return;
  box.textContent = message;
  box.className = `elections-toast show ${type}`;
  clearTimeout(box._clientAccessTimer);
  box._clientAccessTimer = setTimeout(() => { box.className = 'elections-toast'; }, 4800);
}

function campaignId() {
  return document.querySelector('#campaign-select')?.value || '';
}

function template() {
  return `<section class="card client-access-card" id="client-access-card">
    <div class="section-title"><div><h2>Acesso do cliente</h2><p>Crie ou vincule o usuário que acessará Dashboard, Simulador e Autorizar DC-e.</p></div></div>
    <form id="client-access-form" class="client-access-grid">
      <label class="field"><span>Usuário</span><input name="username" autocomplete="off" placeholder="ex.: candidato01" required></label>
      <label class="field"><span>E-mail de recuperação</span><input name="email" type="email" autocomplete="off" placeholder="contato@exemplo.com" required></label>
      <label class="field"><span>Nome</span><input name="fullName" autocomplete="off" placeholder="Nome do usuário"></label>
      <label class="field"><span>Senha inicial</span><input name="password" type="password" autocomplete="new-password" minlength="8" required></label>
      <div class="wide"><button class="primary" type="submit">Criar / vincular acesso</button></div>
    </form>
    <p class="client-access-note">O candidato entra no Portal usando apenas <strong>Usuário + Senha</strong>. O e-mail fica no Identity para identificação e recuperação do acesso.</p>
    <div class="client-access-result" hidden></div>
  </section>`;
}

async function submitAccess(form, result) {
  const cid = campaignId();
  if (!cid) return notify('Selecione uma operação antes de criar o acesso.', 'error');
  const button = form.querySelector('button[type="submit"]');
  const values = Object.fromEntries(new FormData(form));
  button.disabled = true;
  button.textContent = 'Criando acesso…';
  result.hidden = true;
  try {
    const response = await fetch('/api/portal/users', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaignId: cid, ...values }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.error || 'Não foi possível criar o acesso.');
    const data = payload.data || {};
    result.innerHTML = `${data.created ? 'Acesso criado' : 'Acesso vinculado'}: <strong>${h(data.username)}</strong>`;
    result.hidden = false;
    form.reset();
    notify(data.created ? 'Acesso do cliente criado e vinculado à operação.' : 'Usuário existente vinculado à operação.', 'success');
  } catch (error) {
    notify(error.message || 'Não foi possível criar o acesso.', 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Criar / vincular acesso';
  }
}

function mount() {
  const page = ROOT?.querySelector('.page');
  if (!page || page.querySelector('#client-access-card')) return;
  if (!page.querySelector('#new-campaign') && !page.querySelector('[data-open-campaign]')) return;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = template();
  const card = wrapper.firstElementChild;
  page.appendChild(card);
  const form = card.querySelector('#client-access-form');
  const result = card.querySelector('.client-access-result');
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submitAccess(form, result);
  });
}

const observer = new MutationObserver(() => queueMicrotask(mount));
if (ROOT) observer.observe(ROOT, { childList: true, subtree: true });
mount();
