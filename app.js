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
/* DOM */
// floating overlay element showing AI.jpg
const floatingCircle = document.getElementById('floatingCircle');

// Filo AI screen elements
const filoScreen = document.getElementById('filoScreen');
const filoBack = document.getElementById('filoBack');
const filoTitle = document.querySelector('.filo-title');
const filoChat = document.getElementById('filoChat');
const filoBottom = document.getElementById('filoBottom');
const filoInput = document.getElementById('filoInput');
const filoSend = document.getElementById('filoSend');

const feed = document.getElementById('feed');
const topBar = document.getElementById('topBar');

const fileInput = document.getElementById('fileInput');
const uploadBox = document.getElementById('uploadBox');
const uploadPreview = document.getElementById('uploadPreview');
const captionInput = document.getElementById('captionInput');
const confirmBtn = document.getElementById('confirmBtn');
const uploadStatus = document.getElementById('uploadStatus');

/* Full view elements */
const fullView = document.getElementById('fullView');
const fullImg = document.getElementById('fullImg');
const fullCaption = document.getElementById('fullCaption');
const fullBack = document.getElementById('fullBack');
const saveBtn = document.getElementById('saveBtn');
// new cart button inside full view
const fullCartBtn = document.getElementById('fullCartBtn');

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
  setupBottomBar();
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

  // load likes for all posts and build a map: post_id -> count
  // Use a regular select to seed counts; RLS policies must allow reads (as configured).
  const { data: likesAll } = await supabase
    .from('likes')
    .select('post_id');

  const likesCountMap = {};
  if (Array.isArray(likesAll)) {
    for (const l of likesAll) {
      const pid = l.post_id;
      likesCountMap[pid] = (likesCountMap[pid] || 0) + 1;
    }
  }

  // For each record, construct card. image_url is storage object path; build public URL.
  for (const rec of data){
    const url = await publicUrlFor(rec.image_url);
    const count = likesCountMap[rec.id] || 0;
    const card = makeCard(url, rec.caption, { postId: rec.id, likes: count });
    // attach double-click to add to cart
    card.addEventListener('dblclick', () => {
      addToCart({ image: url, caption: rec.caption || '' });
    });
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
function makeCard(imgUrl, caption, meta = {}){
  const card = document.createElement('div');
  card.className = 'card';

  const wrap = document.createElement('div');
  wrap.className = 'img-wrap';

  if (imgUrl){
    const img = document.createElement('img');
    img.src = imgUrl;
    img.alt = caption || 'image';
    wrap.appendChild(img);
  } else {
    wrap.textContent = 'No image';
  }

  const cap = document.createElement('div');
  cap.className = 'caption';
  cap.textContent = caption || '';

  card.appendChild(wrap);
  card.appendChild(cap);

  // like row sits below caption, left aligned
  const likeRow = document.createElement('div');
  likeRow.className = 'like-row';

  const likeCountEl = document.createElement('div');
  likeCountEl.className = 'like-count';
  likeCountEl.textContent = `${meta.likes || 0} users like this dress`;

  const likeBtn = document.createElement('button');
  likeBtn.className = 'like-btn';
  likeBtn.type = 'button';
  likeBtn.title = 'Like';
  likeBtn.innerHTML = '♡ Like';

  // clicking like will insert a like row for the post and refresh the displayed count
  likeBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!meta.postId) {
      console.warn('No post id for like action');
      return;
    }
    // disable to prevent duplicate clicks while request is in flight
    likeBtn.disabled = true;
    let likeRecorded = false;
    try {
      // insert a like row (RLS insert policy must allow this)
      const { error: insertErr } = await supabase.from('likes').insert([{ post_id: meta.postId }]);
      if (insertErr) throw insertErr;

      // Fetch authoritative count for this post from the database
      // Use exact count option to get the total number of rows for post_id
      const { count, error: countErr } = await supabase
        .from('likes')
        .select('*', { count: 'exact' })
        .eq('post_id', meta.postId);

      if (countErr) {
        console.warn('Count query failed, falling back to client estimate', countErr);
        // fallback: increment local displayed count
        meta.likes = (meta.likes || 0) + 1;
        likeCountEl.textContent = `${meta.likes} users like this dress`;
      } else {
        meta.likes = count || 0;
        likeCountEl.textContent = `${meta.likes} users like this dress`;
      }

      // mark visually and rename the button to indicate the like was recorded
      likeBtn.classList.add('liked');
      likeBtn.innerHTML = '✓ Liked';
      likeBtn.setAttribute('aria-pressed', 'true');

      // make the button permanently non-clickable for this session (user already liked)
      likeBtn.disabled = true;
      likeBtn.style.pointerEvents = 'none';
      likeRecorded = true;
    } catch (err) {
      console.error('Failed to like', err);
      // optional: show a minimal failure hint
      likeCountEl.textContent = likeCountEl.textContent || '0 users like this dress';
    } finally {
      // only re-enable the button if the like was NOT successfully recorded
      if (!likeRecorded) {
        likeBtn.disabled = false;
      }
    }
  });

  likeRow.appendChild(likeCountEl);
  likeRow.appendChild(likeBtn);

  card.appendChild(likeRow);

  // open full view when card clicked
  card.addEventListener('click', (e) => {
    // prevent clicks on upload screen elements or if missing url
    if (!imgUrl) return;
    openFullView(imgUrl, caption || '');
  });
  // tooltip hint for double click (accessible)
  card.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') openFullView(imgUrl, caption || '');
  });

  return card;
}

