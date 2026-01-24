import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, getDoc, updateDoc, onSnapshot, query, where, addDoc, deleteDoc, getDocs, serverTimestamp, increment, orderBy, limit, arrayRemove, arrayUnion } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-storage.js";
import { EXERCISES } from './data.js';

console.log("⚡ FIT DATA: Iniciando App v20.0 (Admin Polish)...");

const firebaseConfig = {
  apiKey: "AIzaSyDW40Lg6QvBc3zaaA58konqsH3QtDrRmyM",
  authDomain: "fitdatatg.firebaseapp.com",
  projectId: "fitdatatg",
  storageBucket: "fitdatatg.firebasestorage.app",
  messagingSenderId: "1019606805247",
  appId: "1:1019606805247:web:3a3e5c0db061aa62773aca"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// --- ESTADO GLOBAL ---
let audioCtx = null;
let currentUser = null; 
let userData = null; 
let activeWorkout = null; 
let timerInt = null; 
let durationInt = null;
let restEndTime = 0; 
let wakeLock = null;

let chartInstance = null; 
let progressChart = null; 
let fatChartInstance = null; 
let measureChartInstance = null; 
let coachFatChart = null; 
let coachMeasureChart = null; 
let radarChartInstance = null;
let coachChart = null;

let selectedUserCoach = null; 
let selectedUserObj = null; 
let editingRoutineId = null; 
let currentPose = 'front'; 
let coachCurrentPose = 'front'; 
let allRoutinesCache = []; 
let assistantsCache = [];
let currentRoutineSelections = [];

const normalizeText = (text) => {
    if(!text) return "";
    return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
};

window.toggleElement = (id) => {
    const el = document.getElementById(id);
    if(el) el.classList.toggle('hidden');
};

function unlockAudio() {
    if(!audioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContext();
    }
    if(audioCtx.state === 'suspended') { audioCtx.resume(); }
    const buffer = audioCtx.createBuffer(1, 1, 22050);
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
    source.start(0);
}
document.addEventListener('touchstart', unlockAudio, {once:true});
document.addEventListener('click', unlockAudio, {once:true});

function play5Beeps() {
    if(!audioCtx) unlockAudio();
    if(audioCtx) {
        const now = audioCtx.currentTime;
        for(let i=0; i<5; i++) {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'square'; osc.frequency.value = 880; 
            osc.connect(gain); gain.connect(audioCtx.destination);
            const start = now + (i * 0.6); const end = start + 0.15;
            osc.start(start); osc.stop(end);
            gain.gain.setValueAtTime(0.5, start);
            gain.gain.exponentialRampToValueAtTime(0.01, end);
        }
    }
}
window.testSound = () => { play5Beeps(); };

window.enableNotifications = () => {
    if (!("Notification" in window)) {
        alert("Tu dispositivo no soporta notificaciones web.");
        return;
    }
    Notification.requestPermission().then((permission) => {
        if (permission === "granted") {
            alert("✅ Vinculado. El reloj vibrará al acabar.");
            new Notification("Fit Data", { body: "Prueba de conexión exitosa.", icon: "logo.png" });
        } else {
            alert("❌ Permiso denegado. Revisa la configuración.");
        }
    });
};

window.navToCoach = async () => {
    if (userData.role === 'admin' || userData.role === 'assistant') {
        window.switchTab('admin-view');
        await window.loadAdminUsers();
    }
};

function updateNavVisibility(isLoggedIn) {
    const bottomNav = document.getElementById('bottom-nav');
    const header = document.getElementById('main-header');
    if (isLoggedIn) {
        header.classList.remove('hidden');
        if(window.innerWidth < 768 && bottomNav) {
            bottomNav.classList.remove('hidden');
            document.getElementById('main-container').style.paddingBottom = "80px";
        }
    } else {
        header.classList.add('hidden');
        if(bottomNav) bottomNav.classList.add('hidden');
        document.getElementById('main-container').style.paddingBottom = "20px";
    }
}

function checkInstallMode() {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    const banner = document.getElementById('installInstructions');
    if(banner) {
        if (isStandalone) {
            banner.classList.add('hidden');
        } else {
            banner.classList.remove('hidden');
        }
    }
}

let appReady = false;

onAuthStateChanged(auth, async (user) => {
    if(!appReady) {
        setTimeout(() => { 
            const loader = document.getElementById('loading-screen');
            if(loader) loader.style.display = 'none'; 
        }, 2000); 
    }

    if(user) {
        currentUser = user;
        const snap = await getDoc(doc(db,"users",user.uid));
        if(snap.exists()){
            userData = snap.data();
            checkPhotoReminder();
            
            if(userData.role === 'admin' || userData.role === 'assistant') {
                const btn = document.getElementById('btn-coach');
                if(btn) btn.classList.remove('hidden');
            }

            if(userData.role !== 'admin' && userData.role !== 'assistant' && !sessionStorage.getItem('notif_dismissed')) {
                const routinesSnap = await getDocs(query(collection(db, "routines"), where("assignedTo", "array-contains", user.uid)));
                if(!routinesSnap.empty) document.getElementById('notif-badge').style.display = 'block';
            }

            if(userData.approved){
                updateNavVisibility(true);
                loadRoutines();
                const savedW = localStorage.getItem('fit_active_workout');
                if(savedW) {
                    activeWorkout = JSON.parse(savedW);
                    renderWorkout();
                    switchTab('workout-view');
                    startTimerMini();
                } else { switchTab('routines-view'); }
            } else { alert("Cuenta en revisión."); signOut(auth); }
        }
    } else {
        updateNavVisibility(false);
        switchTab('auth-view');
        checkInstallMode();
    }
    appReady = true;
});

function checkPhotoReminder() {
    if(!userData.photoDay) return;
    const now = new Date();
    const day = now.getDay();
    if(day == userData.photoDay) {
        if (Notification.permission === "granted") {
            try { new Notification("📸 FOTO", { body: "Hoy toca foto de progreso.", icon: "logo.png" }); } catch(e){}
        }
        alert("📸 HOY TOCA FOTO DE PROGRESO 📸");
    }
}

window.switchTab = (t) => {
    document.querySelectorAll('.view-container').forEach(e => e.classList.remove('active'));
    document.getElementById(t).classList.add('active');
    document.getElementById('main-container').scrollTop = 0;
    
    const navItems = document.querySelectorAll('.nav-item-top, .nav-item');
    navItems.forEach(n => n.classList.remove('active'));
    
    if (t === 'routines-view') {
        const btnM = document.getElementById('mobile-nav-routines');
        if(btnM) btnM.classList.add('active');
        const btnPC = document.getElementById('pc-btn-routines');
        if(btnPC) btnPC.classList.add('active');
    }
    if (t === 'profile-view') {
        const btnM = document.getElementById('mobile-nav-profile');
        if(btnM) btnM.classList.add('active');
        const btnPC = document.getElementById('pc-btn-profile');
        if(btnPC) btnPC.classList.add('active');
        loadProfile();
    }
    if (t === 'admin-view' || t === 'coach-detail-view') {
        const btn = document.getElementById('btn-coach');
        if(btn) btn.classList.add('active');
    }
};

window.toggleAuth = (m) => { document.getElementById('login-form').classList.toggle('hidden',m!=='login'); document.getElementById('register-form').classList.toggle('hidden',m!=='register'); };
window.logout = () => signOut(auth).then(()=>location.reload());

window.recoverPass = async () => {
    const email = prompt("Introduce tu email:");
    if(email) {
        try { await sendPasswordResetEmail(auth, email); alert("📧 Correo enviado."); } catch(e) { alert("Error: " + e.message); }
    }
};
window.dismissNotif = () => { document.getElementById('notif-badge').style.display = 'none'; switchTab('routines-view'); sessionStorage.setItem('notif_dismissed', 'true'); };

function getExerciseData(name) {
    if(!name) return { img: 'logo.png', mInfo: {main:'General', sec:[]}, type:'c', v:null };
    
    let match = EXERCISES.find(e => e.n === name);
    if (!match) {
        const cleanName = normalizeText(name);
        match = EXERCISES.find(e => normalizeText(e.n) === cleanName);
    }
    if (!match) {
        const cleanName = normalizeText(name);
        match = EXERCISES.find(e => {
            const cleanDbName = normalizeText(e.n);
            return cleanDbName.includes(cleanName) || cleanName.includes(cleanDbName);
        });
    }
    if (!match) {
        const n = normalizeText(name);
        let m = "General", img = "logo.png";
        if(n.includes("press")||n.includes("pecho")||n.includes("aperturas")) { m="Pecho"; img="pecho.png"; }
        else if(n.includes("remo")||n.includes("jalon")||n.includes("espalda")||n.includes("dominadas")) { m="Espalda"; img="espalda.png"; }
        else if(n.includes("sentadilla")||n.includes("prensa")||n.includes("extension")||n.includes("zancada")) { m="Cuádriceps"; img="cuadriceps.png"; }
        else if(n.includes("curl")||n.includes("biceps")) { m="Bíceps"; img="biceps.png"; }
        else if(n.includes("triceps")||n.includes("frances")||n.includes("fondos")) { m="Tríceps"; img="triceps.png"; }
        else if(n.includes("hombro")||n.includes("militar")||n.includes("elevacion")||n.includes("pajaros")) { m="Hombros"; img="hombros.png"; }
        return { img: img, mInfo: getMuscleInfoByGroup(m), type:'c', v:null };
    }
    return { img: match.img, mInfo: getMuscleInfoByGroup(match.m), type: match.t || 'c', v: match.v };
}

function getMuscleInfoByGroup(m) {
    let s = [];
    if(m==="Pecho") s=["Tríceps","Hombros"]; 
    else if(m==="Espalda") s=["Bíceps", "Antebrazo"]; 
    else if(m==="Cuádriceps") s=["Glúteos", "Gemelos"]; 
    else if(m==="Isquios") s=["Glúteos", "Espalda Baja"];
    else if(m==="Hombros") s=["Tríceps", "Trapecio"]; 
    else if(m==="Bíceps") s=["Antebrazo"];
    else if(m==="Tríceps") s=["Hombros", "Pecho"];
    else if(m==="Glúteos") s=["Isquios", "Cuádriceps"];
    return {main:m, sec:s};
}

async function loadRoutines() {
    const l = document.getElementById('routines-list'); l.innerHTML = 'Cargando...';
    onSnapshot(query(collection(db,"routines")), (s)=>{
        l.innerHTML = '';
        s.forEach(d=>{
            const r = d.data();
            if(r.uid===currentUser.uid || userData.role === 'admin' || (r.assignedTo && r.assignedTo.includes(currentUser.uid))){
                const isMine = r.uid===currentUser.uid;
                const div = document.createElement('div');
                div.className = 'card';
                div.innerHTML = `<div style="display:flex; justify-content:space-between;"><h3 style="color:${isMine?'white':'var(--accent-color)'}">${r.name}</h3><div>${isMine ? `<button style="background:none;border:none;margin-right:10px;" onclick="openEditor('${d.id}')">✏️</button><button style="background:none;border:none;" onclick="delRoutine('${d.id}')">🗑️</button>` : '🔒'}</div></div><p style="color:#666; font-size:0.8rem; margin:10px 0;">${r.exercises.length} Ejercicios</p><button class="btn" onclick="startWorkout('${d.id}')">ENTRENAR</button>`;
                l.appendChild(div);
            }
        });
    });
}

window.openEditor = async (id=null) => {
    editingRoutineId = id;
    document.getElementById('editor-name').value = '';
    document.getElementById('editor-title').innerText = id ? "EDITAR RUTINA" : "NUEVA RUTINA";
    currentRoutineSelections = [];
    if(id) {
        const docSnap = await getDoc(doc(db,"routines",id));
        const r = docSnap.data();
        document.getElementById('editor-name').value = r.name;
        currentRoutineSelections = r.exercises || [];
    }
    renderExercises(EXERCISES); 
    renderSelectedSummary();
    switchTab('editor-view');
};

window.filterExercises = (t) => { 
    const cleanSearch = normalizeText(t);
    const filtered = EXERCISES.filter(e => normalizeText(e.n).includes(cleanSearch)); 
    renderExercises(filtered); 
};

function renderExercises(l) {
    const c = document.getElementById('exercise-selector-list'); c.innerHTML = '';
    l.forEach(e => {
        const d = document.createElement('div'); d.className = 'ex-select-item';
        if(currentRoutineSelections.includes(e.n)) d.classList.add('selected');
        d.innerHTML = `<img src="${e.img}" onerror="this.src='logo.png'"><span>${e.n}</span>`;
        d.onclick = () => { if(currentRoutineSelections.includes(e.n)) { currentRoutineSelections = currentRoutineSelections.filter(x => x !== e.n); d.classList.remove('selected'); } else { currentRoutineSelections.push(e.n); d.classList.add('selected'); } renderSelectedSummary(); };
        c.appendChild(d);
    });
}

function renderSelectedSummary() {
    const div = document.getElementById('selected-summary'); div.innerHTML = '';
    currentRoutineSelections.forEach(name => { const pill = document.createElement('div'); pill.className = 'summary-pill'; pill.innerHTML = `<span>${name}</span> <b onclick="removeSelection('${name}')">✕</b>`; div.appendChild(pill); });
}

window.removeSelection = (name) => { currentRoutineSelections = currentRoutineSelections.filter(x => x !== name); renderSelectedSummary(); const searchVal = document.getElementById('ex-search').value; window.filterExercises(searchVal); }

window.saveRoutine = async () => {
    const n = document.getElementById('editor-name').value; const s = currentRoutineSelections;
    if(!n || s.length===0) return alert("❌ Faltan datos");
    const btn = document.getElementById('btn-save-routine'); btn.innerText = "💾 GUARDANDO...";
    try {
        const data = { uid:currentUser.uid, name:n, exercises:s, createdAt:serverTimestamp(), assignedTo: [] };
        if(editingRoutineId) await updateDoc(doc(db,"routines",editingRoutineId), {name:n, exercises:s});
        else await addDoc(collection(db,"routines"), data);
        switchTab('routines-view');
    } catch(e) { alert("Error: " + e.message); } finally { btn.innerText = "GUARDAR"; }
};

window.delRoutine = async (id) => { if(confirm("¿Borrar?")) await deleteDoc(doc(db,"routines",id)); };

window.switchPose = (pose) => { currentPose = pose; document.getElementById('tab-front').classList.toggle('active', pose==='front'); document.getElementById('tab-back').classList.toggle('active', pose==='back'); updatePhotoDisplay(userData); };

function updatePhotoDisplay(u) {
    const prefix = currentPose === 'front' ? '' : '_back';
    const b = u[`photoBefore${prefix}`] || '', a = u[`photoAfter${prefix}`] || '';
    const dateB = u[`dateBefore${prefix}`] || '-', dateA = u[`dateAfter${prefix}`] || '-';
    document.getElementById('img-before').src = b; document.getElementById('img-overlay').src = a;
    document.getElementById('date-before').innerText = `ANTES (${dateB})`; document.getElementById('date-after').innerText = `AHORA (${dateA})`;
    document.getElementById('slider-handle').style.left = '0%'; document.getElementById('img-overlay').style.clipPath = 'inset(0 0 0 0)';
}

window.uploadAvatar = (inp) => { 
    if(inp.files[0]) { 
        const file = inp.files[0];
        const path = `users/${currentUser.uid}/avatar.jpg`;
        const storageRef = ref(storage, path);
        uploadBytes(storageRef, file).then(async (snapshot) => {
            const url = await getDownloadURL(snapshot.ref);
            await updateDoc(doc(db,"users",currentUser.uid), {photo: url}); 
            userData.photo = url; 
            window.loadProfile();
        }).catch(e => alert("Error subiendo foto: " + e.message));
    } 
};

window.loadCompImg = (inp, field) => { 
    if(inp.files[0]) { 
        const file = inp.files[0];
        const r = new FileReader(); 
        r.onload = (e) => { 
            const img = new Image(); 
            img.src = e.target.result; 
            img.onload = async () => { 
                const canvas = document.createElement('canvas'); 
                const ctx = canvas.getContext('2d'); 
                const scale = 800 / img.width; 
                canvas.width = 800; 
                canvas.height = img.height * scale; 
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height); 
                
                canvas.toBlob(async (blob) => {
                    const prefix = currentPose === 'front' ? 'front' : 'back';
                    const timestamp = Date.now();
                    const path = `users/${currentUser.uid}/progress/${timestamp}_${prefix}.jpg`;
                    const storageRef = ref(storage, path);
                    try {
                        await uploadBytes(storageRef, blob);
                        const url = await getDownloadURL(storageRef);
                        const fieldPrefix = currentPose === 'front' ? '' : '_back';
                        const fieldName = field === 'before' ? `photoBefore${fieldPrefix}` : `photoAfter${fieldPrefix}`; 
                        const dateField = field === 'before' ? `dateBefore${fieldPrefix}` : `dateAfter${fieldPrefix}`; 
                        const today = new Date().toLocaleDateString(); 
                        const record = { date: today, url: url };
                        let update = {}; 
                        update[fieldName] = url; update[dateField] = today;
                        const histField = fieldPrefix === '' ? 'photoHistoryFront' : 'photoHistoryBack';
                        update[histField] = arrayUnion(record);
                        await updateDoc(doc(db, "users", currentUser.uid), update); 
                        userData[fieldName] = url; userData[dateField] = today; 
                        if(!userData[histField]) userData[histField] = [];
                        userData[histField].push(record);
                        updatePhotoDisplay(userData);
                    } catch(err) { alert("Error: " + err.message); }
                }, 'image/jpeg', 0.8);
            }; 
        }; 
        r.readAsDataURL(file); 
    } 
};

