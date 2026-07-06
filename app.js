'use strict';

/* ============================================================
   PetLog — application logic
   Storage keys (all data persisted in localStorage as JSON /
   base64 data-URLs for photos, per the brief).
   ============================================================ */
const STORAGE_KEYS = {
  dog: 'petlog.dog',
  routine: 'petlog.routine',
  health: 'petlog.health',
  memories: 'petlog.memories'
};

const GENDER_LABELS = { male: 'მამრი', female: 'მდედრი' };
const HEALTH_TYPE_LABELS = { analysis: 'ანალიზი', vaccination: 'აცრა', document: 'დოკუმენტი' };

/* ---------- storage helpers ----------
   Some browsers/WebViews block persistent localStorage entirely
   (private mode, cross-origin iframes, restricted test shells) and
   throw on the very first write, regardless of size. Rather than
   fail the whole app, we transparently fall back to an in-memory
   store for the session and show a one-time, non-blocking notice. */
const memoryFallback = {};
let usingFallbackStorage = false;

function safeGetItem(key){
  try{
    return localStorage.getItem(key);
  }catch(err){
    return key in memoryFallback ? memoryFallback[key] : null;
  }
}

function safeSetItem(key, value){
  try{
    localStorage.setItem(key, value);
    return true;
  }catch(err){
    console.warn('PetLog: localStorage unavailable, using in-memory store for this session', err);
    memoryFallback[key] = value;
    if(!usingFallbackStorage){
      usingFallbackStorage = true;
      showStorageNotice();
    }
    return true;
  }
}

function safeRemoveItem(key){
  try{ localStorage.removeItem(key); }catch(err){ /* ignore */ }
  delete memoryFallback[key];
}

function showStorageNotice(){
  if(document.getElementById('storage-notice')) return;
  const banner = document.createElement('div');
  banner.id = 'storage-notice';
  banner.className = 'storage-notice';
  banner.innerHTML = '<span>ამ ბრაუზერში მუდმივი შენახვა შეზღუდულია — მონაცემები დარჩება მხოლოდ ამ სესიის განმავლობაში.</span>';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'storage-notice-close';
  closeBtn.textContent = '✕';
  closeBtn.setAttribute('aria-label', 'დახურვა');
  closeBtn.addEventListener('click', () => banner.remove());
  banner.appendChild(closeBtn);
  document.body.prepend(banner);
}

function loadJSON(key, fallback){
  try{
    const raw = safeGetItem(key);
    return raw ? JSON.parse(raw) : fallback;
  }catch(err){
    console.error('PetLog: failed to read', key, err);
    return fallback;
  }
}

function saveJSON(key, value){
  return safeSetItem(key, JSON.stringify(value));
}