/* Full view controls */
function openFullView(url, caption){
  fullImg.src = url;
  fullCaption.textContent = caption;
  fullView.classList.remove('hidden');
  fullView.setAttribute('aria-hidden', 'false');

  // prevent the page from scrolling while full view is open
  document.body.style.overflow = 'hidden';

  if (floatingCircle) floatingCircle.style.display = 'none';

  // attach handlers
  fullBack.onclick = closeFullView;
  saveBtn.onclick = async () => {
    saveBtn.disabled = true;
    try {
      await downloadWithWatermark(url, 'Downloaded from Don Courage Clothing Rack');
    } catch (err){
      console.error('Save failed', err);
    } finally {
      saveBtn.disabled = false;
    }
  };

  // attach add-to-cart on full view cart button
  if (fullCartBtn) {
    fullCartBtn.onclick = () => {
      // add current image to cart (avoid duplicates)
      addToCart({ image: url, caption: caption || '' });
      // show brief confirmation inside full view using a native alert-like element
      // we'll use a simple in-view temporary toast
      showFullViewToast('Added to buy list successfully');
    };
  }
}

function closeFullView(){
  fullView.classList.add('hidden');
  fullView.setAttribute('aria-hidden', 'true');
  fullImg.src = '';
  fullCaption.textContent = '';
  fullBack.onclick = null;
  saveBtn.onclick = null;
  if (fullCartBtn) fullCartBtn.onclick = null;
  if (floatingCircle) floatingCircle.style.display = '';

  // restore page scrolling when full view is closed
  document.body.style.overflow = '';
}

/* --- Filo screen behavior --- */
if (floatingCircle) {
  floatingCircle.addEventListener('click', () => {
    openFiloScreen();
  });
}

if (typeof filoBack !== 'undefined' && filoBack) filoBack.addEventListener('click', closeFiloScreen);

/* show send icon when typing; send on clicking arrow.
   Also support Filo sending image+caption bubbles that open full view when clicked. */
if (typeof filoInput !== 'undefined' && filoInput) {
  filoInput.addEventListener('input', (e) => {
    const val = e.target.value.trim();
    if (val.length) filoSend.hidden = false;
    else filoSend.hidden = true;
  });
}