window.deletePhoto = async (type) => { 
    if(!confirm("¿Borrar?")) return; 
    const prefix = currentPose === 'front' ? '' : '_back'; 
    const f = type === 'before' ? `photoBefore${prefix}` : `photoAfter${prefix}`; 
    let u={}; u[f]=""; 
    await updateDoc(doc(db,"users",currentUser.uid),u); 
    userData[f]=""; 
    updatePhotoDisplay(userData); 
};

window.moveSlider = (v) => { 
    document.getElementById('img-overlay').style.clipPath = `inset(0 0 0 ${v}%)`; 
    document.getElementById('slider-handle').style.left = `${v}%`; 
};

window.switchCoachPose = (pose) => {
    coachCurrentPose = pose;
    const tabFront = document.getElementById('coach-tab-front');
    const tabBack = document.getElementById('coach-tab-back');
    if(tabFront && tabBack) {
        if(pose === 'front') {
            tabFront.classList.add('active');
            tabBack.classList.remove('active');
        } else {
            tabFront.classList.remove('active');
            tabBack.classList.add('active');
        }
        updateCoachPhotoDisplay(pose);
    }
};

function updateCoachPhotoDisplay(pose) {
    const u = selectedUserObj;
    if(!u) return;
    const prefix = pose === 'front' ? '' : '_back';
    const histField = prefix === '' ? 'photoHistoryFront' : 'photoHistoryBack';
    const history = u[histField] || [];

    const pCont = document.getElementById('coach-photos-container');
    pCont.innerHTML = `
        <div style="display:flex; gap:5px; margin-bottom:10px;">
             <select id="c-sel-before" onchange="window.updateCoachSliderImages()" style="margin:0; font-size:0.8rem;"></select>
             <select id="c-sel-after" onchange="window.updateCoachSliderImages()" style="margin:0; font-size:0.8rem;"></select>
        </div>
        <div class="compare-wrapper" style="min-height:250px; background:#000; position:relative;">
            <div class="slider-labels"><span class="label-tag">ANTES</span><span class="label-tag">AHORA</span></div>
            <img src="" id="c-img-before" class="compare-img" style="width:100%; height:100%; object-fit:contain;">
            <img src="" id="c-img-after" class="compare-img img-overlay" style="clip-path:inset(0 0 0 0); width:100%; height:100%; object-fit:contain;">
            <div class="slider-handle" id="coach-slider-handle" style="left:0%"><div class="slider-btn"></div></div>
        </div>
        <input type="range" min="0" max="100" value="0" style="width:100%; margin-top:15px;" oninput="window.moveCoachSlider(this.value)">
    `;
    const selB = document.getElementById('c-sel-before');
    const selA = document.getElementById('c-sel-after');
    if(history.length === 0) {
        const current = u[`photoBefore${prefix}`];
        const opt = new Option(current ? "Actual" : "Sin fotos", current || "");
        selB.add(opt); selA.add(opt.cloneNode(true));
    } else {
        history.forEach((h, i) => {
            const label = h.date || `Foto ${i+1}`;
            selB.add(new Option(label, h.url));
            selA.add(new Option(label, h.url));
        });
        selB.selectedIndex = 0;
        selA.selectedIndex = history.length - 1;
    }
    window.updateCoachSliderImages();
}