function uid(){
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* Compress + downscale photos before they're stored as base64.
   This keeps each entry small (a few dozen KB instead of several MB
   from a modern phone camera), so far more photos fit in whatever
   storage quota is actually available. */
function compressImage(file, maxDimension = 1000, quality = 0.72){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if(width > maxDimension || height > maxDimension){
          const scale = maxDimension / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('image decode failed'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function formatDate(isoOrTimestamp){
  const d = typeof isoOrTimestamp === 'number' ? new Date(isoOrTimestamp) : new Date(isoOrTimestamp);
  if(isNaN(d.getTime())) return '';
  return d.toLocaleDateString('ka-GE', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatTime(timestamp){
  const d = new Date(timestamp);
  return d.toLocaleTimeString('ka-GE', { hour: '2-digit', minute: '2-digit' });
}

/* ============================================================
   State
   ============================================================ */
let dog = loadJSON(STORAGE_KEYS.dog, null);
let routineEntries = loadJSON(STORAGE_KEYS.routine, []);
let healthRecords = loadJSON(STORAGE_KEYS.health, []);
let memories = loadJSON(STORAGE_KEYS.memories, []);

/* ============================================================
   DOM references
   ============================================================ */
const onboardingView = document.getElementById('onboarding-view');
const appView = document.getElementById('app-view');
const onboardingForm = document.getElementById('onboarding-form');

const headerAvatarImg = document.getElementById('header-avatar-img');
const headerAvatarFallback = document.getElementById('header-avatar-fallback');
const headerDogName = document.getElementById('header-dog-name');
const headerDogSub = document.getElementById('header-dog-sub');

const profilePhoto = document.getElementById('profile-photo');
const profilePhotoFallback = document.getElementById('profile-photo-fallback');
const statAge = document.getElementById('stat-age');
const statBreed = document.getElementById('stat-breed');
const statGender = document.getElementById('stat-gender');

const routineForm = document.getElementById('routine-form');
const routineNoteInput = document.getElementById('routine-note');
const routineList = document.getElementById('routine-list');
const routineEmpty = document.getElementById('routine-empty');

const healthForm = document.getElementById('health-form');
const healthList = document.getElementById('health-list');
const healthEmpty = document.getElementById('health-empty');

const memoryForm = document.getElementById('memory-form');
const memoriesGrid = document.getElementById('memories-grid');
const memoriesEmpty = document.getElementById('memories-empty');

const exportBtn = document.getElementById('export-btn');
const resetBtn = document.getElementById('reset-btn');
const editProfileForm = document.getElementById('edit-profile-form');

const navButtons = Array.from(document.querySelectorAll('.nav-btn'));
const navIndicator = document.getElementById('nav-indicator');
const tabPanels = {
  dashboard: document.getElementById('tab-dashboard'),
  health: document.getElementById('tab-health'),
  memories: document.getElementById('tab-memories'),
  settings: document.getElementById('tab-settings')
};

/* ============================================================
   View routing: onboarding vs app
   ============================================================ */
function renderRoot(){
  if(dog){
    onboardingView.classList.add('is-hidden');
    appView.classList.remove('is-hidden');
    renderDogHeader();
    renderDashboard();
    renderHealth();
    renderMemories();
    populateEditForm();
  }else{
    onboardingView.classList.remove('is-hidden');
    appView.classList.add('is-hidden');
  }
}

/* ============================================================
   Onboarding
   ============================================================ */
onboardingForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const name = document.getElementById('dog-name').value.trim();
  const age = document.getElementById('dog-age').value.trim();
  const breed = document.getElementById('dog-breed').value.trim();
  const gender = document.getElementById('dog-gender').value;
  const photoInput = document.getElementById('dog-photo-input');

  if(!name || !age || !breed || !gender){
    return;
  }

  let photoDataUrl = '';
  if(photoInput.files && photoInput.files[0]){
    try{
      photoDataUrl = await compressImage(photoInput.files[0]);
    }catch(err){
      console.error('PetLog: photo read failed', err);
    }
  }

  dog = {
    name,
    age,
    breed,
    gender,
    photo: photoDataUrl,
    createdAt: Date.now()
  };

  if(saveJSON(STORAGE_KEYS.dog, dog)){
    renderRoot();
  }
});

/* ============================================================
   Header + dashboard rendering
   ============================================================ */
function renderDogHeader(){
  headerDogName.textContent = dog.name;
  headerDogSub.textContent = `${dog.breed} · ${dog.age} წლის`;

  if(dog.photo){
    headerAvatarImg.src = dog.photo;
    headerAvatarImg.classList.remove('is-hidden');
    headerAvatarFallback.classList.add('is-hidden');

    profilePhoto.src = dog.photo;
    profilePhoto.classList.remove('is-hidden');
    profilePhotoFallback.classList.add('is-hidden');
  }else{
    headerAvatarImg.classList.add('is-hidden');
    headerAvatarFallback.classList.remove('is-hidden');

    profilePhoto.classList.add('is-hidden');
    profilePhotoFallback.classList.remove('is-hidden');
  }
}

function renderDashboard(){
  statAge.textContent = `${dog.age} წელი`;
  statBreed.textContent = dog.breed;
  statGender.textContent = GENDER_LABELS[dog.gender] || dog.gender;
  renderRoutineList();
}

function renderRoutineList(){
  routineList.innerHTML = '';
  const sorted = [...routineEntries].sort((a, b) => b.timestamp - a.timestamp);

  if(sorted.length === 0){
    routineEmpty.classList.remove('is-hidden');
  }else{
    routineEmpty.classList.add('is-hidden');
    sorted.forEach(entry => {
      const li = document.createElement('li');

      const icon = document.createElement('span');
      icon.className = 'entry-icon';
      icon.textContent = entry.type === 'feeding' ? '🍖' : '🐾';

      const body = document.createElement('div');
      body.className = 'entry-body';
      const title = document.createElement('p');
      title.className = 'entry-title';
      title.textContent = entry.type === 'feeding' ? 'კვება' : 'გასეირნება';
      const meta = document.createElement('p');
      meta.className = 'entry-meta';
      meta.textContent = [entry.note, formatTime(entry.timestamp)].filter(Boolean).join(' · ');
      body.append(title, meta);

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'entry-delete';
      del.setAttribute('aria-label', 'წაშლა');
      del.textContent = '✕';
      del.addEventListener('click', () => {
        routineEntries = routineEntries.filter(r => r.id !== entry.id);
        saveJSON(STORAGE_KEYS.routine, routineEntries);
        renderRoutineList();
      });

      li.append(icon, body, del);
      routineList.appendChild(li);
    });
  }
}

routineForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const type = routineForm.querySelector('input[name="routine-type"]:checked').value;
  const note = routineNoteInput.value.trim();

  routineEntries.push({ id: uid(), type, note, timestamp: Date.now() });
  if(saveJSON(STORAGE_KEYS.routine, routineEntries)){
    routineNoteInput.value = '';
    renderRoutineList();
  }
});

/* ============================================================
   Health records
   ============================================================ */
function renderHealth(){
  healthList.innerHTML = '';
  const sorted = [...healthRecords].sort((a, b) => new Date(b.date) - new Date(a.date));

  if(sorted.length === 0){
    healthEmpty.classList.remove('is-hidden');
  }else{
    healthEmpty.classList.add('is-hidden');
    sorted.forEach(record => {
      const li = document.createElement('li');

      let iconEl;
      if(record.photo){
        iconEl = document.createElement('img');
        iconEl.className = 'entry-thumb';
        iconEl.src = record.photo;
        iconEl.alt = record.title;
      }else{
        iconEl = document.createElement('span');
        iconEl.className = 'entry-icon icon-health';
        iconEl.textContent = record.type === 'vaccination' ? '💉' : (record.type === 'document' ? '📄' : '🧪');
      }

      const body = document.createElement('div');
      body.className = 'entry-body';
      const title = document.createElement('p');
      title.className = 'entry-title';
      title.textContent = record.title;
      const meta = document.createElement('p');
      meta.className = 'entry-meta';
      meta.textContent = [HEALTH_TYPE_LABELS[record.type], formatDate(record.date), record.note].filter(Boolean).join(' · ');
      body.append(title, meta);

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'entry-delete';
      del.setAttribute('aria-label', 'წაშლა');
      del.textContent = '✕';
      del.addEventListener('click', () => {
        healthRecords = healthRecords.filter(r => r.id !== record.id);
        saveJSON(STORAGE_KEYS.health, healthRecords);
        renderHealth();
      });

      li.append(iconEl, body, del);
      healthList.appendChild(li);
    });
  }
}

healthForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const type = document.getElementById('health-type').value;
  const title = document.getElementById('health-title').value.trim();
  const date = document.getElementById('health-date').value;
  const note = document.getElementById('health-note').value.trim();
  const fileInput = document.getElementById('health-file-input');

  if(!title || !date) return;

  let photoDataUrl = '';
  if(fileInput.files && fileInput.files[0]){
    try{
      photoDataUrl = await compressImage(fileInput.files[0]);
    }catch(err){
      console.error('PetLog: health photo read failed', err);
    }
  }

  healthRecords.push({ id: uid(), type, title, date, note, photo: photoDataUrl });
  if(saveJSON(STORAGE_KEYS.health, healthRecords)){
    healthForm.reset();
    renderHealth();
  }
});