/* helper: find an example image from the current feed (first available) */
function pickExampleImage() {
  try {
    const firstImg = document.querySelector('#feed .card img') || document.querySelector('#searchFeed .card img');
    if (firstImg && firstImg.src) return { url: firstImg.src, caption: firstImg.closest('.card')?.querySelector('.caption')?.textContent || '' };
  } catch (e) { /* ignore */ }
  return null;
}

/* append an image bubble from the agent that is clickable to open full view */
function appendImageBubble(imageUrl, caption = '') {
  const node = document.createElement('div');
  node.className = 'filo-bubble filo-agent';
  node.style.padding = '8px';
  node.style.display = 'flex';
  node.style.flexDirection = 'column';
  node.style.gap = '8px';

  const img = document.createElement('img');
  img.src = imageUrl;
  img.alt = caption || 'image';
  img.style.width = '180px';
  img.style.maxWidth = '72%';
  img.style.borderRadius = '8px';
  img.style.objectFit = 'cover';
  img.style.cursor = 'pointer';

  // clicking the image opens the full view on the main 9:9 page
  img.addEventListener('click', () => {
    // ensure main app feed is visible and show full view for this image
    // If the image is external / same-origin, openFullView works with its URL.
    // Make sure other overlays are hidden so full view displays correctly.
    closeFiloScreen();
    setTimeout(() => openFullView(imageUrl, caption), 120);
  });

  node.appendChild(img);
  if (caption) {
    const cap = document.createElement('div');
    cap.textContent = caption;
    cap.style.fontSize = '14px';
    cap.style.color = 'var(--muted)';
    node.appendChild(cap);
  }
  filoChat.appendChild(node);
  filoChat.scrollTop = filoChat.scrollHeight;
}

/* send handler: shows user's bubble and the agent replies; sometimes agent sends an image+caption */
if (typeof filoSend !== 'undefined' && filoSend) filoSend.addEventListener('click', () => {
  const text = filoInput.value.trim();
  if (!text) return;
  // show user's bubble on right
  appendChatBubble(text, 'user');
  filoInput.value = '';
  filoSend.hidden = true;

  setTimeout(async () => {
    const lower = text.toLowerCase();
    // default replies avoid instructing about uploads
    let reply = "Sorry, I don't have an answer for that.";
    if (lower.includes('hello') || lower.includes('hi')) {
      reply = "Hi! Ask me about items or request an example outfit.";
      appendChatBubble(reply, 'agent');
      return;
    }

    // If user asks to "show" or requests an example or says "outfit", send an image if available
    if (lower.includes('show') || lower.includes('outfit') || lower.includes('example') || lower.includes('recommend')) {
      const example = pickExampleImage();
      if (example) {
        appendChatBubble("Here's something you might like:", 'agent');
        appendImageBubble(example.url, example.caption);
        return;
      } else {
        reply = "I don't have any images right now, but ask about items and I'll try to help.";
        appendChatBubble(reply, 'agent');
        return;
      }
    }

    // If it's a question (ends with ?), provide a concise textual answer without upload instructions
    if (text.endsWith('?')) {
      reply = "That's a good question — I can describe items or show examples if you ask for them.";
      appendChatBubble(reply, 'agent');
      return;
    }

    // fallback responses
    reply = "I can show images from the collection or answer short questions about items.";
    appendChatBubble(reply, 'agent');
  }, 600);
});

function openFiloScreen(){
  // hide global bottom bar and other screens
  bottomBar.style.display = 'none';
  app.classList.add('hidden');
  searchScreen.classList.add('hidden');
  cartScreen.classList.add('hidden');
  uploadScreen.classList.add('hidden');

  filoChat.innerHTML = ''; // reset chat
  filoScreen.classList.remove('hidden');
  if (floatingCircle) floatingCircle.style.display = 'none';
  filoInput.focus();
}

function closeFiloScreen(){
  filoScreen.classList.add('hidden');
  bottomBar.style.display = '';
  if (floatingCircle) floatingCircle.style.display = '';
  // restore main app view
  app.classList.remove('hidden');
}