window.updateCoachSliderImages = () => {
    const urlB = document.getElementById('c-sel-before').value;
    const urlA = document.getElementById('c-sel-after').value;
    const imgB = document.getElementById('c-img-before');
    const imgA = document.getElementById('c-img-after');
    if(imgB) imgB.src = urlB;
    if(imgA) imgA.src = urlA;
};

window.moveCoachSlider = (v) => {
    const overlay = document.getElementById('c-img-after');
    const handle = document.getElementById('coach-slider-handle');
    if(overlay) overlay.style.clipPath = `inset(0 0 0 ${v}%)`;
    if(handle) handle.style.left = `${v}%`;
};

function renderMeasureChart(canvasId, historyData) {
    const ctx = document.getElementById(canvasId);
    let instance = (canvasId === 'chartMeasures') ? measureChartInstance : coachMeasureChart;
    if(instance) instance.destroy();

    const labels = historyData.map(m => new Date(m.date.seconds*1000).toLocaleDateString());
    const parts = [
        {k:'chest', l:'Pecho', c:'#FF5733'}, {k:'waist', l:'Cintura', c:'#00FF88'},
        {k:'hip', l:'Cadera', c:'#3357FF'}, {k:'arm', l:'Brazo', c:'#FF33A8'},
        {k:'thigh', l:'Muslo', c:'#F3FF33'}, {k:'calf', l:'Gemelo', c:'#FF8C00'},
        {k:'shoulder', l:'Hombros', c:'#A133FF'}
    ];
    const datasets = parts.map(p => ({ label: p.l, data: historyData.map(h => h[p.k] || 0), borderColor: p.c, tension: 0.3, pointRadius: 2 }));
    const newChart = new Chart(ctx, { type: 'line', data: { labels: labels, datasets: datasets }, options: { plugins: { legend: { display: true, labels: { color: '#888', boxWidth: 10, font: {size: 10} } } }, scales: { y: { grid: { color: '#333' } }, x: { display: false } }, maintainAspectRatio: false } });
    if(canvasId === 'chartMeasures') measureChartInstance = newChart; else coachMeasureChart = newChart;
}