/* ============================================================
   Memories gallery
   ============================================================ */
function renderMemories(){
  memoriesGrid.innerHTML = '';
  const sorted = [...memories].sort((a, b) => b.timestamp - a.timestamp);

  if(sorted.length === 0){
    memoriesEmpty.classList.remove('is-hidden');
  }else{
    memoriesEmpty.classList.add('is-hidden');
    sorted.forEach(mem => {
      const fig = document.createElement('figure');

      const img = document.createElement('img');
      img.src = mem.photo;
      img.alt = mem.caption || 'ძაღლის მოგონება';
      fig.appendChild(img);

      if(mem.caption){
        const cap = document.createElement('figcaption');
        cap.textContent = mem.caption;
        fig.appendChild(cap);
      }

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'memory-delete';
      del.setAttribute('aria-label', 'წაშლა');
      del.textContent = '✕';
      del.addEventListener('click', () => {
        memories = memories.filter(m => m.id !== mem.id);
        saveJSON(STORAGE_KEYS.memories, memories);
        renderMemories();
      });

      fig.appendChild(del);
      memoriesGrid.appendChild(fig);
    });
  }
}

memoryForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const fileInput = document.getElementById('memory-photo-input');
  const caption = document.getElementById('memory-caption').value.trim();

  if(!fileInput.files || !fileInput.files[0]) return;

  try{
    const photoDataUrl = await compressImage(fileInput.files[0]);
    memories.push({ id: uid(), photo: photoDataUrl, caption, timestamp: Date.now() });
    if(saveJSON(STORAGE_KEYS.memories, memories)){
      memoryForm.reset();
      renderMemories();
    }
  }catch(err){
    console.error('PetLog: memory photo read failed', err);
  }
});