/* helper to append chat bubbles into filoChat */
function appendChatBubble(text, who = 'agent'){
  const node = document.createElement('div');
  node.className = 'filo-bubble ' + (who === 'user' ? 'filo-user' : 'filo-agent');
  node.textContent = text;
  filoChat.appendChild(node);
  // scroll to bottom
  filoChat.scrollTop = filoChat.scrollHeight;
}

/* Download image, draw watermark at bottom-left, and trigger save.
   watermarkText placed near bottom-left with small padding. */
async function downloadWithWatermark(imageUrl, watermarkText){
  // load image
  const img = new Image();
  img.crossOrigin = 'anonymous';
  const loaded = new Promise((res, rej) => {
    img.onload = () => res();
    img.onerror = rej;
  });
  img.src = imageUrl;
  await loaded;

  // create canvas same size as image
  const cw = img.naturalWidth;
  const ch = img.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');

  // draw image
  ctx.drawImage(img, 0, 0, cw, ch);

  // watermark style: small, semi-opaque, left-bottom
  const padding = Math.round(cw * 0.03);
  const fontSize = Math.max(14, Math.round(cw * 0.035));
  ctx.font = `${fontSize}px sans-serif`;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.textBaseline = 'bottom';

  // draw a subtle white stroke to help readability
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  const x = padding;
  const y = ch - padding;
  ctx.strokeText(watermarkText, x, y);
  ctx.fillText(watermarkText, x, y);

  // convert to blob and download
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('Canvas empty'));
      const a = document.createElement('a');
      const url = URL.createObjectURL(blob);
      a.href = url;
      a.download = 'dc-clothes.jpg';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      resolve();
    }, 'image/jpeg', 0.92);
  });
}

/* --- Bottom bar (home/search) and search filtering --- */
const bottomBar = document.getElementById('bottomBar');
const dBtn = document.getElementById('dBtn');
const plusBtn = document.getElementById('plusBtn');
const pBtn = document.getElementById('pBtn');
const searchScreen = document.getElementById('searchScreen');
const searchInput = document.getElementById('searchInput');
const searchFeed = document.getElementById('searchFeed');
const cartScreen = document.getElementById('cartScreen');
const cartFeed = document.getElementById('cartFeed');

/* simple cart persisted in localStorage */
const CART_KEY = 'dc_cart_v1';
let cart = JSON.parse(localStorage.getItem(CART_KEY) || '[]');

function setupBottomBar(){
  // "D" shows main feed
  dBtn.addEventListener('click', () => {
    closeSearchScreen();
    closeCartScreen();
    app.classList.remove('hidden');
  });

  // "+" opens cart screen
  plusBtn.addEventListener('click', () => {
    openCartScreen();
  });

  // "P" currently opens search (reuse P as search shortcut)
  pBtn.addEventListener('click', () => {
    openSearchScreen();
  });

  // typing filters feed
  let typingTimer = null;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(typingTimer);
    const q = e.target.value.trim();
    typingTimer = setTimeout(() => {
      filterAndHighlight(q);
    }, 180);
  });
}

function openSearchScreen(){
  // show search screen and keep bottom bar visible
  closeCartScreen();
  app.classList.add('hidden');
  searchScreen.classList.remove('hidden');
  if (floatingCircle) floatingCircle.style.display = 'none';
  // ensure searchFeed shows same cards (we will render clones)
  populateSearchFeed();
  searchInput.focus();
}

function openCartScreen(){
  // show cart screen and keep bottom bar
  app.classList.add('hidden');
  searchScreen.classList.add('hidden');
  cartScreen.classList.remove('hidden');
  if (floatingCircle) floatingCircle.style.display = 'none';
  renderCartFeed();
}

function closeCartScreen(){
  cartScreen.classList.add('hidden');
  // do not automatically show app; D button controls it
  if (floatingCircle) floatingCircle.style.display = '';
}