// --- FIX ADMIN TABS LOGIC ---
window.toggleAdminMode = (mode) => {
    document.getElementById('tab-users').classList.toggle('active', mode==='users');
    document.getElementById('tab-lib').classList.toggle('active', mode==='lib');
    
    document.getElementById('admin-users-card').classList.toggle('hidden', mode!=='users');
    document.getElementById('admin-lib-card').classList.toggle('hidden', mode!=='lib');
    
    if(mode==='users') window.loadAdminUsers();
    if(mode==='lib') window.loadAdminLibrary();
};

window.loadAdminUsers = async () => {
    const l = document.getElementById('admin-list');
    l.innerHTML = '<div style="text-align:center;padding:20px;color:#888;">↻ Cargando...</div>';
    try {
        const snap = await getDocs(collection(db, "users"));
        l.innerHTML = '';
        if (snap.empty) { l.innerHTML = '<div style="text-align:center;padding:20px;">Sin usuarios.</div>'; return; }
        
        let count = 0;
        snap.forEach(d => {
            const u = d.data();
            if(userData.role === 'assistant' && u.assignedCoach !== currentUser.uid) return;
            count++;
            
            let rowClass = "admin-user-row";
            let nameExtra = "";
            let roleLabel = "";
            if (d.id === currentUser.uid) { rowClass += " is-me"; nameExtra = " (Tú)"; }
            if (u.role === 'assistant') { rowClass += " is-coach"; roleLabel = `<span class="coach-badge">COACH</span>`; }
            
            const div = document.createElement('div');
            div.className = rowClass;
            div.innerHTML=`<div><strong>${u.name}${nameExtra} ${roleLabel}</strong><br><small>${u.email}</small></div><button class="btn-outline btn-small" style="width:auto;">⚙️ FICHA</button>`;
            div.onclick=()=>openCoachView(d.id,u); 
            l.appendChild(div);
        });
        
        if(count === 0) l.innerHTML = '<div style="text-align:center;padding:20px;">No se encontraron atletas.</div>';
        
    } catch (e) { 
        console.error(e);
        l.innerHTML = `<div style="text-align:center;color:red;">Error: ${e.message}</div>`; 
    }
};

