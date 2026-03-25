import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://dxqswppjpkzahapkciyg.supabase.co";
const SUPABASE_ANON = "sb_publishable_JqM8sCYJ4IoEBDs8XXqnbQ_4h0Lj6mq";
/*
  NOTE: The user provided multiple keys/URLs. This client uses the second connection string + publishable key
  for browser operations. Server/secret keys should never be used in browser code. Keep any secret key server-side.
*/

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {persistSession: false}
});

/*
  Table schema expected (see schema.sql file included):
  Table name: posts
  columns: id (uuid PK), image_url text, caption text, created_at timestamp with time zone default now()
  A storage bucket named "clothes" is used for file storage; table stores the object path (filename) in image_url
*/

/* DOM */
const splash = document.getElementById('splash');
const app = document.getElementById('app');
const uploadScreen = document.getElementById('uploadScreen');

const feed = document.getElementById('feed');
const topBar = document.getElementById('topBar');

const fileInput = document.getElementById('fileInput');
const uploadBox = document.getElementById('uploadBox');
const uploadPreview = document.getElementById('uploadPreview');
const captionInput = document.getElementById('captionInput');
const confirmBtn = document.getElementById('confirmBtn');
const uploadStatus = document.getElementById('uploadStatus');

/* --- Splash sequence --- */
setTimeout(() => {
  splash.classList.add('hidden');
  app.classList.remove('hidden');
  initialize();
}, 2000);

/* --- Load existing images from DB/storage and render --- */
async function initialize(){
  await loadAndRender();
  setupTopBarLongPress();
  setupUploadFlow();
}

/* Query images table and render cards */
async function loadAndRender(){
  feed.innerHTML = '';
  // load list from posts table ordered newest first
  const { data, error } = await supabase
    .from('posts')
    .select('id, image_url, caption, created_at')
    .order('created_at', { ascending: false });

  if (error){
    console.error(error);
    feed.innerHTML = `<div style="color:#900;padding:10px">Failed to load items</div>`;
    return;
  }

  // For each record, construct card. image_url is storage object path; build public URL.
  for (const rec of data){
    const url = await publicUrlFor(rec.image_url);
    const card = makeCard(url, rec.caption);
    feed.appendChild(card);
  }
}

/* Get public URL for a stored file path (assumes bucket 'clothes') */
async function publicUrlFor(path){
  if (!path) return '';
  // using storage.from().getPublicUrl
  const { data } = supabase.storage.from('clothes').getPublicUrl(path);
  return data.publicUrl;
}

/* Create card element */
function makeCard(imgUrl, caption){
  const card = document.createElement('div');
  card.className = 'card';

  const wrap = document.createElement('div');
  wrap.className = 'img-wrap';

  if (imgUrl){
    const img = document.createElement('img');
    img.src = imgUrl;
    img.alt = caption || 'image';
    // ensure object-fit covers and never flows into caption
    wrap.appendChild(img);
  } else {
    wrap.textContent = 'No image';
  }

  const cap = document.createElement('div');
  cap.className = 'caption';
  cap.textContent = caption || '';

  card.appendChild(wrap);
  card.appendChild(cap);
  return card;
}

/* --- Long-press detection on top bar (press & hold 3s) --- */
function setupTopBarLongPress(){
  let timer = null;
  const holdDuration = 3000;
  const start = (e) => {
    e.preventDefault();
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      openUploadScreen();
    }, holdDuration);
  };
  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  // support touch and mouse
  topBar.addEventListener('pointerdown', start);
  topBar.addEventListener('pointerup', cancel);
  topBar.addEventListener('pointerleave', cancel);
  topBar.addEventListener('pointercancel', cancel);
}

/* --- Upload UI flow --- */
function setupUploadFlow(){
  // open file dialog when clicking uploadBox
  uploadBox.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', onFileSelected);

  captionInput.addEventListener('input', () => {
    if (captionInput.value.trim().length) {
      confirmBtn.classList.remove('hidden');
    } else {
      confirmBtn.classList.add('hidden');
    }
  });

  confirmBtn.addEventListener('click', onConfirmUpload);
}

function openUploadScreen(){
  app.classList.add('hidden');
  uploadScreen.classList.remove('hidden');
  // reset UI
  uploadPreview.textContent = 'Click to choose';
  uploadPreview.style.backgroundImage = '';
  captionInput.value = '';
  confirmBtn.classList.add('hidden');
  uploadStatus.textContent = '';
  fileInput.value = '';
}

function closeUploadScreen(){
  uploadScreen.classList.add('hidden');
  app.classList.remove('hidden');
}

/* when file chosen, preview it immediately */
function onFileSelected(e){
  const f = e.target.files?.[0];
  if (!f) return;
  const url = URL.createObjectURL(f);
  uploadPreview.style.backgroundImage = `url('${url}')`;
  uploadPreview.style.backgroundSize = 'cover';
  uploadPreview.textContent = '';
  // store chosen file on element for later upload
  uploadBox._file = f;
}

/* Confirm button -> upload to storage and insert DB row */
async function onConfirmUpload(){
  const file = uploadBox._file;
  const caption = captionInput.value.trim();
  if (!file) { uploadStatus.textContent = 'Please choose an image'; return; }
  if (!caption) { uploadStatus.textContent = 'Please add a caption'; return; }

  uploadStatus.textContent = 'Uploading...';
  confirmBtn.disabled = true;

  try {
    // generate safe filename with timestamp + random
    const ext = file.name.split('.').pop();
    const fname = `${Date.now()}_${Math.random().toString(36).slice(2,9)}.${ext}`;

    // upload to storage bucket 'clothes'
    const { data: uploadData, error: uploadErr } = await supabase.storage
      .from('clothes')
      .upload(fname, file, { cacheControl: '3600', upsert: false });

    if (uploadErr) throw uploadErr;

    // Insert record into posts table with image_url = fname
    const { data: insertData, error: insertErr } = await supabase
      .from('posts')
      .insert([{ image_url: fname, caption }]);

    if (insertErr) throw insertErr;

    uploadStatus.textContent = 'Saved';
    // refresh feed to show newly uploaded image
    await loadAndRender();
    // close upload view after brief delay
    setTimeout(closeUploadScreen, 700);

  } catch (err){
    console.error(err);
    uploadStatus.textContent = 'Upload failed';
  } finally {
    confirmBtn.disabled = false;
  }
}