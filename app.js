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

/* --- User-like persistence setup --- */
// we'll persist per-user liked post ids in localStorage keyed by user id (if available).
let currentUser = null;
let userLikes = new Set();

const USER_LIKES_KEY_PREFIX = 'dc_user_likes_';
async function loadUserContextAndLikes(){
  // try to use websim if available to identify the current user; fall back to null id
  try {
    if (window.websim && typeof window.websim.getCurrentUser === 'function') {
      currentUser = await window.websim.getCurrentUser();
    }
  } catch (e) {
    // ignore
  }
  const uid = currentUser?.id || 'anon';
  try {
    const raw = localStorage.getItem(USER_LIKES_KEY_PREFIX + uid) || '[]';
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      userLikes = new Set(arr);
    } else {
      userLikes = new Set();
    }
  } catch (e) {
    userLikes = new Set();
  }
}
function persistUserLikes(){
  const uid = currentUser?.id || 'anon';
  try {
    localStorage.setItem(USER_LIKES_KEY_PREFIX + uid, JSON.stringify(Array.from(userLikes)));
  } catch (e) {
    // ignore
  }
}

/* --- Splash sequence --- */
setTimeout(() => {
  splash.classList.add('hidden');
  app.classList.remove('hidden');
  initialize();
}, 2000);

/* --- Load existing images from DB/storage and render --- */
async function initialize(){
  await loadUserContextAndLikes();
  await loadAndRender();
  // If the user previously unlocked admin on this device, open admin immediately
  await checkAdminPersistence();
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

  // If the current user already liked this post (from persisted set), render as liked and non-clickable
  if (meta.postId && userLikes.has(meta.postId)) {
    likeBtn.classList.add('liked');
    likeBtn.innerHTML = '✓ Liked';
    likeBtn.setAttribute('aria-pressed', 'true');
    likeBtn.disabled = true;
    likeBtn.style.pointerEvents = 'none';
  }

  // clicking like will insert a like row for the post and refresh the displayed count
  likeBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!meta.postId) {
      console.warn('No post id for like action');
      return;
    }
    // if user already liked (race), ignore
    if (userLikes.has(meta.postId)) {
      // ensure UI matches
      likeBtn.classList.add('liked');
      likeBtn.innerHTML = '✓ Liked';
      likeBtn.disabled = true;
      likeBtn.style.pointerEvents = 'none';
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

      // persist user's like so it remains after refresh for this user
      userLikes.add(meta.postId);
      persistUserLikes();

      // make the button permanently non-clickable for this user
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

  // Grab row: a 9:1 rectangular action box under the like row
  const grabRow = document.createElement('div');
  grabRow.className = 'grab-row';

  const grabBtn = document.createElement('button');
  grabBtn.className = 'grab-btn';
  grabBtn.type = 'button';
  grabBtn.textContent = 'Grab This';
  grabBtn.title = 'Grab This';

  // clicking Grab This will open the Portal screen for messaging
  grabBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const imageEl = wrap.querySelector('img');
    const img = imageEl && imageEl.src ? imageEl.src : '';
    // record a contact entry for admin (best-effort): use currentUser.id or anon
    const uid = currentUser?.id || `anon_${(Math.random().toString(36).slice(2,6))}`;
    savePortalContact(uid);
    // open portal, indicate it was opened via Grab This
    openPortalScreen({ image: img, caption: caption || '', fromGrab: true, contactId: uid });
  });

  grabRow.appendChild(grabBtn);
  card.appendChild(grabRow);

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
function openFullView(url, caption, opts = {}) {
  // opts: { adminReturnUid: string|null } - if present, a left-swipe should return to admin conversation
  fullImg.src = url;
  fullCaption.textContent = caption || '';
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
      addToCart({ image: url, caption: caption || '' });
      showFullViewToast('Added to buy list successfully');
    };
  }

  // If opened with adminReturnUid, enable swipe-left to return to that admin conversation
  let startX = null;
  function pointerDown(e){
    startX = e.clientX;
    window.addEventListener('pointermove', pointerMove);
    window.addEventListener('pointerup', pointerUp, { once: true });
  }
  function pointerMove(e){
    // nothing needed during move for now
  }
  function pointerUp(e){
    const endX = e.clientX;
    const dx = (startX == null) ? 0 : (endX - startX);
    // left swipe threshold
    if (opts.adminReturnUid && dx < -60) {
      // close full view then open admin conversation for uid
      closeFullView();
      // slight delay to let UI settle
      setTimeout(() => {
        try { openAdminConversation(opts.adminReturnUid); } catch(err){ console.warn(err); }
      }, 120);
    }
    startX = null;
    window.removeEventListener('pointermove', pointerMove);
  }
  // Attach pointerdown to fullView so any left swipe anywhere triggers return
  fullView.addEventListener('pointerdown', pointerDown, { once: true });
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