window.loadAdminLibrary = async () => {
    const l = document.getElementById('admin-lib-list');
    l.innerHTML = '<div style="text-align:center;padding:20px;color:#888;">↻ Cargando librería...</div>';
    try {
        const uSnap = await getDocs(collection(db, "users"));
        const userMap = {}; uSnap.forEach(u => userMap[u.id] = u.data().name);
        
        const s = await getDocs(collection(db, "routines"));
        l.innerHTML = '';
        if (s.empty) { l.innerHTML = '<div style="text-align:center;padding:20px;">Sin rutinas.</div>'; return; }
        s.forEach(d => {
            const r = d.data();
            const div = document.createElement('div');
            div.className = "assigned-routine-item"; 
            const dataStr = encodeURIComponent(JSON.stringify(r.exercises));
            let author = "Desconocido";
            if(r.uid === currentUser.uid) author = "Mía (Admin)";
            else if(userMap[r.uid]) author = userMap[r.uid];
            else if(r.uid === 'admin') author = "Admin";
            else author = "Usuario " + r.uid.substr(0,4);
            
            div.innerHTML = `<div style="flex:1;"><b>${r.name}</b><br><span style="font-size:0.7rem; color:#666;">Creado por: ${author}</span></div><div style="display:flex; gap:10px;"><button class="btn-small btn-outline" style="margin:0; width:auto;" onclick="viewRoutineContent('${r.name}','${dataStr}')">👁️</button><button class="btn-small btn-danger" style="margin:0; width:auto; border:none;" onclick="delRoutine('${d.id}')">🗑️</button></div>`;
            l.appendChild(div);
        });
    } catch (e) { 
        console.error(e);
        l.innerHTML = '<div style="text-align:center;color:red;padding:20px;">Error cargando rutinas.</div>'; 
    }
};