/* ============================================================
   Settings — profile edit / export / reset
   ============================================================ */
function populateEditForm(){
  document.getElementById('edit-dog-name').value = dog.name;
  document.getElementById('edit-dog-age').value = dog.age;
  document.getElementById('edit-dog-breed').value = dog.breed;
  document.getElementById('edit-dog-gender').value = dog.gender;
}

editProfileForm.addEventListener('submit', (e) => {
  e.preventDefault();
  dog.name = document.getElementById('edit-dog-name').value.trim();
  dog.age = document.getElementById('edit-dog-age').value.trim();
  dog.breed = document.getElementById('edit-dog-breed').value.trim();
  dog.gender = document.getElementById('edit-dog-gender').value;

  if(saveJSON(STORAGE_KEYS.dog, dog)){
    renderDogHeader();
    renderDashboard();
  }
});

exportBtn.addEventListener('click', () => {
  const backup = {
    exportedAt: new Date().toISOString(),
    dog,
    routineEntries,
    healthRecords,
    memories
  };

  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safeName = (dog?.name || 'petlog').replace(/[^a-zA-Z0-9а-ჿ_-]/g, '_');
  a.href = url;
  a.download = `petlog-backup-${safeName}-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

resetBtn.addEventListener('click', () => {
  const confirmed = confirm('დარწმუნებული ხართ? ეს წაშლის ყველა ჩანაწერს, ფოტოსა და პროფილს სამუდამოდ.');
  if(!confirmed) return;

  Object.values(STORAGE_KEYS).forEach(key => safeRemoveItem(key));
  dog = null;
  routineEntries = [];
  healthRecords = [];
  memories = [];
  onboardingForm.reset();
  renderRoot();
});

/* ============================================================
   Bottom navigation
   ============================================================ */
function activateTab(tabName){
  Object.entries(tabPanels).forEach(([name, panel]) => {
    panel.classList.toggle('is-hidden', name !== tabName);
  });

  const index = navButtons.findIndex(btn => btn.dataset.tab === tabName);
  navButtons.forEach((btn, i) => btn.classList.toggle('is-active', i === index));

  if(index >= 0){
    navIndicator.style.transform = `translateX(${index * 100}%)`;
  }
}

navButtons.forEach(btn => {
  btn.addEventListener('click', () => activateTab(btn.dataset.tab));
});

/* ============================================================
   Service worker registration (offline support)
   ============================================================ */
if('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => {
      console.error('PetLog: service worker registration failed', err);
    });
  });
}

/* ============================================================
   Init
   ============================================================ */
document.getElementById('health-date').valueAsDate = new Date();
renderRoot();
activateTab('dashboard');