/* --- Portal + Filo screen behavior --- */

/* Portal elements */
const portalScreen = document.getElementById('portalScreen');
const portalBack = document.getElementById('portalBack');
const portalInput = document.getElementById('portalInput');
const portalSend = document.getElementById('portalSend');
const portalMessages = document.getElementById('portalMessages');

/* Open Portal screen (called from Grab This) */
function openPortalScreen(preload = {}) {
  // hide main app and other screens
  bottomBar.style.display = 'none';
  app.classList.add('hidden');
  searchScreen.classList.add('hidden');
  cartScreen.classList.add('hidden');
  uploadScreen.classList.add('hidden');
  filoScreen.classList.add('hidden');

  // show portal and reset input
  portalMessages.innerHTML = '';
  portalInput.value = '';
  // If opened via Grab This, change placeholder to "Say Something"
  portalInput.placeholder = preload.fromGrab ? 'Say Something' : 'Type to send to Portal';
  portalSend.hidden = true;
  portalScreen.classList.remove('hidden');
  if (floatingCircle) floatingCircle.style.display = 'none';
  portalInput.focus();

  // If opened via Grab This and an image is provided, show a 4:4 image box (no caption) positioned in the portal area.
  if (preload.image) {
    // create a 4:4 box that only shows the image; clicking opens full view with caption for admin viewing
    const box = document.createElement('div');
    box.className = 'portal-image-box';
    box.style.width = '36vw';
    box.style.maxWidth = '260px';
    box.style.aspectRatio = '4/4';
    box.style.position = 'absolute';
    box.style.right = '18px';
    box.style.top = '10px';
    box.style.borderRadius = '10px';
    box.style.overflow = 'hidden';
    box.style.boxShadow = '0 6px 18px rgba(0,0,0,0.06)';
    box.style.background = '#fafafa';
    const im = document.createElement('img');
    im.src = preload.image;
    im.alt = preload.caption || 'image';
    im.style.width = '100%';
    im.style.height = '100%';
    im.style.objectFit = 'cover';
    im.style.display = 'block';
    box.appendChild(im);

    // clicking the image opens full view; if this portal was opened from a Grab This contactId, store adminReturnUid
    box.addEventListener('click', () => {
      // open full view with caption visible and enable swipe-left returning to this contact
      const adminUid = preload.contactId || null;
      openFullView(preload.image, preload.caption || '', { adminReturnUid: adminUid });
    });

    portalMessages.appendChild(box);
    // adjust stacking of any other portal messages
    const msgs = Array.from(portalMessages.querySelectorAll('.portal-msg'));
    msgs.forEach((m, i) => {
      m.style.top = `${10 + (i * 56) + 18}px`;
    });
  } else if (preload.caption) {
    showPortalMessage(preload.caption);
  }

  // if opened for a specific contact, load that contact's conversation into the portal area
  if (preload.contactId) {
    // ensure chat button is visible for this user going forward
    showChatButton();

    // load stored messages for this uid and display them (most recent first)
    try {
      const convKey = `dc_portal_conv_${preload.contactId}`;
      const msgs = JSON.parse(localStorage.getItem(convKey) || '[]') || [];
      // display messages newest-to-oldest but stack visually top-down
      // We'll show last 20 messages (reverse to show earliest first)
      msgs.slice(0, 50).reverse().forEach(m => {
        const text = m.text || '';
        showPortalMessage(text);
      });
      // persist last contact for portal send reference
      const lastContacts = JSON.parse(localStorage.getItem(PORTAL_CONTACTS_KEY) || '[]');
      // make sure the contact is first in list
      const filtered = lastContacts.filter(c => c.uid !== preload.contactId);
      filtered.unshift({ uid: preload.contactId, at: Date.now() });
      localStorage.setItem(PORTAL_CONTACTS_KEY, JSON.stringify(filtered.slice(0,100)));
      // save quick pointer for portalSend to use
      localStorage.setItem('dc_portal_last_contact', preload.contactId);
    } catch (e){}
  } else {
    // not opened from Grab This - show recent portal messages from local list (global)
    const global = loadPortalMessages();
    global.slice(0,50).reverse().forEach(m => showPortalMessage(m.text || m));
  }
}