window.viewRoutineContent = (name, dataStr) => {
    const exs = JSON.parse(decodeURIComponent(dataStr));
    let html = `<ul style="padding-left:20px; margin-top:10px;">`;
    exs.forEach(e => html += `<li style="margin-bottom:5px;">${e}</li>`);
    html += `</ul>`;
    document.getElementById('detail-title').innerText = name;
    document.getElementById('detail-content').innerHTML = html;
    document.getElementById('modal-details').classList.add('active');
};

window.openVideo = (url) => {
    if (!url) return;
    let embedUrl = url;
    if (url.includes("watch?v=")) embedUrl = url.replace("watch?v=", "embed/");
    else if (url.includes("youtu.be/")) embedUrl = url.replace("youtu.be/", "youtube.com/embed/");
    embedUrl += "?autoplay=1&rel=0";
    document.getElementById('youtube-frame').src = embedUrl;
    document.getElementById('modal-video').classList.add('active');
};

window.closeVideo = () => {
    document.getElementById('modal-video').classList.remove('active');
    document.getElementById('youtube-frame').src = ""; 
};

window.approveUser = async () => {
    if(!selectedUserCoach) return;
    if(confirm("¿Confirmas que quieres APROBAR a este atleta?")) {
        try {
            await updateDoc(doc(db, "users", selectedUserCoach), { approved: true });
            alert("✅ Usuario Aprobado.");
            openCoachView(selectedUserCoach, selectedUserObj);
        } catch(e) { alert("Error: " + e.message); }
    }
};