function renderCartFeed(){
  cartFeed.innerHTML = '';
  if (!cart.length){
    cartFeed.innerHTML = `<div style="padding:18px;color:var(--muted)">Cart is empty. Double-click an item to add.</div>`;
    return;
  }
  cart.forEach(item => {
    const node = document.createElement('div');
    node.className = 'cart-item';
    const img = document.createElement('img');
    img.src = item.image;
    img.alt = item.caption || 'cart item';
    node.appendChild(img);
    cartFeed.appendChild(node);
  });
}

function closeSearchScreen(){
  searchScreen.classList.add('hidden');
  app.classList.remove('hidden');
  searchInput.value = '';
  filterAndHighlight('');
  // restore original feed rendering
  if (searchFeed) searchFeed.innerHTML = '';
}

function populateSearchFeed(){
  // clone current feed cards into search area so scrolling/filtering is separate
  searchFeed.innerHTML = '';
  // clone feed children (preserve markup)
  Array.from(feed.children).forEach(node => {
    const clone = node.cloneNode(true);
    // ensure click opens full view with same img/caption
    clone.addEventListener('click', () => {
      const img = clone.querySelector('img');
      const cap = clone.querySelector('.caption')?.textContent || '';
      if (img && img.src) openFullView(img.src, cap);
    });
    searchFeed.appendChild(clone);
  });
}

/* filter both main feed and search feed; highlight matched words in caption */
function filterAndHighlight(query){
  const normalize = (s) => (s||'').toLowerCase();
  const q = query.trim().toLowerCase();

  const applyToList = (container) => {
    Array.from(container.children).forEach(card => {
      const capEl = card.querySelector('.caption');
      const text = capEl ? capEl.textContent || '' : '';
      if (!q){
        // show everything and remove highlights
        card.style.display = '';
        if (capEl) capEl.innerHTML = escapeHtml(text);
        return;
      }
      const lower = text.toLowerCase();
      const idx = lower.indexOf(q);
      if (idx === -1){
        card.style.display = 'none';
      } else {
        card.style.display = '';
        // highlight matched substring (temporary)
        const before = escapeHtml(text.slice(0, idx));
        const match = escapeHtml(text.slice(idx, idx + q.length));
        const after = escapeHtml(text.slice(idx + q.length));
        if (capEl) capEl.innerHTML = `${before}<span class="highlight">${match}</span>${after}`;
      }
    });
  };

  applyToList(feed);
  applyToList(searchFeed);
}

/* small helper to escape html */
function escapeHtml(s){
  return (s+'').replace(/[&<>"']/g, function(m){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m]; });
}

/* Cart helpers */
function persistCart(){
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
}
function addToCart(item){
  // avoid duplicates by image URL
  if (!item || !item.image) return;
  if (cart.some(i => i.image === item.image)) return;
  cart.unshift(item);
  persistCart();
  // if currently on cart screen, refresh
  if (!cartScreen.classList.contains('hidden')) renderCartFeed();
}

/* small helper: show temporary toast message inside full view */
function showFullViewToast(message, duration = 1600){
  // create toast element inside fullView
  const t = document.createElement('div');
  t.textContent = message;
  t.style.position = 'absolute';
  t.style.left = '50%';
  t.style.transform = 'translateX(-50%)';
  t.style.bottom = '18px';
  t.style.background = 'rgba(0,0,0,0.78)';
  t.style.color = '#fff';
  t.style.padding = '8px 12px';
  t.style.borderRadius = '8px';
  t.style.zIndex = '10002';
  t.style.fontSize = '14px';
  fullView.appendChild(t);
  setTimeout(() => {
    t.style.transition = 'opacity 220ms';
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 260);
  }, duration);
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
  if (floatingCircle) floatingCircle.style.display = 'none';
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
  if (floatingCircle) floatingCircle.style.display = '';
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