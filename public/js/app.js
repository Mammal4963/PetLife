/* PetLife frontend — no build step, just fetch + templates. */

const $app = document.getElementById('app');
const $modalRoot = document.getElementById('modal-root');

// ---------------------------------------------------------------- utilities

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtDateRange(start, end) {
  return end && end !== start ? `${fmtDate(start)} – ${fmtDate(end)}` : fmtDate(start);
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function api(url, opts = {}) {
  const res = await fetch(url, opts);
  if (res.status === 401) {
    showLogin();
    throw new Error('unauthorized');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

const getJSON = (url) => api(url);
const postJSON = (url, body) => api(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const del = (url) => api(url, { method: 'DELETE' });

function toast(msg, isError = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' error-toast' : '');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ------------------------------------------------------------------- theme

const $themeToggle = document.getElementById('theme-toggle');
function currentTheme() {
  return document.documentElement.dataset.theme ||
    (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}
function updateThemeIcon() {
  $themeToggle.textContent = currentTheme() === 'dark' ? '☀️' : '🌙';
}
$themeToggle.addEventListener('click', () => {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('pl_theme', next);
  updateThemeIcon();
});
updateThemeIcon();

// ------------------------------------------------------------------- login

function showLogin() {
  document.getElementById('login-overlay').classList.remove('hidden');
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = document.getElementById('login-password').value;
  try {
    await api('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    document.getElementById('login-overlay').classList.add('hidden');
    route();
  } catch (err) {
    document.getElementById('login-error').textContent = err.message;
  }
});

// ------------------------------------------------------------------ modals

function openModal(title, bodyHtml) {
  $modalRoot.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal card">
        <div class="modal-head">
          <h2>${esc(title)}</h2>
          <button class="icon-btn" data-close>✕</button>
        </div>
        <div class="modal-body">${bodyHtml}</div>
      </div>
    </div>`;
  const backdrop = $modalRoot.querySelector('.modal-backdrop');
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop || e.target.hasAttribute('data-close')) closeModal();
  });
  return $modalRoot.querySelector('.modal');
}

function closeModal() {
  $modalRoot.innerHTML = '';
}

// Generic small-form modal. fields: {name, label, type, options?, value?, required?, placeholder?}
function openForm(title, fields, onSubmit, submitLabel = 'Save') {
  const inputs = fields.map((f) => {
    const val = esc(f.value ?? '');
    const req = f.required ? 'required' : '';
    let control;
    if (f.type === 'textarea') {
      control = `<textarea name="${f.name}" rows="3" ${req} placeholder="${esc(f.placeholder || '')}">${val}</textarea>`;
    } else if (f.type === 'select') {
      control = `<select name="${f.name}">${f.options.map((o) =>
        `<option value="${esc(o.value)}" ${String(o.value) === String(f.value) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
    } else {
      const step = f.type === 'number' ? 'step="any" inputmode="decimal"' : '';
      control = `<input type="${f.type || 'text'}" name="${f.name}" value="${val}" ${req} ${step} placeholder="${esc(f.placeholder || '')}">`;
    }
    return `<label class="field"><span>${esc(f.label)}</span>${control}</label>`;
  }).join('');

  const modal = openModal(title, `
    <form class="stack">
      ${inputs}
      <p class="error form-error"></p>
      <button type="submit" class="btn primary">${esc(submitLabel)}</button>
    </form>`);

  modal.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await onSubmit(data);
      closeModal();
    } catch (err) {
      e.target.querySelector('.form-error').textContent = err.message;
      btn.disabled = false;
    }
  });
}

// ---------------------------------------------------------------- lightbox

const $lightbox = document.getElementById('lightbox');
$lightbox.addEventListener('click', () => $lightbox.classList.add('hidden'));
document.body.addEventListener('click', (e) => {
  const img = e.target.closest('[data-lightbox]');
  if (img) {
    $lightbox.querySelector('img').src = img.dataset.lightbox;
    $lightbox.classList.remove('hidden');
  }
});

// ------------------------------------------------------------- shared bits

let petsCache = null;
async function loadPets(force = false) {
  if (!petsCache || force) petsCache = await getJSON('/api/pets');
  return petsCache;
}

function petAvatar(pet, size = '') {
  const memorial = pet.passed_date ? '<span class="memorial-badge" title="In loving memory">🌈</span>' : '';
  if (pet.photo_url) {
    return `<span class="avatar ${size}">${memorial}<img src="${esc(pet.photo_url)}" alt="${esc(pet.name)}"></span>`;
  }
  const emoji = pet.species === 'dog' ? '🐶' : pet.species === 'cat' ? '🐱' : '🐾';
  return `<span class="avatar ${size}">${memorial}<span class="avatar-emoji">${emoji}</span></span>`;
}

function youtubeEmbed(id) {
  return `<div class="video-wrap"><iframe src="https://www.youtube-nocookie.com/embed/${esc(id)}"
    title="YouTube video" frameborder="0" loading="lazy"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
    allowfullscreen></iframe></div>`;
}

function postCard(post, { showDelete = true } = {}) {
  const petChips = post.pets.map((p) => `<a class="chip" href="#/pet/${p.id}">${esc(p.name)}</a>`).join('');
  // Per-photo name badges are only informative when the family has
  // more than one pet in the post.
  const showTags = post.pets.length > 1;
  const photos = post.media.length ? `
    <div class="photo-grid n${Math.min(post.media.length, 4)}">
      ${post.media.map((m) => `<figure class="photo-cell">
        <img src="${esc(m.url)}" data-lightbox="${esc(m.url)}" loading="lazy" alt="">
        ${showTags && m.pets?.length ? `<figcaption class="photo-tags">${esc(m.pets.map((p) => p.name).join(', '))}</figcaption>` : ''}
      </figure>`).join('')}
    </div>` : '';
  return `
    <article class="card post" data-post-id="${post.id}">
      <div class="post-head">
        <div>
          <time>${fmtDateRange(post.post_date, post.post_date_end)}</time>
          ${post.title ? `<h3>${esc(post.title)}</h3>` : ''}
        </div>
        ${showDelete ? `<span>
          <button class="icon-btn subtle" data-edit-post="${post.id}" title="Edit post">✎</button>
          <button class="icon-btn subtle" data-del-post="${post.id}" title="Delete post">🗑</button>
        </span>` : ''}
      </div>
      ${post.body ? `<p class="post-body">${esc(post.body).replace(/\n/g, '<br>')}</p>` : ''}
      ${photos}
      ${post.youtube_id ? youtubeEmbed(post.youtube_id) : ''}
      ${petChips ? `<div class="chips">${petChips}</div>` : ''}
    </article>`;
}

document.body.addEventListener('click', async (e) => {
  const delBtn = e.target.closest('[data-del-post]');
  if (delBtn && confirm('Delete this post? Its photos will be removed too.')) {
    await del(`/api/posts/${delBtn.dataset.delPost}`);
    delBtn.closest('article').remove();
    toast('Post deleted');
  }
});

// ----------------------------------------------------------------- new post

// Create a new post, or edit an existing one when `post` is given.
async function openPostForm(defaultPetIds = [], post = null) {
  const pets = await loadPets();
  const checkedIds = post ? post.pets.map((p) => p.id) : defaultPetIds;
  const petChecks = pets.filter((p) => !p.passed_date || checkedIds.includes(p.id)).map((p) => `
    <label class="check"><input type="checkbox" name="pet_ids" value="${p.id}"
      ${checkedIds.includes(p.id) || (!post && defaultPetIds.length === 0 && !p.passed_date) ? 'checked' : ''}> ${esc(p.name)}</label>`).join('');

  // Pets that can be tagged in individual photos (same set as "Who's in it?").
  const tagPets = pets.filter((p) => !p.passed_date || checkedIds.includes(p.id));
  const multiPet = tagPets.length > 1;
  // Default tags for newly added photos: the timeline filter/post's pets,
  // or every living pet on a fresh unfiltered post.
  const defaultTagIds = checkedIds.length
    ? checkedIds
    : tagPets.filter((p) => !p.passed_date).map((p) => p.id);
  const tagChips = (activeIds) => tagPets.map((p) => `
    <button type="button" class="chip tag-chip ${activeIds.includes(p.id) ? 'active' : ''}"
      data-pet="${p.id}">${esc(p.name)}</button>`).join('');

  const carouselNav = (count) => count > 1 ? `
    <div class="carousel-nav">
      <button type="button" class="btn small" data-car-prev>‹ Prev</button>
      <span class="carousel-counter">1 / ${count}</span>
      <button type="button" class="btn small" data-car-next>Next ›</button>
    </div>` : '';

  const existingPhotos = post?.media.length ? `
    <div class="field"><span>Current photos</span>
      <div id="existing-photos">
        <div class="carousel-track">
          ${post.media.map((m) => `
            <figure class="carousel-slide preview-photo" data-media="${m.id}">
              <img src="${esc(m.url)}" alt="">
              <figcaption class="slide-controls">
                ${multiPet ? `<span class="photo-tag-chips" data-media-chips="${m.id}">
                  ${tagChips((m.pets || []).map((p) => p.id))}
                </span>` : ''}
                <span class="slide-meta">
                  <input type="date" class="photo-date" data-media-date="${m.id}" value="${esc(m.media_date || post.post_date)}" title="When this photo was taken">
                  <button type="button" class="btn small danger" data-remove-media>🗑 Remove</button>
                </span>
              </figcaption>
            </figure>`).join('')}
        </div>
        ${carouselNav(post.media.length)}
      </div>
    </div>` : '';

  const modal = openModal(post ? 'Edit post' : 'New timeline post', `
    <form class="stack" id="post-form">
      <label class="field"><span>Title (optional)</span><input type="text" name="title" value="${esc(post?.title || '')}" placeholder="First day home!"></label>
      <label class="field"><span>What happened?</span><textarea name="body" rows="3" placeholder="Tell the story…">${esc(post?.body || '')}</textarea></label>
      <div id="no-photo-fields" class="stack">
        <label class="field"><span>Date</span>
          <input type="date" name="post_date" value="${esc(post?.post_date || today())}">
        </label>
        <div class="field"><span>Who's in it?</span><div class="checks">${petChecks || '<em>Add a pet first to tag them</em>'}</div>
          <small>With photos, the date and pets come from tagging each photo instead.</small>
        </div>
      </div>
      ${existingPhotos}
      <label class="field"><span>${post ? 'Add photos' : 'Photos'}</span><input type="file" name="photos" accept="image/*" multiple></label>
      <div id="photo-preview" class="preview-row"></div>
      <label class="field"><span>YouTube link (optional)</span>
        <input type="url" name="youtube_url" value="${esc(post?.youtube_url || '')}" placeholder="https://youtu.be/…">
        <small>Upload videos to your unlisted YouTube channel from your phone, then paste the link here — free hosting forever.</small>
      </label>
      <p class="error form-error"></p>
      <button type="submit" class="btn primary">${post ? 'Save changes' : 'Post it 🐾'}</button>
    </form>`);

  const form = modal.querySelector('#post-form');
  const fileInput = form.querySelector('input[name=photos]');
  const preview = modal.querySelector('#photo-preview');
  let compressed = [];

  const checkedPetIds = () =>
    [...form.querySelectorAll('input[name=pet_ids]:checked')].map((c) => Number(c.value));

  // The plain date field and pet checkboxes only matter for posts without
  // photos; photos carry their own dates and tags, and the post derives both.
  const hasPhotos = () => compressed.length > 0 ||
    modal.querySelectorAll('#existing-photos .preview-photo:not(.removed)').length > 0;
  const updateDateVisibility = () => {
    modal.querySelector('#no-photo-fields').classList.toggle('hidden', hasPhotos());
  };
  updateDateVisibility();

  modal.addEventListener('click', (e) => {
    const chip = e.target.closest('.tag-chip');
    if (chip) chip.classList.toggle('active');
    const remove = e.target.closest('[data-remove-media]');
    if (remove) {
      const slide = remove.closest('.preview-photo');
      slide.classList.toggle('removed');
      remove.textContent = slide.classList.contains('removed') ? '↩ Keep it' : '🗑 Remove';
      updateDateVisibility();
    }
  });

  // Prev/Next arrows and position counter for a carousel container.
  const wireCarousel = (root, count) => {
    const track = root?.querySelector('.carousel-track');
    const counter = root?.querySelector('.carousel-counter');
    if (!track || !counter) return;
    track.addEventListener('scroll', () => {
      const idx = Math.min(Math.round(track.scrollLeft / track.clientWidth) + 1, count);
      counter.textContent = `${idx} / ${count}`;
    }, { passive: true });
    root.querySelector('[data-car-prev]').onclick = () =>
      track.scrollBy({ left: -track.clientWidth, behavior: 'smooth' });
    root.querySelector('[data-car-next]').onclick = () =>
      track.scrollBy({ left: track.clientWidth, behavior: 'smooth' });
  };
  wireCarousel(modal.querySelector('#existing-photos'), post?.media.length || 0);

  let previewUrls = [];
  fileInput.addEventListener('change', async () => {
    compressed = [];
    const files = [...fileInput.files];
    if (!files.length) {
      preview.innerHTML = '';
      updateDateVisibility();
      return;
    }
    // Each photo carries its own date, read from the original file's
    // metadata before compression strips it (editable below).
    const detectedDates = await Promise.all(files.map(readPhotoDate));
    for (let i = 0; i < files.length; i++) {
      preview.innerHTML = `<em>Compressing photos… ${i + 1} / ${files.length}</em>`;
      compressed.push(await compressImage(files[i]));
    }
    previewUrls.forEach((u) => URL.revokeObjectURL(u));
    previewUrls = compressed.map((f) => URL.createObjectURL(f));

    // Carousel: one big slide per photo — swipe or use the arrows, and tag
    // who's in each one.
    const defaults = defaultTagIds;
    preview.innerHTML = `
      <div class="carousel-track">
        ${compressed.map((f, i) => `
          <figure class="carousel-slide" data-photo="${i}">
            <img src="${previewUrls[i]}" alt="">
            <figcaption class="slide-controls">
              ${multiPet ? `<span class="photo-tag-chips" data-photo="${i}">${tagChips(defaults)}</span>` : ''}
              <span class="slide-meta">
                <input type="date" class="photo-date" data-photo="${i}" value="${esc(detectedDates[i] || today())}" title="When this photo was taken">
                <small>📷 ${esc(f.name)} · ${(f.size / 1024).toFixed(0)} KB</small>
              </span>
            </figcaption>
          </figure>`).join('')}
      </div>
      ${carouselNav(compressed.length)}`;
    wireCarousel(preview, compressed.length);
    updateDateVisibility();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.textContent = post ? 'Saving…' : 'Posting…';
    try {
      const fd = new FormData();
      for (const name of ['post_date', 'title', 'body', 'youtube_url']) {
        fd.append(name, form.elements[name].value);
      }
      // Per-photo tags and dates for new photos; without toggles (single
      // pet), every photo gets the default pets.
      const tagRows = [...preview.querySelectorAll('.photo-tag-chips')];
      const photoTags = compressed.map((_, i) => {
        const row = tagRows.find((r) => Number(r.dataset.photo) === i);
        return row
          ? [...row.querySelectorAll('.tag-chip.active')].map((c) => Number(c.dataset.pet))
          : defaultTagIds;
      });
      fd.append('photo_pets', JSON.stringify(photoTags));
      const photoDates = compressed.map((_, i) => {
        const inp = preview.querySelector(`.photo-date[data-photo="${i}"]`);
        return inp && inp.value ? inp.value : today();
      });
      fd.append('photo_dates', JSON.stringify(photoDates));

      // Existing photos (edit only): removals, updated tags, updated dates.
      const mediaTags = {};
      const mediaDates = {};
      const removeMedia = [];
      modal.querySelectorAll('#existing-photos .preview-photo').forEach((row) => {
        const mid = Number(row.dataset.media);
        if (row.classList.contains('removed')) {
          removeMedia.push(mid);
          return;
        }
        const chips = row.querySelector('[data-media-chips]');
        if (chips) mediaTags[mid] = [...chips.querySelectorAll('.tag-chip.active')].map((c) => Number(c.dataset.pet));
        const dinp = row.querySelector('[data-media-date]');
        if (dinp && dinp.value) mediaDates[mid] = dinp.value;
      });
      if (post) {
        fd.append('remove_media', JSON.stringify(removeMedia));
        fd.append('media_pets', JSON.stringify(mediaTags));
        fd.append('media_dates', JSON.stringify(mediaDates));
      }

      // The post is tagged with everyone who appears in its photos; the
      // checkboxes only apply to photo-less posts.
      const postPets = new Set();
      photoTags.flat().forEach((id) => postPets.add(id));
      Object.values(mediaTags).flat().forEach((id) => postPets.add(id));
      if (!hasPhotos()) checkedPetIds().forEach((id) => postPets.add(id));
      // Single-pet households render no chips, so keep the post's pets.
      if (!postPets.size && !multiPet) {
        (post ? post.pets.map((p) => p.id) : defaultTagIds).forEach((id) => postPets.add(id));
      }
      postPets.forEach((id) => fd.append('pet_ids', id));

      for (const f of compressed) fd.append('photos', f, f.name);
      await api(post ? `/api/posts/${post.id}` : '/api/posts', { method: post ? 'PUT' : 'POST', body: fd });
      closeModal();
      toast(post ? 'Saved' : 'Posted! 🎉');
      route();
    } catch (err) {
      form.querySelector('.form-error').textContent = err.message;
      btn.disabled = false;
      btn.textContent = post ? 'Save changes' : 'Post it 🐾';
    }
  });
}

// ----------------------------------------------------------------- pet form

function openPetForm(pet = null) {
  const modal = openModal(pet ? `Edit ${pet.name}` : 'Add a pet', `
    <form class="stack" id="pet-form">
      <label class="field"><span>Name</span><input type="text" name="name" value="${esc(pet?.name || '')}" required></label>
      <div class="two-col">
        <label class="field"><span>Species</span>
          <select name="species">
            ${['cat', 'dog', 'other'].map((s) => `<option value="${s}" ${(pet?.species || 'cat') === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select></label>
        <label class="field"><span>Sex</span>
          <select name="sex">
            <option value="" ${!pet?.sex ? 'selected' : ''}>—</option>
            ${['male', 'female'].map((s) => `<option value="${s}" ${pet?.sex === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select></label>
      </div>
      <div class="two-col">
        <label class="field"><span>Birthdate (or best guess)</span><input type="date" name="birthdate" value="${esc(pet?.birthdate || '')}"></label>
        <label class="field"><span>Adopted / Gotcha day</span><input type="date" name="adopted_date" value="${esc(pet?.adopted_date || '')}"></label>
      </div>
      <label class="field"><span>Passed away (leave blank if with us)</span><input type="date" name="passed_date" value="${esc(pet?.passed_date || '')}"></label>
      <label class="field"><span>Breed</span><input type="text" name="breed" value="${esc(pet?.breed || '')}"></label>
      <label class="field"><span>Notes</span><textarea name="notes" rows="2">${esc(pet?.notes || '')}</textarea></label>
      <label class="field"><span>Photo</span><input type="file" name="photo" accept="image/*"></label>
      <p class="error form-error"></p>
      <button type="submit" class="btn primary">${pet ? 'Save changes' : 'Add pet'}</button>
    </form>`);

  const form = modal.querySelector('#pet-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const fd = new FormData();
      for (const name of ['name', 'species', 'sex', 'birthdate', 'adopted_date', 'passed_date', 'breed', 'notes']) {
        fd.append(name, form.elements[name].value);
      }
      const photo = form.elements.photo.files[0];
      if (photo) {
        const small = await compressImage(photo, 1200);
        fd.append('photo', small, small.name);
      }
      await api(pet ? `/api/pets/${pet.id}` : '/api/pets', { method: pet ? 'PUT' : 'POST', body: fd });
      await loadPets(true);
      closeModal();
      toast(pet ? 'Saved' : 'Welcome to the family! 🐾');
      route();
    } catch (err) {
      form.querySelector('.form-error').textContent = err.message;
      btn.disabled = false;
    }
  });
}

// -------------------------------------------------------------------- home

async function renderHome() {
  const [pets, reminders, posts] = await Promise.all([
    loadPets(true),
    getJSON('/api/reminders'),
    getJSON('/api/posts'),
  ]);

  const petCards = pets.map((p) => `
    <a class="pet-tile ${p.passed_date ? 'memorial' : ''}" href="#/pet/${p.id}">
      ${petAvatar(p, 'lg')}
      <strong>${esc(p.name)}</strong>
      ${p.passed_date ? `<small>In loving memory</small>` : ''}
    </a>`).join('');

  const reminderItems = reminders.length ? reminders.map((r) => `
    <li class="${r.days < 0 ? 'overdue' : ''}">
      <span class="rem-when">${r.days < 0 ? `${-r.days}d overdue` : r.days === 0 ? 'Today!' : `in ${r.days}d`}</span>
      <span>${esc(r.title)}</span>
      <time>${fmtDate(r.date)}</time>
    </li>`).join('') : '<li class="empty">Nothing coming up. Enjoy the calm 😌</li>';

  const recent = posts.slice(0, 3).map((p) => postCard(p, { showDelete: false })).join('');

  $app.innerHTML = `
    <section class="hero">
      <h1>The Family</h1>
      <div class="pet-row">${petCards}
        <button class="pet-tile add-tile" id="add-pet">＋<small>Add a pet</small></button>
      </div>
    </section>
    <div class="home-grid">
      <section class="card">
        <div class="section-head"><h2>📅 Coming up</h2>
          <button class="btn small" id="add-date">+ Important date</button></div>
        <ul class="reminder-list">${reminderItems}</ul>
      </section>
      <section>
        <div class="section-head"><h2>🕰 Latest memories</h2>
          <button class="btn primary small" id="new-post">+ New post</button></div>
        ${recent || '<p class="empty card">No posts yet — share your first memory!</p>'}
        ${posts.length ? '<a class="see-all" href="#/timeline">See the whole timeline →</a>' : ''}
      </section>
    </div>`;

  document.getElementById('add-pet').onclick = () => openPetForm();
  document.getElementById('new-post').onclick = () => openPostForm();
  document.getElementById('add-date').onclick = () => openForm('Add an important date', [
    { name: 'title', label: 'What is it?', required: true, placeholder: 'Neuter appointment' },
    { name: 'event_date', label: 'Date', type: 'date', required: true },
    {
      name: 'pet_id', label: 'Pet (optional)', type: 'select',
      options: [{ value: '', label: '— whole family —' }, ...pets.map((p) => ({ value: p.id, label: p.name }))],
    },
    {
      name: 'recurring', label: 'Repeats every year?', type: 'select',
      options: [{ value: '', label: 'No, one time' }, { value: '1', label: 'Yes, yearly' }],
    },
  ], async (data) => {
    await postJSON('/api/important-dates', { ...data, pet_id: data.pet_id || null, recurring: Boolean(data.recurring) });
    toast('Date saved');
    route();
  });
}

// ---------------------------------------------------------------- timeline

async function renderTimeline(petId = null) {
  const pets = await loadPets();
  const posts = await getJSON('/api/posts' + (petId ? `?pet_id=${petId}` : ''));

  const filters = `
    <div class="chips filter-chips">
      <a class="chip ${!petId ? 'active' : ''}" href="#/timeline">Everyone</a>
      ${pets.map((p) => `<a class="chip ${String(petId) === String(p.id) ? 'active' : ''}" href="#/timeline/${p.id}">${esc(p.name)}</a>`).join('')}
    </div>`;

  $app.innerHTML = `
    <section>
      <div class="section-head"><h1>Timeline</h1>
        <div class="btn-row">
          <button class="btn" id="share-timeline">Share</button>
          <button class="btn primary" id="new-post">+ New post</button>
        </div></div>
      ${filters}
      <div class="timeline">
        ${posts.map((p) => postCard(p)).join('') ||
          '<p class="empty card">No memories here yet. Time to make some! 📸</p>'}
      </div>
    </section>`;
  document.getElementById('new-post').onclick = () => openPostForm(petId ? [Number(petId)] : []);
  document.getElementById('share-timeline').onclick = openTimelineShareModal;
  $app.querySelectorAll('[data-edit-post]').forEach((btn) => {
    btn.onclick = () => openPostForm([], posts.find((p) => p.id === Number(btn.dataset.editPost)));
  });
}

// -------------------------------------------------------------------- pets

async function renderPets() {
  const pets = await loadPets(true);
  $app.innerHTML = `
    <section>
      <div class="section-head"><h1>Our Pets</h1>
        <button class="btn primary" id="add-pet">+ Add a pet</button></div>
      <div class="pet-grid">
        ${pets.map((p) => `
          <a class="card pet-card ${p.passed_date ? 'memorial' : ''}" href="#/pet/${p.id}">
            ${petAvatar(p, 'lg')}
            <div>
              <h3>${esc(p.name)}</h3>
              <p class="muted">${esc([p.sex, p.breed || p.species].filter(Boolean).join(' · '))}</p>
              ${p.passed_date ? `<p class="memorial-note">🌈 ${fmtDate(p.passed_date)} — forever loved</p>`
                : p.birthdate ? `<p class="muted">Born ${fmtDate(p.birthdate)}</p>` : ''}
            </div>
          </a>`).join('') || '<p class="empty card">No pets yet — add your crew!</p>'}
      </div>
    </section>`;
  document.getElementById('add-pet').onclick = () => openPetForm();
}

// -------------------------------------------------------------- vet sharing

// Shared modal for managing secret share links (medical or timeline scope).
async function openShareLinksModal(cfg) {
  const links = await getJSON(cfg.apiUrl);
  const shareUrl = (token) => `${location.origin}${cfg.page}?t=${token}`;
  const linkRow = (l) => `
    <li class="share-row">
      <input type="text" readonly value="${esc(shareUrl(l.token))}">
      <button type="button" class="btn small" data-copy="${esc(l.token)}">Copy</button>
      <button type="button" class="icon-btn subtle" data-revoke="${l.id}" title="Revoke this link">🗑</button>
      <small>${l.expires_at ? `expires ${fmtDate(l.expires_at.slice(0, 10))}` : 'never expires'}</small>
    </li>`;

  const modal = openModal(cfg.title, `
    <p class="muted">${cfg.blurb}</p>
    <ul class="share-list">${links.map(linkRow).join('') || '<li class="empty">No active links yet.</li>'}</ul>
    <form class="share-new">
      <select name="days">
        <option value="30">Expires in 30 days</option>
        <option value="7">Expires in 7 days</option>
        <option value="90">Expires in 90 days</option>
        <option value="">Never expires</option>
      </select>
      <button type="submit" class="btn primary small">+ New link</button>
    </form>`);

  modal.querySelector('.share-new').addEventListener('submit', async (e) => {
    e.preventDefault();
    await postJSON(cfg.apiUrl, { days: e.target.elements.days.value });
    openShareLinksModal(cfg);
  });
  modal.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(shareUrl(btn.dataset.copy));
      } catch {
        const input = btn.previousElementSibling;
        input.select();
        document.execCommand('copy');
      }
      toast(cfg.copiedToast);
    };
  });
  modal.querySelectorAll('[data-revoke]').forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm('Revoke this link? Anyone using it will lose access.')) return;
      await del(`/api/shares/${btn.dataset.revoke}`);
      toast('Link revoked');
      openShareLinksModal(cfg);
    };
  });
}

function openShareModal(pet) {
  return openShareLinksModal({
    title: `Share ${pet.name}'s medical records`,
    blurb: `Anyone with one of these links can see ${esc(pet.name)}'s medical records —
      read-only, no password needed. Send one to your vet, and revoke it whenever you like.
      The timeline and photos stay private.`,
    apiUrl: `/api/pets/${pet.id}/shares`,
    page: '/share.html',
    copiedToast: 'Link copied — paste it in a text or email to your vet',
  });
}

function openTimelineShareModal() {
  return openShareLinksModal({
    title: 'Share the timeline',
    blurb: `Anyone with one of these links can see the whole timeline — photos, videos,
      and posts — read-only, no password needed. Perfect for grandparents and friends.
      Medical records stay private, and you can revoke a link whenever you like.`,
    apiUrl: '/api/timeline-shares',
    page: '/share-timeline.html',
    copiedToast: 'Link copied — send it to family and friends',
  });
}

// --------------------------------------------------------------- pet detail

function medTable(title, emoji, rows, cols, addLabel, onAdd, delType) {
  const header = cols.map((c) => `<th>${esc(c.label)}</th>`).join('');
  const body = rows.map((r) => `
    <tr>${cols.map((c) => `<td>${esc(c.fmt ? c.fmt(r[c.key], r) : r[c.key] ?? '')}</td>`).join('')}
      <td class="row-actions"><button class="icon-btn subtle" data-del="${delType}:${r.id}" title="Delete">🗑</button></td></tr>`).join('');
  return `
    <section class="card med-section">
      <div class="section-head"><h3>${emoji} ${esc(title)}</h3>
        <button class="btn small" data-add="${onAdd}">+ ${esc(addLabel)}</button></div>
      ${rows.length ? `<div class="table-wrap"><table><thead><tr>${header}<th></th></tr></thead><tbody>${body}</tbody></table></div>`
        : `<p class="empty">Nothing recorded yet.</p>`}
    </section>`;
}

async function renderPetDetail(id) {
  let pet;
  try {
    pet = await getJSON(`/api/pets/${id}`);
  } catch {
    $app.innerHTML = '<p class="empty card">Pet not found.</p>';
    return;
  }

  const facts = [
    pet.birthdate && `🎂 Born ${fmtDate(pet.birthdate)}`,
    pet.adopted_date && `🏡 Gotcha day ${fmtDate(pet.adopted_date)}`,
    pet.passed_date && `🌈 Crossed the rainbow bridge ${fmtDate(pet.passed_date)}`,
    pet.breed && `🧬 ${pet.breed}`,
    pet.sex && (pet.sex === 'male' ? '♂ Male' : '♀ Female'),
  ].filter(Boolean).map((f) => `<span class="fact">${esc(f)}</span>`).join('');

  $app.innerHTML = `
    <section class="pet-header card ${pet.passed_date ? 'memorial' : ''}">
      ${petAvatar(pet, 'xl')}
      <div class="pet-header-info">
        <h1>${esc(pet.name)} ${pet.passed_date ? '🌈' : ''}</h1>
        <div class="facts">${facts}</div>
        ${pet.notes ? `<p class="muted">${esc(pet.notes)}</p>` : ''}
        <div class="btn-row">
          <a class="btn small" href="#/timeline/${pet.id}">View timeline</a>
          <button class="btn small" id="share-pet">Share with vet</button>
          <button class="btn small" id="edit-pet">Edit</button>
          <button class="btn small danger" id="delete-pet">Remove</button>
        </div>
      </div>
    </section>

    ${medTable('Vaccinations', '💉', pet.vaccinations, [
      { key: 'name', label: 'Vaccine' },
      { key: 'date_given', label: 'Given', fmt: fmtDate },
      { key: 'due_date', label: 'Next due', fmt: (v) => v ? fmtDate(v) : '' },
      { key: 'notes', label: 'Notes' },
    ], 'Add vaccine', 'vaccination', 'vaccinations')}

    ${medTable('Vet visits', '🩺', pet.visits, [
      { key: 'visit_date', label: 'Date', fmt: fmtDate },
      { key: 'reason', label: 'Reason' },
      { key: 'vet_name', label: 'Vet' },
      { key: 'notes', label: 'Notes' },
    ], 'Add visit', 'visit', 'visits')}

    ${medTable('Medications', '💊', pet.medications, [
      { key: 'name', label: 'Medication' },
      { key: 'dose', label: 'Dose' },
      { key: 'frequency', label: 'How often' },
      { key: 'start_date', label: 'Started', fmt: fmtDate },
      { key: 'end_date', label: 'Ends', fmt: (v) => v ? fmtDate(v) : 'ongoing' },
    ], 'Add medication', 'medication', 'medications')}

    ${medTable('Weight log', '⚖️', pet.weights, [
      { key: 'weigh_date', label: 'Date', fmt: fmtDate },
      { key: 'weight', label: 'Weight', fmt: (v, r) => `${v} ${r.unit}` },
    ], 'Add weight', 'weight', 'weights')}

    <section class="card med-section">
      <div class="section-head"><h3>📄 Documents</h3>
        <button class="btn small" data-add="document">+ Upload</button></div>
      ${pet.documents.length ? `<ul class="doc-list">${pet.documents.map((d) => `
        <li><a href="${esc(d.url)}" target="_blank" rel="noopener">📎 ${esc(d.title)}</a>
          ${d.doc_date ? `<time>${fmtDate(d.doc_date)}</time>` : ''}
          <button class="icon-btn subtle" data-del="documents:${d.id}" title="Delete">🗑</button></li>`).join('')}</ul>`
        : '<p class="empty">No documents yet — vet records, adoption papers, anything.</p>'}
    </section>`;

  document.getElementById('share-pet').onclick = () => openShareModal(pet);
  document.getElementById('edit-pet').onclick = () => openPetForm(pet);
  document.getElementById('delete-pet').onclick = async () => {
    if (!confirm(`Remove ${pet.name} and all their records? This can't be undone.`)) return;
    await del(`/api/pets/${pet.id}`);
    await loadPets(true);
    toast(`${pet.name} removed`);
    location.hash = '#/pets';
  };

  const refresh = () => renderPetDetail(id);

  $app.querySelectorAll('[data-del]').forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm('Delete this entry?')) return;
      const [type, entryId] = btn.dataset.del.split(':');
      await del(`/api/${type}/${entryId}`);
      refresh();
    };
  });

  const addForms = {
    vaccination: () => openForm(`Add vaccine for ${pet.name}`, [
      { name: 'name', label: 'Vaccine', required: true, placeholder: 'FVRCP booster' },
      { name: 'date_given', label: 'Date given', type: 'date' },
      { name: 'due_date', label: 'Next due (sets a reminder)', type: 'date' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ], async (d) => { await postJSON(`/api/pets/${id}/vaccinations`, d); refresh(); }),
    visit: () => openForm(`Add vet visit for ${pet.name}`, [
      { name: 'visit_date', label: 'Date', type: 'date', required: true, value: today() },
      { name: 'reason', label: 'Reason', placeholder: 'Kitten checkup' },
      { name: 'vet_name', label: 'Vet / clinic' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ], async (d) => { await postJSON(`/api/pets/${id}/visits`, d); refresh(); }),
    medication: () => openForm(`Add medication for ${pet.name}`, [
      { name: 'name', label: 'Medication', required: true },
      { name: 'dose', label: 'Dose', placeholder: '2.5 mg' },
      { name: 'frequency', label: 'How often', placeholder: 'Twice daily' },
      { name: 'start_date', label: 'Start date', type: 'date' },
      { name: 'end_date', label: 'End date (blank = ongoing)', type: 'date' },
    ], async (d) => { await postJSON(`/api/pets/${id}/medications`, d); refresh(); }),
    weight: () => openForm(`Log weight for ${pet.name}`, [
      { name: 'weigh_date', label: 'Date', type: 'date', required: true, value: today() },
      { name: 'weight', label: 'Weight', type: 'number', required: true, placeholder: '8.2' },
      { name: 'unit', label: 'Unit', type: 'select', options: [{ value: 'lb', label: 'lb' }, { value: 'oz', label: 'oz' }, { value: 'kg', label: 'kg' }] },
    ], async (d) => { await postJSON(`/api/pets/${id}/weights`, d); refresh(); }),
    document: () => {
      const modal = openModal(`Upload document for ${pet.name}`, `
        <form class="stack" id="doc-form">
          <label class="field"><span>Title</span><input type="text" name="title" placeholder="Rabies certificate"></label>
          <label class="field"><span>Date</span><input type="date" name="doc_date"></label>
          <label class="field"><span>File (PDF or photo)</span><input type="file" name="file" required accept="image/*,.pdf"></label>
          <p class="error form-error"></p>
          <button type="submit" class="btn primary">Upload</button>
        </form>`);
      modal.querySelector('#doc-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const fd = new FormData();
          fd.append('title', e.target.elements.title.value);
          fd.append('doc_date', e.target.elements.doc_date.value);
          let file = e.target.elements.file.files[0];
          if (file && file.type.startsWith('image/')) file = await compressImage(file);
          fd.append('file', file, file.name);
          await api(`/api/pets/${id}/documents`, { method: 'POST', body: fd });
          closeModal();
          refresh();
        } catch (err) {
          e.target.querySelector('.form-error').textContent = err.message;
        }
      });
    },
  };
  $app.querySelectorAll('[data-add]').forEach((btn) => {
    btn.onclick = addForms[btn.dataset.add];
  });
}

// ------------------------------------------------------------------ router

async function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [page, arg] = hash.split('/');
  document.querySelectorAll('[data-nav]').forEach((a) => {
    a.classList.toggle('active', a.dataset.nav === (page || 'home') ||
      (a.dataset.nav === 'pets' && page === 'pet'));
  });
  try {
    if (page === 'timeline') await renderTimeline(arg || null);
    else if (page === 'pets') await renderPets();
    else if (page === 'pet' && arg) await renderPetDetail(arg);
    else await renderHome();
    window.scrollTo(0, 0);
  } catch (err) {
    if (err.message !== 'unauthorized') {
      $app.innerHTML = `<p class="empty card">Something went wrong: ${esc(err.message)}</p>`;
    }
  }
}

window.addEventListener('hashchange', route);

(async () => {
  const me = await fetch('/api/me').then((r) => r.json()).catch(() => ({ authRequired: false, authed: true }));
  if (me.authRequired && !me.authed) showLogin();
  else route();
})();