window.deleteUser = async () => {
    if(!selectedUserCoach) return;
    const confirmName = prompt("⚠ IRREVERSIBLE: Escribe 'BORRAR' para eliminar:");
    if(confirmName === 'BORRAR') {
        try {
            await deleteDoc(doc(db, "users", selectedUserCoach));
            alert("🗑️ Usuario eliminado.");
            window.loadAdminUsers();
            window.switchTab('admin-view');
        } catch(e) { alert("Error: " + e.message); }
    }
};

window.toggleUserFeature = async (feature, value) => {
    if(!selectedUserCoach) return;
    const update = {};
    update[feature] = value;
    await updateDoc(doc(db, "users", selectedUserCoach), update);
    openCoachView(selectedUserCoach, selectedUserObj);
};

window.updateUserRole = async (newRole) => {
    if(!selectedUserCoach) return;
    if(confirm(`¿Cambiar rol a ${newRole}?`)) {
        await updateDoc(doc(db,"users",selectedUserCoach), {role: newRole});
        alert("Rol actualizado"); openCoachView(selectedUserCoach, selectedUserObj);
    }
};

window.assignToAssistant = async (assistantId) => {
    if(!selectedUserCoach) return;
    await updateDoc(doc(db,"users",selectedUserCoach), {assignedCoach: assistantId});
    alert("Atleta reasignado"); openCoachView(selectedUserCoach, selectedUserObj);
};