/* Close portal */
function closePortalScreen(){
  portalScreen.classList.add('hidden');
  bottomBar.style.display = '';
  if (floatingCircle) floatingCircle.style.display = '';
  // restore main app view
  app.classList.remove('hidden');
}

/* show/hide send icon while typing */
if (typeof portalInput !== 'undefined' && portalInput) {
  portalInput.addEventListener('input', (e) => {
    const val = e.target.value.trim();
    if (val.length) portalSend.hidden = false;
    else portalSend.hidden = true;
  });
}

/* persist small list locally and try to send to the DB (best-effort) */
const PORTAL_KEY = 'dc_portal_msgs_v1';
function loadPortalMessages(){
  try {
    const arr = JSON.parse(localStorage.getItem(PORTAL_KEY) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}
function persistPortalMessage(text){
  try {
    const arr = loadPortalMessages();
    arr.unshift({ text, at: Date.now() });
    localStorage.setItem(PORTAL_KEY, JSON.stringify(arr.slice(0,30)));
  } catch (e){}
}

/* show/hide the chat button and persist state so it remains after refresh */
function showChatButton(){
  try {
    if (!chatBtn) return;
    chatBtn.classList.remove('hidden');
    localStorage.setItem('dc_has_chat_v1', '1');
  } catch (e){}
}
function hideChatButton(){
  try {
    if (!chatBtn) return;
    chatBtn.classList.add('hidden');
    localStorage.removeItem('dc_has_chat_v1');
  } catch (e){}
}

/* append a portal message element (anchored top-right under top bar) */
function showPortalMessage(text){
  const node = document.createElement('div');
  node.className = 'portal-msg';
  node.textContent = text;
  portalMessages.appendChild(node);
  // ensure it's shown with animation
  setTimeout(() => node.classList.add('show'), 10);
  // keep messages stack offset downwards for each new message
  const msgs = Array.from(portalMessages.querySelectorAll('.portal-msg'));
  msgs.forEach((m, i) => {
    m.style.top = `${10 + i * 56}px`;
  });
}

/* send handler: insert user->portal message into messages table (receiver=portal_21051), persist locally and show */
if (typeof portalSend !== 'undefined' && portalSend) portalSend.addEventListener('click', async () => {
  const text = portalInput.value.trim();
  if (!text) return;
  // display immediately
  showPortalMessage(text);
  persistPortalMessage(text);

  // determine sender id to use
  const senderId = (currentUser && currentUser.id) ? currentUser.id : (`webanon_${Math.random().toString(36).slice(2,8)}`);
  const receiverId = 'portal_21051';

  // persist conversation locally for quick admin preview
  try {
    const explicit = localStorage.getItem('dc_portal_last_contact');
    let contactId = explicit;
    if (!contactId) {
      const lastContacts = JSON.parse(localStorage.getItem(PORTAL_CONTACTS_KEY) || '[]');
      contactId = lastContacts && lastContacts[0] && lastContacts[0].uid ? lastContacts[0].uid : senderId;
    }
    if (contactId) {
      const convKey = `dc_portal_conv_${contactId}`;
      const existing = JSON.parse(localStorage.getItem(convKey) || '[]');
      existing.unshift({ from: 'user', text, at: Date.now() });
      localStorage.setItem(convKey, JSON.stringify(existing.slice(0,500)));
      // ensure chat button persisted
      showChatButton();
      // also ensure contact is saved locally quickly
      savePortalContact(contactId);
    }
  } catch (e){}

  portalInput.value = '';
  portalSend.hidden = true;

  // insert into messages table (preferable)
  try {
    await supabase.from('messages').insert([{ sender_id: senderId, receiver_id: receiverId, message: text }]);
  } catch (err) {
    // ignore DB errors but leave local copy
    console.warn('Failed to insert portal message into DB:', err);
  }
});

/* Back button */
if (typeof portalBack !== 'undefined' && portalBack) portalBack.addEventListener('click', closePortalScreen);

/* original Filo handlers (floatingCircle opens filo) */
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

  // If the exact admin trigger is sent, persist admin flag and open admin portal
  if (text === 'entryportal21051') {
    try {
      localStorage.setItem('dc_is_admin_v1', '1');
    } catch (e){}
    // show a small confirmation in chat and then open admin
    appendChatBubble('Admin portal unlocked.', 'agent');
    filoInput.value = '';
    filoSend.hidden = true;
    setTimeout(() => {
      openAdminPortal();
    }, 200);
    return;
  }

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
const chatBtn = document.getElementById('chatBtn'); // newly added chat button
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

  // Chat button opens Portal (if visible)
  if (chatBtn) {
    chatBtn.addEventListener('click', () => {
      // open portal without a specific preload contact (user sees conversation list)
      openPortalScreen({});
    });
  }

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

/* small helper: show a brief toast anchored to a card element */
function showCardToast(cardEl, message, duration = 1200){
  const t = document.createElement('div');
  t.textContent = message;
  t.style.position = 'absolute';
  t.style.left = '50%';
  t.style.transform = 'translateX(-50%)';
  t.style.bottom = '8px';
  t.style.background = 'rgba(0,0,0,0.78)';
  t.style.color = '#fff';
  t.style.padding = '6px 10px';
  t.style.borderRadius = '8px';
  t.style.zIndex = '10005';
  t.style.fontSize = '13px';
  t.style.pointerEvents = 'none';
  // ensure card is positioned relative for absolute toast placement
  cardEl.style.position = cardEl.style.position || 'relative';
  cardEl.appendChild(t);
  setTimeout(() => {
    t.style.transition = 'opacity 180ms';
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 200);
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

/* --- Gesture admin unlock: detect roughly three 'w' shapes drawn anywhere (pointer path sampling) --- */
function setupGestureAdmin(){
  let drawing = false;
  let points = [];
  const minPoints = 12;
  const reset = () => { drawing = false; points = []; };

  const pointerDown = (e) => {
    drawing = true;
    points = [{x:e.clientX, y:e.clientY}];
    window.addEventListener('pointermove', pointerMove);
    window.addEventListener('pointerup', pointerUp, { once: true });
  };
  const pointerMove = (e) => {
    if (!drawing) return;
    points.push({x:e.clientX, y:e.clientY});
    // keep sample limited
    if (points.length > 200) points.shift();
  };
  const pointerUp = (e) => {
    if (!drawing) return;
    points.push({x:e.clientX, y:e.clientY});
    // analyze gesture
    if (points.length >= minPoints && isThreeW(points)) {
      openAdminPortal();
    }
    reset();
    window.removeEventListener('pointermove', pointerMove);
  };

  // attach on body so any area can be drawn on
  document.body.addEventListener('pointerdown', pointerDown);
}

/* rudimentary recognizer: look for three 'V' peaks in sequence horizontally.
   Strategy: sample points, collapse to x-sorted sequence, compute local direction changes in y.
   Count number of down->up (valley) patterns across x progression; require >=3. */
function isThreeW(pts){
  try {
    // normalize: reduce to 60 samples along progression
    const samples = [];
    const step = Math.max(1, Math.floor(pts.length / 60));
    for (let i=0;i<pts.length;i+=step) samples.push(pts[i]);
    // compute slope sign between consecutive samples
    const signs = [];
    for (let i=1;i<samples.length;i++){
      const dy = samples[i].y - samples[i-1].y;
      const dx = samples[i].x - samples[i-1].x;
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) continue;
      const s = dy / Math.abs(dy || 1);
      signs.push(s > 0 ? 1 : -1);
    }
    if (signs.length < 6) return false;
    // count valley patterns: -1 then +1 (down then up)
    let valleys = 0;
    for (let i=1;i<signs.length;i++){
      if (signs[i-1] === -1 && signs[i] === 1) valleys++;
    }
    return valleys >= 3;
  } catch (e){
    return false;
  }
}

/* Open admin portal UI */
function openAdminPortal(){
  // reveal admin screen
  const admin = document.getElementById('adminScreen');
  if (!admin) return;
  // hide other screens
  app.classList.add('hidden');
  bottomBar.style.display = 'none';
  searchScreen.classList.add('hidden');
  cartScreen.classList.add('hidden');
  uploadScreen.classList.add('hidden');
  filoScreen.classList.add('hidden');
  portalScreen.classList.add('hidden');

  admin.classList.remove('hidden');
  if (floatingCircle) floatingCircle.style.display = 'none';

  // wire up admin controls once
  if (!openAdminPortal._wired) {
    document.getElementById('adminClose').addEventListener('click', () => {
      document.getElementById('adminScreen').classList.add('hidden');
      bottomBar.style.display = '';
      if (floatingCircle) floatingCircle.style.display = '';
      app.classList.remove('hidden');
    });
    document.getElementById('adminUploadTab').addEventListener('click', () => {
      document.getElementById('adminUploadView').classList.remove('hidden');
      document.getElementById('adminMessagesView').classList.add('hidden');
      // open actual upload screen for admin to use
      openUploadScreen();
    });
    document.getElementById('adminMessagesTab').addEventListener('click', () => {
      document.getElementById('adminUploadView').classList.add('hidden');
      document.getElementById('adminMessagesView').classList.remove('hidden');
      renderAdminContacts();
    });
    openAdminPortal._wired = true;
  }
}

/* Save contact (when user clicks Grab This) to localStorage for admin to review.
   Also attempt to register a lightweight "starter" message row in messages for portal inbox discoverability.
   Stored shape locally is kept for fast display fallback. */
const PORTAL_CONTACTS_KEY = 'dc_portal_contacts_v1';
async function savePortalContact(uid, image = null, caption = null){
  try {
    const arr = JSON.parse(localStorage.getItem(PORTAL_CONTACTS_KEY) || '[]');
    const now = Date.now();
    // remove existing with same uid
    const filtered = arr.filter(c => c.uid !== uid);
    const entry = { uid, at: now };
    if (image) entry.image = image;
    if (caption) entry.caption = caption;
    filtered.unshift(entry);
    localStorage.setItem(PORTAL_CONTACTS_KEY, JSON.stringify(filtered.slice(0,100)));
    // ensure chat button is visible and last contact pointer stored
    showChatButton();
    localStorage.setItem('dc_portal_last_contact', uid);

    // best-effort: insert a minimal message row into the messages table so admin sees this user in portal_inbox view
    try {
      const sender = uid;
      const receiver = 'portal_21051';
      const messageText = caption || 'Opened portal via Grab This';
      await supabase.from('messages').insert([{ sender_id: sender, receiver_id: receiver, message: messageText }]);
    } catch (err) {
      // ignore DB errors (table/view may not exist)
      console.warn('Failed to create portal message row:', err);
    }
  } catch (e){}
}

/* Render admin contact boxes using the portal_inbox view from the DB when available,
   falling back to localStorage if the query fails. */
async function renderAdminContacts(){
  const cont = document.getElementById('adminContacts');
  cont.innerHTML = '';
  try {
    const { data, error } = await supabase.from('portal_inbox').select('sender_id, last_message_time, preview_word');
    if (error || !Array.isArray(data)) throw error || new Error('No data');
    if (data.length === 0) {
      cont.innerHTML = `<div style="color:var(--muted);padding:12px">No messages yet.</div>`;
      return;
    }
    data.forEach(c => {
      const node = document.createElement('div');
      node.className = 'admin-contact';
      const idEl = document.createElement('div');
      idEl.className = 'cid';
      idEl.textContent = c.sender_id;
      const tEl = document.createElement('div');
      tEl.className = 'ctime';
      tEl.textContent = new Date(c.last_message_time).toLocaleString();
      const preview = document.createElement('div');
      preview.className = 'ctime';
      preview.style.fontSize = '13px';
      preview.style.color = 'var(--muted)';
      preview.textContent = c.preview_word ? `Preview: ${c.preview_word}` : '';
      node.appendChild(idEl);
      node.appendChild(tEl);
      node.appendChild(preview);
      node.addEventListener('click', () => {
        openAdminConversation(c.sender_id);
      });
      cont.appendChild(node);
    });
    return;
  } catch (err) {
    // fallback to localStorage contacts if DB fails
    const arr = JSON.parse(localStorage.getItem(PORTAL_CONTACTS_KEY) || '[]');
    if (!arr.length){
      cont.innerHTML = `<div style="color:var(--muted);padding:12px">No messages yet.</div>`;
      return;
    }
    arr.forEach(c => {
      const node = document.createElement('div');
      node.className = 'admin-contact';
      const idEl = document.createElement('div');
      idEl.className = 'cid';
      idEl.textContent = c.uid;
      const tEl = document.createElement('div');
      tEl.className = 'ctime';
      tEl.textContent = new Date(c.at).toLocaleString();
      node.appendChild(idEl);
      node.appendChild(tEl);
      node.addEventListener('click', () => {
        openAdminConversation(c.uid);
      });
      cont.appendChild(node);
    });
  }
}

/* Open a full-page admin conversation view for a contact (uses DB chat_messages when available) */
async function openAdminConversation(uid){
  const admin = document.getElementById('adminScreen');
  if (!admin) return;
  admin.innerHTML = ''; // replace admin content with conversation header
  const back = document.createElement('button');
  back.className = 'full-back';
  back.textContent = '⟨';
  back.addEventListener('click', () => {
    // reload the page to restore admin list UI simply
    window.location.reload();
  });
  const top = document.createElement('div');
  top.className = 'admin-topbar top-bar';
  top.innerHTML = `<div style="width:100%;text-align:center;font-weight:700;">Conversation: ${uid}</div>`;
  admin.appendChild(back);
  admin.appendChild(top);

  const convWrap = document.createElement('div');
  convWrap.style.padding = '12px';
  convWrap.style.flex = '1';
  convWrap.style.overflow = 'auto';
  convWrap.id = 'adminConv';
  admin.appendChild(convWrap);

  // input bar
  const bar = document.createElement('div');
  bar.className = 'filo-bottom-bar';
  bar.style.position = 'fixed';
  bar.style.left = '0';
  bar.style.right = '0';
  bar.style.bottom = '0';
  bar.style.zIndex = '10000';
  bar.innerHTML = `<div class="filo-input-wrap"><input id="adminMsgInput" class="filo-input" placeholder="Message ${uid}" /><button id="adminMsgSend" class="filo-send">↗️</button></div>`;
  admin.appendChild(bar);

  // try to load messages from DB (both directions)
  try {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .or(`and(sender_id.eq.${uid},receiver_id.eq.portal_21051),and(sender_id.eq.portal_21051,receiver_id.eq.${uid})`)
      .order('created_at', { ascending: true });

    let msgs = [];
    if (!error && Array.isArray(data)) {
      msgs = data;
    } else {
      throw error || new Error('No data');
    }

    msgs.forEach(m => {
      const p = document.createElement('div');
      // messages coming from the portal (portal_21051) are admin/outgoing -> show as right-aligned black (filo-user)
      // messages from other sender_ids are incoming user messages -> show as left-aligned blue (filo-agent)
      p.className = (m.sender_id === 'portal_21051') ? 'filo-user filo-bubble' : 'filo-agent filo-bubble';
      p.textContent = m.message;
      convWrap.appendChild(p);
    });
  } catch (err) {
    // fallback: load from localStorage conversation
    const convKey = `dc_portal_conv_${uid}`;
    const localMsgs = JSON.parse(localStorage.getItem(convKey) || '[]');
    localMsgs.reverse().forEach(m => {
      const p = document.createElement('div');
      p.className = m.from === 'user' ? 'filo-agent filo-bubble' : 'filo-user filo-bubble';
      p.textContent = m.text;
      convWrap.appendChild(p);
    });
  }

  // send handler: insert message into DB and append to UI and local storage for offline fallback
  document.getElementById('adminMsgSend').addEventListener('click', async () => {
    const inp = document.getElementById('adminMsgInput');
    const txt = inp.value.trim();
    if (!txt) return;
    const sender = 'portal_21051';
    const receiver = uid;
    // optimistic UI
    const p = document.createElement('div');
    p.className = 'filo-user filo-bubble';
    p.textContent = txt;
    convWrap.appendChild(p);
    convWrap.scrollTop = convWrap.scrollHeight;
    inp.value = '';

    // persist locally
    try {
      const convKey = `dc_portal_conv_${uid}`;
      const existing = JSON.parse(localStorage.getItem(convKey) || '[]');
      existing.unshift({ from: 'admin', text: txt, at: Date.now() });
      localStorage.setItem(convKey, JSON.stringify(existing.slice(0,500)));
    } catch (e){}

    // insert into DB
    try {
      await supabase.from('messages').insert([{ sender_id: sender, receiver_id: receiver, message: txt }]);
    } catch (err) {
      console.warn('Failed to send admin message to DB:', err);
    }
  });
}

/* Ensure gesture setup runs */
setupGestureAdmin();

/* restore chat button visibility on load and admin persistence */
async function checkAdminPersistence(){
  try {
    const v = localStorage.getItem('dc_is_admin_v1');
    if (v === '1') {
      // slight delay to let UI initialize before switching screens
      setTimeout(() => {
        openAdminPortal();
      }, 120);
    }
  } catch (e){
    // ignore storage errors
  }

  try {
    const hasChat = localStorage.getItem('dc_has_chat_v1');
    if (hasChat === '1') {
      // reveal chat button if previously granted
      if (chatBtn) chatBtn.classList.remove('hidden');
    }
  } catch (e){}
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