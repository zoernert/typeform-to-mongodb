async function api(path){
  const res = await fetch(path);
  if(!res.ok) throw new Error(await res.text());
  return res.json();
}

const formsList = document.getElementById('formsList');
const respDiv = document.getElementById('responses');
const ansDiv = document.getElementById('answers');
const relDiv = document.getElementById('related');
const formTitleById = {};
const chiffresDiv = document.getElementById('chiffres');

async function loadForms(q=''){
  const data = await api('/api/forms'+(q?`?q=${encodeURIComponent(q)}`:''));
  formsList.innerHTML = '';
  data.items.forEach(f=>{
  if (f.form_id) formTitleById[f.form_id] = f.title || f.form_id;
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = '#';
    a.textContent = `${f.form_id} — ${f.title ?? ''}`;
    a.onclick = (e)=>{e.preventDefault(); loadResponses(f.form_id)};
    li.appendChild(a);
    formsList.appendChild(li);
  });
}

async function loadResponses(formId){
  const data = await api(`/api/forms/${encodeURIComponent(formId)}/responses`);
  respDiv.innerHTML = '';
  const list = document.createElement('ul');
  const formTitle = formTitleById[formId] || formId;
  data.items.forEach(r=>{
    const li = document.createElement('li');
    const a = document.createElement('a'); a.href='#';
    const displayChiffre = r.chiffre || r.email || '—';
    a.textContent = `${formTitle} — ${displayChiffre}`;
    a.onclick = (e)=>{e.preventDefault(); loadResponse(r.response_id)};
    const meta = document.createElement('span');
    meta.className = 'muted';
    meta.textContent = ` • ${r.datum || ''} • ${r.email || ''} • ${r.count} Antworten`;
    li.appendChild(a); li.appendChild(meta);
    list.appendChild(li);
  });
  respDiv.appendChild(list);
}

async function loadResponse(responseId){
  const data = await api(`/api/responses/${encodeURIComponent(responseId)}`);
  ansDiv.innerHTML = '';
  relDiv.innerHTML = '';
  const list = document.createElement('div');
  data.items.forEach(a=>{
    const card = document.createElement('div');
    card.className = 'card';
    const row = document.createElement('div'); row.className = 'row';
    const q = document.createElement('div'); q.innerHTML = `<strong>${escapeHtml(a.frage||'')}</strong>`;
    const btn = document.createElement('button'); btn.textContent = 'Andere Antworten';
    btn.onclick = ()=> openRelatedModal(a);
    row.appendChild(q); row.appendChild(btn);
    const val = document.createElement('div'); val.textContent = a.antwort ?? '—';
    card.appendChild(row); card.appendChild(val);
    list.appendChild(card);
  });
  ansDiv.appendChild(list);
}

async function openRelatedModal(original){
  const data = await api(`/api/answers/related?form_id=${encodeURIComponent(original.form_id)}&field_id=${encodeURIComponent(original.field_id)}&exclude_response_id=${encodeURIComponent(original.response_id)}`);
  const modal = document.getElementById('modal');
  const content = document.getElementById('modalContent');
  content.innerHTML = '';
  const title = document.createElement('div');
  title.innerHTML = `<h3>${escapeHtml(original.frage||'')}</h3>`;
  const orig = document.createElement('div');
  orig.className = 'original';
  orig.textContent = original.antwort ?? '—';
  const list = document.createElement('ul');
  list.className = 'related-list';
  data.items.forEach(x=>{
    const li = document.createElement('li');
    li.textContent = `${x.antwort ?? '—'} `;
    const pill = document.createElement('span'); pill.className='pill'; pill.textContent = `${x.count}`; li.appendChild(pill);
    list.appendChild(li);
  });
  content.appendChild(title);
  content.appendChild(orig);
  content.appendChild(list);
  showModal();
}

function escapeHtml(text){
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}

// search
const searchForm = document.getElementById('searchForm');
searchForm.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const q = document.getElementById('q').value.trim();
  if(!q){ loadForms(''); respDiv.innerHTML=''; ansDiv.innerHTML=''; relDiv.innerHTML=''; return; }
  const data = await api(`/api/search?q=${encodeURIComponent(q)}`);
  respDiv.innerHTML=''; ansDiv.innerHTML=''; relDiv.innerHTML='';
  const list = document.createElement('ul');
  data.items.forEach(r=>{
    const li = document.createElement('li');
    const a = document.createElement('a'); a.href='#';
    a.textContent = `${r.form_id} - ${r.response_id}`;
    a.onclick = (e)=>{e.preventDefault(); loadResponse(r.response_id)};
    const meta = document.createElement('span'); meta.className='muted'; meta.textContent = ` • ${r.datum||''} • ${r.email||''} ${r.chiffre?`• ${r.chiffre}`:''}`;
    li.appendChild(a); li.appendChild(meta);
    list.appendChild(li);
  });
  respDiv.appendChild(list);
});

const formFilter = document.getElementById('formFilter');
formFilter.addEventListener('input', ()=> loadForms(formFilter.value.trim()));

loadForms('');

// modal helpers
function showModal(){
  const modal = document.getElementById('modal');
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden','false');
}
function hideModal(){
  const modal = document.getElementById('modal');
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden','true');
}
document.addEventListener('click', (e)=>{
  const modal = document.getElementById('modal');
  if(e.target.classList.contains('modal-close') || e.target === modal){ hideModal(); }
});

// Chiffres overview
async function loadChiffres(){
  const data = await api('/api/chiffres?limit=500');
  chiffresDiv.innerHTML = '';
  const list = document.createElement('ul');
  data.items.forEach(c=>{
    const li = document.createElement('li');
    const a = document.createElement('a'); a.href='#';
    a.textContent = `${c.chiffre}`;
    a.onclick = async (e)=>{
      e.preventDefault();
      // Search by chiffre and render results in the Responses column
      const res = await api(`/api/chiffre/${encodeURIComponent(c.chiffre)}`);
      respDiv.innerHTML = '';
      const ul = document.createElement('ul');
      res.items.forEach(r=>{
        const li2 = document.createElement('li');
        const a2 = document.createElement('a'); a2.href='#';
        const title = formTitleById[r.form_id] || r.form_id;
        a2.textContent = `${title} — ${c.chiffre}`;
        a2.onclick = (ev)=>{ ev.preventDefault(); loadResponse(r.response_id); };
        const meta = document.createElement('span'); meta.className='muted'; meta.textContent = ` • ${r.datum||''} • ${r.email||''}`;
        li2.appendChild(a2); li2.appendChild(meta);
        ul.appendChild(li2);
      });
      respDiv.appendChild(ul);
    };
    const meta = document.createElement('span'); meta.className='muted'; meta.textContent = ` • ${c.responsesCount} Responses, ${c.formsCount} Formulare, zuletzt: ${c.latest || ''}`;
    li.appendChild(a); li.appendChild(meta);
    list.appendChild(li);
  });
  chiffresDiv.appendChild(list);
}
document.getElementById('loadChiffres').addEventListener('click', loadChiffres);