window.goToCreateRoutine = () => {
    window.switchTab('routines-view');
    window.openEditor();
};

window.filterCoachRoutines = (text) => {
    const s = document.getElementById('coach-routine-select');
    s.innerHTML = '';
    const term = normalizeText(text);
    const filtered = allRoutinesCache.filter(r => normalizeText(r.name).includes(term));
    if(filtered.length === 0) { s.innerHTML = '<option value="">No encontrada</option>'; } 
    else { filtered.forEach(r => { const o = document.createElement('option'); o.value = r.id; o.innerText = r.name; s.appendChild(o); }); }
};

window.assignRoutine = async () => {
    const select = document.getElementById('coach-routine-select');
    const rid = select.value;
    if(!rid || rid === "" || rid === "Cargando..." || rid === "No encontrada") { return alert("❌ Por favor selecciona una rutina válida."); }
    if(!selectedUserCoach) return alert("❌ No hay usuario seleccionado.");
    try {
        const rRef = doc(db, "routines", rid); 
        await updateDoc(rRef, { assignedTo: arrayUnion(selectedUserCoach) }); 
        alert("✅ Rutina Asignada Correctamente");
        openCoachView(selectedUserCoach, selectedUserObj); 
    } catch(e) { alert("Error asignando: " + e.message); }
};

window.unassignRoutine = async (rid) => {
    if(confirm("¿Quitar esta rutina al atleta?")) {
        await updateDoc(doc(db, "routines", rid), { assignedTo: arrayRemove(selectedUserCoach) });
        openCoachView(selectedUserCoach, selectedUserObj); 
    }
};

// ... LISTENERS ...
document.getElementById('btn-register').onclick=async()=>{
    const secretCode = document.getElementById('reg-code').value;
    try{ 
        const c=await createUserWithEmailAndPassword(auth,document.getElementById('reg-email').value,document.getElementById('reg-pass').value);
        await setDoc(doc(db,"users",c.user.uid),{
            name:document.getElementById('reg-name').value,
            email:document.getElementById('reg-email').value,
            secretCode: secretCode, 
            approved: false, 
            role: 'athlete', 
            gender:document.getElementById('reg-gender').value,
            age:parseInt(document.getElementById('reg-age').value),
            height:parseInt(document.getElementById('reg-height').value), 
            weightHistory: [],
            measureHistory: [],
            skinfoldHistory: [],
            prs: {}, 
            stats: {workouts:0, totalKg:0, totalSets:0, totalReps:0},
            muscleStats: {},
            joined: serverTimestamp(),
            showVideos: false 
        });
    }catch(e){alert("Error: " + e.message + " (Posiblemente código secreto incorrecto)");}
};
document.getElementById('btn-login').onclick=()=>signInWithEmailAndPassword(auth,document.getElementById('login-email').value,document.getElementById('login-pass').value).catch(e=>alert(e.message));
