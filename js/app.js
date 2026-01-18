import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, getDoc, updateDoc, onSnapshot, query, where, addDoc, deleteDoc, getDocs, serverTimestamp, increment, orderBy, limit, arrayRemove, arrayUnion } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { EXERCISES } from './data.js';

// --- CONFIGURACIÓN FIREBASE ---
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

// ESTADO GLOBAL
let audioCtx = null;
let currentUser=null, userData=null, activeWorkout=null, timerInt=null, restTimeRemaining=0, wakeLock=null;
let chartInstance=null, progressChart=null, fatChartInstance=null, measureChartInstance=null, coachFatChart=null, coachMeasureChart=null, radarChartInstance=null;
let selectedUserCoach=null, selectedUserObj=null, editingRoutineId=null, coachChart=null, currentPose='front', coachCurrentPose='front', allRoutinesCache=[], assistantsCache=[];
let currentRoutineSelections = [];

// --- SISTEMA DE SONIDO ---
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

// --- HELPERS EJERCICIOS ---
function getExerciseData(name) {
    if(!name) return { img: 'logo.png', mInfo: {main:'General', sec:[]}, type:'c' };
    let match = EXERCISES.find(e => e.n === name);
    if (!match) {
        const cleanName = name.toLowerCase().replace(/ de | con | en | el | la /g, " ").trim();
        match = EXERCISES.find(e => {
            const cleanDbName = e.n.toLowerCase().replace(/ de | con | en | el | la /g, " ").trim();
            return cleanDbName.includes(cleanName) || cleanName.includes(cleanDbName);
        });
    }
    if (!match) {
        const n = name.toLowerCase();
        let m = "General", img = "logo.png";
        if(n.includes("press")||n.includes("pecho")||n.includes("aperturas")) { m="Pecho"; img="pecho.png"; }
        else if(n.includes("remo")||n.includes("jalon")||n.includes("espalda")||n.includes("dominadas")) { m="Espalda"; img="espalda.png"; }
        else if(n.includes("sentadilla")||n.includes("prensa")||n.includes("extension")||n.includes("zancada")) { m="Cuádriceps"; img="cuadriceps.png"; }
        else if(n.includes("curl")||n.includes("biceps")) { m="Bíceps"; img="biceps.png"; }
        else if(n.includes("triceps")||n.includes("frances")||n.includes("fondos")) { m="Tríceps"; img="triceps.png"; }
        else if(n.includes("hombro")||n.includes("militar")||n.includes("elevacion")||n.includes("pajaros")) { m="Hombros"; img="hombros.png"; }
        return { img: img, mInfo: getMuscleInfoByGroup(m), type:'c' };
    }
    return { img: match.img, mInfo: getMuscleInfoByGroup(match.m), type: match.t || 'c' };
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

// --- AUTH OBSERVER ---
onAuthStateChanged(auth, async (user) => {
    if(user) {
        currentUser = user;
        const snap = await getDoc(doc(db,"users",user.uid));
        if(snap.exists()){
            userData = snap.data();
            checkPhotoReminder();
            
            if(userData.role === 'admin' || userData.role === 'assistant') {
                document.getElementById('coach-btn').classList.remove('hidden');
                document.getElementById('coach-btn').onclick = () => { window.loadAdminUsers(); switchTab('admin-view'); };
            }

            if(userData.role !== 'admin' && userData.role !== 'assistant' && !sessionStorage.getItem('notif_dismissed')) {
                const routinesSnap = await getDocs(query(collection(db, "routines"), where("assignedTo", "array-contains", user.uid)));
                if(!routinesSnap.empty) document.getElementById('notif-badge').style.display = 'block';
            }

            if(userData.approved){
                setTimeout(() => { document.getElementById('loading-screen').classList.add('hidden'); }, 1500); 
                document.getElementById('main-header').classList.remove('hidden');
                document.getElementById('bottom-nav').classList.remove('hidden');
                
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
        setTimeout(() => { document.getElementById('loading-screen').classList.add('hidden'); }, 1500);
        switchTab('auth-view');
        document.getElementById('main-header').classList.add('hidden');
        document.getElementById('bottom-nav').classList.add('hidden');
    }
});

function checkPhotoReminder() {
    if(!userData.photoDay) return;
    const now = new Date();
    const day = now.getDay();
    const time = now.toTimeString().substr(0,5);
    if(day == userData.photoDay && time === userData.photoTime) alert("📸 HORA DE TU FOTO DE PROGRESO 📸");
}

window.switchTab = (t) => {
    document.querySelectorAll('.view-container').forEach(e=>e.classList.remove('active'));
    document.getElementById(t).classList.add('active');
    document.getElementById('main-container').scrollTop = 0;
    const ns = document.querySelectorAll('.nav-item');
    ns.forEach(n=>n.classList.remove('active'));
    if(t==='routines-view') ns[0].classList.add('active');
    if(t==='profile-view') { ns[1].classList.add('active'); loadProfile(); }
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

// --- RUTINAS ---
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
window.filterExercises = (t) => { const filtered = EXERCISES.filter(e => e.n.toLowerCase().includes(t.toLowerCase())); renderExercises(filtered); };
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
window.loadCompImg = (inp, field) => { if(inp.files[0]) { const r = new FileReader(); r.onload = (e) => { const img = new Image(); img.src = e.target.result; img.onload = async () => { const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d'); const scale = 600 / img.width; canvas.width = 600; canvas.height = img.height * scale; ctx.drawImage(img, 0, 0, canvas.width, canvas.height); const dataUrl = canvas.toDataURL('image/jpeg', 0.7); const prefix = currentPose === 'front' ? '' : '_back'; const fieldName = field === 'before' ? `photoBefore${prefix}` : `photoAfter${prefix}`; const dateField = field === 'before' ? `dateBefore${prefix}` : `dateAfter${prefix}`; const today = new Date().toLocaleDateString(); let update = {}; update[fieldName] = dataUrl; update[dateField] = today; await updateDoc(doc(db, "users", currentUser.uid), update); userData[fieldName] = dataUrl; userData[dateField] = today; updatePhotoDisplay(userData); }; }; r.readAsDataURL(inp.files[0]); } };
window.deletePhoto = async (type) => { if(!confirm("¿Borrar?")) return; const prefix = currentPose === 'front' ? '' : '_back'; const f = type === 'before' ? `photoBefore${prefix}` : `photoAfter${prefix}`; let u={}; u[f]=""; await updateDoc(doc(db,"users",currentUser.uid),u); userData[f]=""; updatePhotoDisplay(userData); }
window.moveSlider = (v) => { document.getElementById('img-overlay').style.clipPath = `inset(0 0 0 ${v}%)`; document.getElementById('slider-handle').style.left = `${v}%`; };
window.moveCoachSlider = (v) => { document.getElementById('coach-overlay-img').style.clipPath = `inset(0 0 0 ${v}%)`; document.getElementById('coach-slider-handle').style.left = `${v}%`; };

// --- GRÁFICA MULTI-LINEA ---
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

// --- PERFIL DE USUARIO (REORGANIZADO) ---
window.loadProfile = async () => {
    document.getElementById('profile-name').innerText = userData.name;
    if(userData.photo) { document.getElementById('avatar-text').style.display='none'; document.getElementById('avatar-img').src = userData.photo; document.getElementById('avatar-img').style.display='block'; }
    updatePhotoDisplay(userData);
    
    // Configuración Switches
    document.getElementById('cfg-show-skinfolds').checked = !!userData.showSkinfolds;
    document.getElementById('cfg-show-measures').checked = !!userData.showMeasurements;
    if(userData.restTime) document.getElementById('cfg-rest-time').value = userData.restTime;
    
    document.getElementById('stat-workouts').innerText = userData.stats.workouts || 0;
    document.getElementById('stat-kg').innerText = userData.stats.totalKg ? (userData.stats.totalKg/1000).toFixed(1)+'t' : 0;
    document.getElementById('stat-sets').innerText = userData.stats.totalSets || 0;
    document.getElementById('stat-reps').innerText = userData.stats.totalReps || 0;

    const ctx = document.getElementById('weightChart'); 
    if(chartInstance) chartInstance.destroy();
    const rawData = userData.weightHistory;
    const data = (rawData && rawData.length > 0) ? rawData : [70]; 
    chartInstance = new Chart(ctx, { type:'line', data:{ labels:data.map((_,i)=>`T${i}`), datasets:[{label:'Kg', data:data, borderColor:'#ff3333', backgroundColor:'rgba(255,51,51,0.1)', fill:true, tension:0.4}] }, options:{plugins:{legend:{display:false}}, scales:{x:{display:false},y:{grid:{color:'#333'}}}, maintainAspectRatio:false} });

    const histDiv = document.getElementById('user-history-list'); histDiv.innerHTML = "Cargando...";
    try {
        const q = query(collection(db, "workouts"), where("uid", "==", currentUser.uid));
        const snap = await getDocs(q);
        const workouts = snap.docs.map(d => ({id:d.id, ...d.data()})).sort((a,b) => b.date - a.date).slice(0, 5);
        histDiv.innerHTML = workouts.length ? '' : "Sin historial.";
        workouts.forEach(d => {
            const date = d.date ? new Date(d.date.seconds*1000).toLocaleDateString() : '-';
            const detailsStr = d.details ? encodeURIComponent(JSON.stringify(d.details)) : "";
            const noteStr = d.note ? encodeURIComponent(d.note) : "";
            const btnVer = d.details ? `<button class="btn-small btn-outline" style="margin:0; padding:2px 6px;" onclick="viewWorkoutDetails('${d.routine}', '${detailsStr}', '${noteStr}')">🔍</button>` : '';
            histDiv.innerHTML += `<div class="history-row" style="grid-template-columns: 1fr 40px;"><div><span style="color:#accent-color">${date}</span> - ${d.routine}</div><div style="text-align:right;">${btnVer}</div></div>`;
        });
    } catch(e) { histDiv.innerHTML = "Error."; }

    if(userData.showMeasurements) {
        document.getElementById('user-measures-section').classList.remove('hidden');
        if(userData.measureHistory && userData.measureHistory.length > 0) renderMeasureChart('chartMeasures', userData.measureHistory);
    } else { document.getElementById('user-measures-section').classList.add('hidden'); }

    if(userData.showSkinfolds) {
        document.getElementById('user-skinfolds-section').classList.remove('hidden');
        if(userData.skinfoldHistory && userData.skinfoldHistory.length > 0) {
            const ctxF = document.getElementById('chartFat');
            if(fatChartInstance) fatChartInstance.destroy();
            const dataF = userData.skinfoldHistory.map(f => f.fat || 0);
            const labels = userData.skinfoldHistory.map(f => new Date(f.date.seconds*1000).toLocaleDateString());
            fatChartInstance = new Chart(ctxF, { type: 'line', data: { labels: labels, datasets: [{ label: '% Grasa', data: dataF, borderColor: '#ffaa00', tension: 0.3 }] }, options: { plugins: { legend: { display: false } }, scales: { y: { grid: { color: '#333' } }, x: { display: false } }, maintainAspectRatio: false } });
        }
    } else { document.getElementById('user-skinfolds-section').classList.add('hidden'); }

    const muscles = ["Pecho","Espalda","Cuádriceps","Isquios","Glúteos","Hombros","Bíceps","Tríceps"];
    const hC = document.getElementById('heatmap-container'); hC.innerHTML = '';
    const mS = userData.muscleStats || {};
    muscles.forEach(m=>{
        const count = mS[m] || 0;
        const pct = Math.min((count / 20) * 100, 100); 
        const d = document.createElement('div'); d.className = 'muscle-bar-group';
        d.innerHTML = `<div class="muscle-label"><span>${m}</span><span>${count} series</span></div><div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>`;
        hC.appendChild(d);
    });
}

// --- CONFIGURACIÓN PROPIA (Self Toggles) ---
window.saveSelfConfig = async (feature, value) => {
    const update = {}; update[feature] = value;
    await updateDoc(doc(db, "users", currentUser.uid), update);
    userData[feature] = value; // Update local state immediately
    window.loadProfile();
};

window.saveMeasurements = async () => {
    const data = {
        date: new Date(),
        chest: document.getElementById('m-chest').value,
        waist: document.getElementById('m-waist').value,
        hip: document.getElementById('m-hip').value,
        arm: document.getElementById('m-arm').value,
        thigh: document.getElementById('m-thigh').value,
        calf: document.getElementById('m-calf').value,
        shoulder: document.getElementById('m-shoulder').value
    };
    await updateDoc(doc(db, "users", currentUser.uid), { measureHistory: arrayUnion(data), measurements: data });
    alert("Guardado ✅"); window.loadProfile();
};

window.calculateAndSaveSkinfolds = async () => {
    const s = {
        chest: parseFloat(document.getElementById('p-chest').value)||0, axilla: parseFloat(document.getElementById('p-axilla').value)||0,
        tricep: parseFloat(document.getElementById('p-tricep').value)||0, subscap: parseFloat(document.getElementById('p-subscap').value)||0,
        abdo: parseFloat(document.getElementById('p-abdo').value)||0, supra: parseFloat(document.getElementById('p-supra').value)||0,
        thigh: parseFloat(document.getElementById('p-thigh').value)||0
    };
    const sum = Object.values(s).reduce((a,b)=>a+b,0);
    const age = userData.age || 25, gender = userData.gender || 'male';
    let bd = (gender === 'male') ? 1.112 - (0.00043499*sum) + (0.00000055*sum*sum) - (0.00028826*age) : 1.097 - (0.00046971*sum) + (0.00000056*sum*sum) - (0.00012828*age);
    const fat = ((495 / bd) - 450).toFixed(1);
    await updateDoc(doc(db, "users", currentUser.uid), { skinfoldHistory: arrayUnion({date: new Date(), fat: fat, skinfolds: s}), skinfolds: s, bodyFat: fat });
    alert(`Grasa: ${fat}%. Guardado ✅`); window.loadProfile();
};

window.saveConfig = async () => {
    const rt = document.getElementById('cfg-rest-time').value;
    await updateDoc(doc(db,"users",currentUser.uid), { restTime: parseInt(rt) });
    userData.restTime = parseInt(rt);
    alert("Ajustes Guardados");
};
window.savePhotoReminder = async () => {
    const d = document.getElementById('photo-day').value;
    const t = document.getElementById('photo-time').value;
    await updateDoc(doc(db,"users",currentUser.uid), { photoDay:d, photoTime:t });
    userData.photoDay = d; userData.photoTime = t;
    alert("Alarma Guardada");
};
window.uploadAvatar = (inp) => { if(inp.files[0]) { const r = new FileReader(); r.onload=async(e)=>{ await updateDoc(doc(db,"users",currentUser.uid), {photo:e.target.result}); window.loadProfile(); }; r.readAsDataURL(inp.files[0]); } };

window.addWeightEntry = async () => { 
    const wStr = prompt("Introduce tu peso (kg):");
    if(!wStr) return;
    const w = parseFloat(wStr.replace(',','.'));
    if(isNaN(w)) return alert("Número inválido");
    let history = userData.weightHistory || [];
    history.push(w);
    try {
        await updateDoc(doc(db,"users",currentUser.uid), {weightHistory: history});
        userData.weightHistory = history; 
        window.loadProfile(); 
        alert("✅ Peso Guardado");
    } catch(e) { alert("Error al guardar: " + e.message); }
};

function saveLocalWorkout() {
    localStorage.setItem('fit_active_workout', JSON.stringify(activeWorkout));
}

window.cancelWorkout = () => {
    if(confirm("⚠ ¿SEGURO QUE QUIERES CANCELAR?\nSe perderán los datos de este entrenamiento.")) {
        activeWorkout = null;
        localStorage.removeItem('fit_active_workout');
        switchTab('routines-view');
    }
};

window.startWorkout = async (rid) => {
    if(document.getElementById('cfg-wake').checked && 'wakeLock' in navigator) try{wakeLock=await navigator.wakeLock.request('screen');}catch(e){}
    try {
        const snap = await getDoc(doc(db,"routines",rid)); 
        const r = snap.data();
        let lastWorkoutData = null;
        const q = query(collection(db, "workouts"), where("uid", "==", currentUser.uid));
        const wSnap = await getDocs(q);
        const sameRoutine = wSnap.docs.map(d=>d.data()).filter(d => d.routine === r.name).sort((a,b) => b.date - a.date); 
        if(sameRoutine.length > 0) lastWorkoutData = sameRoutine[0].details;

        activeWorkout = { name: r.name, exs: r.exercises.map(n => {
            const data = getExerciseData(n);
            let sets = Array(5).fill().map((_,i)=>({r: i===0 ? 20 : 16, w:0, d:false, prev:'-'}));
            if(lastWorkoutData) {
                const prevEx = lastWorkoutData.find(ld => ld.n === n);
                if(prevEx && prevEx.s) {
                    sets = sets.map((s, i) => { if(prevEx.s[i]) s.prev = `${prevEx.s[i].r}x${prevEx.s[i].w}kg`; return s; });
                }
            }
            return { n:n, img:data.img, mInfo: data.mInfo, type: data.type, sets: sets }; 
        })};
        
        saveLocalWorkout(); renderWorkout(); switchTab('workout-view'); startTimerMini();
    } catch(e) { alert("Error iniciando entreno: " + e.message); }
};

window.addSet = (exIdx) => { activeWorkout.exs[exIdx].sets.push({r:16, w:0, d:false, prev:'-'}); saveLocalWorkout(); renderWorkout(); };
window.removeSet = (exIdx) => { if(activeWorkout.exs[exIdx].sets.length > 1) { activeWorkout.exs[exIdx].sets.pop(); saveLocalWorkout(); renderWorkout(); } };

function renderWorkout() {
    const c = document.getElementById('workout-exercises'); c.innerHTML = '';
    document.getElementById('workout-title').innerText = activeWorkout.name;
    activeWorkout.exs.forEach((e,i) => {
        const card = document.createElement('div'); card.className = 'card'; card.style.borderLeft="3px solid var(--accent-color)";
        let bars = '';
        if (e.type === 'i') {
             bars = `<div class="mini-bar-label"><span>${e.mInfo.main}</span><span>100%</span></div><div class="mini-track"><div class="mini-fill fill-primary"></div></div>`;
        } else {
             bars = `<div class="mini-bar-label"><span>${e.mInfo.main}</span><span>70%</span></div><div class="mini-track"><div class="mini-fill fill-primary" style="width:70%"></div></div>`;
             e.mInfo.sec.forEach(s => { bars += `<div class="mini-bar-label" style="margin-top:4px;"><span>${s}</span><span>15%</span></div><div class="mini-track"><div class="mini-fill fill-sec" style="width:15%"></div></div>`; });
        }
        let setsHtml = `<div class="set-header"><div>#</div><div>PREV</div><div>REPS</div><div>KG</div><div></div></div>`;
        e.sets.forEach((s,j) => {
            const weightVal = s.w === 0 ? '' : s.w;
            setsHtml += `<div class="set-row"><div class="set-num">${j+1}</div><div class="prev-data">${s.prev}</div><div><input type="number" value="${s.r}" onchange="uS(${i},${j},'r',this.value)"></div><div><input type="number" placeholder="kg" value="${weightVal}" onchange="uS(${i},${j},'w',this.value)"></div><button id="btn-${i}-${j}" class="btn-outline ${s.d?'btn-done':''}" style="margin:0;padding:0;height:35px;" onclick="tS(${i},${j})">${s.d?'✓':''}</button></div>`;
        });
        setsHtml += `<div class="sets-actions"><button class="btn-set-control" onclick="removeSet(${i})">- Serie</button><button class="btn-set-control" onclick="addSet(${i})">+ Serie</button></div>`;
        card.innerHTML = `<div class="workout-split"><div class="workout-visual"><img src="${e.img}" onerror="this.src='logo.png'"></div><div class="workout-bars" style="width:100%">${bars}</div></div><h3 style="margin-bottom:10px; border:none;">${e.n}</h3>${setsHtml}`;
        c.appendChild(card);
    });
}

window.uS = (i,j,k,v) => { activeWorkout.exs[i].sets[j][k]=v; saveLocalWorkout(); };
window.tS = (i,j) => { const s = activeWorkout.exs[i].sets[j]; s.d = !s.d; saveLocalWorkout(); const btn = document.getElementById(`btn-${i}-${j}`); if(s.d) { btn.classList.add('btn-done'); btn.innerText = '✓'; openRest(); } else { btn.classList.remove('btn-done'); btn.innerText = ''; } };

function openRest() {
    const m = document.getElementById('modal-timer'); m.classList.add('active');
    const rest = userData.restTime || 60;
    restTimeRemaining = rest;
    document.getElementById('timer-display').innerText = restTimeRemaining;
    if(timerInt) clearInterval(timerInt);
    timerInt = setInterval(() => {
        restTimeRemaining--;
        document.getElementById('timer-display').innerText = restTimeRemaining;
        if(restTimeRemaining <= 0) { clearInterval(timerInt); m.classList.remove('active'); if(document.getElementById('cfg-sound').checked) { play5Beeps(); } }
    }, 1000);
}
window.closeTimer = () => { clearInterval(timerInt); document.getElementById('modal-timer').classList.remove('active'); };
window.addRestTime = (s) => { restTimeRemaining += s; document.getElementById('timer-display').innerText = restTimeRemaining; };
function startTimerMini() { const d=document.getElementById('mini-timer'); const s=Date.now(); setInterval(()=>{const df=Math.floor((Date.now()-s)/1000); d.innerText=`${Math.floor(df/60)}:${(df%60).toString().padStart(2,'0')}`;},1000); }

window.promptRPE = () => {
    const radarCtx = document.getElementById('muscleRadarChart');
    if(radarChartInstance) radarChartInstance.destroy();
    const muscleCounts = { "Pecho":0, "Espalda":0, "Pierna":0, "Hombros":0, "Brazos":0, "Abs":0 };
    activeWorkout.exs.forEach(e => {
        const m = e.mInfo.main;
        let key = "";
        if(m==="Pecho") key="Pecho"; else if(m==="Espalda") key="Espalda";
        else if(m==="Cuádriceps" || m==="Isquios" || m==="Glúteos" || m==="Gemelos") key="Pierna";
        else if(m==="Hombros") key="Hombros"; else if(m==="Bíceps" || m==="Tríceps") key="Brazos";
        else if(m==="Abs") key="Abs";
        if(key) muscleCounts[key] += e.sets.length;
    });
    radarChartInstance = new Chart(radarCtx, {
        type: 'radar',
        data: { labels: Object.keys(muscleCounts), datasets: [{ label: 'Volumen', data: Object.values(muscleCounts), backgroundColor: 'rgba(255, 51, 51, 0.4)', borderColor: '#ff3333', pointBackgroundColor: '#fff', pointBorderColor: '#ff3333' }] },
        options: { scales: { r: { angleLines: { color: '#333' }, grid: { color: '#333' }, pointLabels: { color: 'white' }, ticks: { display: false, backdropColor: 'transparent' } } }, plugins: { legend: { display: false } }, maintainAspectRatio: false }
    });
    document.getElementById('workout-notes').value = ''; 
    document.getElementById('modal-rpe').classList.add('active');
};

window.finishWorkout = async (rpeVal) => {
    document.getElementById('modal-rpe').classList.remove('active');
    const note = document.getElementById('workout-notes').value; 
    let s=0, r=0, k=0;
    let muscleCounts = {};
    let prAlert = ""; 
    const cleanLog = activeWorkout.exs.map(e => { return { n: e.n, s: e.sets.filter(set => set.d).map(set => ({ r: set.r, w: set.w })) }; }).filter(e => e.s.length > 0); 
    if(!userData.prs) userData.prs = {};
    activeWorkout.exs.forEach(e => {
        e.sets.forEach(st => { 
            if(st.d) { 
                s++; r+=parseInt(st.r)||0; 
                const weight = parseInt(st.w)||0;
                k+=weight*(parseInt(st.r)||0); 
                const mName = e.mInfo.main;
                muscleCounts[mName] = (muscleCounts[mName] || 0) + 1;
                if(weight > (userData.prs[e.n] || 0)) { userData.prs[e.n] = weight; prAlert = `🏆 RÉCORD: ${e.n} (${weight}kg)\n`; }
            }
        });
    });
    if(prAlert) alert(prAlert); 
    await addDoc(collection(db,"workouts"), { uid:currentUser.uid, date:serverTimestamp(), routine:activeWorkout.name, rpe: rpeVal, note: note, details: cleanLog });
    const updates = { "stats.workouts": increment(1), "stats.totalSets": increment(s), "stats.totalReps": increment(r), "stats.totalKg": increment(k), "prs": userData.prs };
    for (const [muscle, count] of Object.entries(muscleCounts)) { updates[`muscleStats.${muscle}`] = increment(count); }
    await updateDoc(doc(db,"users",currentUser.uid), updates);
    localStorage.removeItem('fit_active_workout'); 
    if(wakeLock) wakeLock.release(); 
    switchTab('routines-view');
};

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
        let q = collection(db, "users");
        if(userData.role === 'assistant') { q = query(collection(db, "users"), where("assignedCoach", "==", currentUser.uid)); }
        const s = await getDocs(q);
        l.innerHTML = '';
        if (s.empty) { l.innerHTML = '<div style="text-align:center;padding:20px;">Sin atletas asignados.</div>'; return; }
        s.forEach(d => {
            const u = d.data(); 
            if(d.id === currentUser.uid || u.role === 'admin') return;
            const div = document.createElement('div');
            div.className = "admin-user-row";
            const roleBadge = u.role === 'assistant' ? '🛡️' : '';
            div.innerHTML=`<div><strong>${u.name} ${roleBadge}</strong><br><small>${u.email}</small></div><button class="btn-outline btn-small" style="width:auto;">⚙️ FICHA</button>`;
            div.onclick=()=>openCoachView(d.id,u); 
            l.appendChild(div);
        });
    } catch (e) { l.innerHTML = '<div style="text-align:center;color:red;">Error de permisos.</div>'; }
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
    } catch (e) { l.innerHTML = '<div style="text-align:center;color:red;padding:20px;">Error.</div>'; }
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

async function openCoachView(uid,u) {
    selectedUserCoach=uid;
    const freshSnap = await getDoc(doc(db, "users", uid));
    const freshU = freshSnap.data();
    selectedUserObj = freshU; 
    switchTab('coach-detail-view');
    document.getElementById('coach-user-name').innerText=freshU.name + (freshU.role === 'assistant' ? ' (Coach 🛡️)' : '');
    document.getElementById('coach-user-email').innerText=freshU.email;
    const genderIcon = freshU.gender === 'female' ? '♀️' : '♂️';
    document.getElementById('coach-user-meta').innerText = `${genderIcon} ${freshU.age} años • ${freshU.height} cm`;

    const banner = document.getElementById('pending-approval-banner');
    if(!freshU.approved) { banner.classList.remove('hidden'); } else { banner.classList.add('hidden'); }

    if(userData.role === 'admin' && freshU.role !== 'admin') {
        let adminActions = `<div style="margin-top:10px; border-top:1px solid #333; padding-top:10px;">`;
        if(freshU.role !== 'assistant') {
            adminActions += `<button class="btn-small btn-outline" onclick="window.updateUserRole('assistant')">🛡️ Ascender a Coach</button>`;
        } else {
            adminActions += `<button class="btn-small btn-danger" onclick="window.updateUserRole('athlete')">Bajar a Atleta</button>`;
        }
        // ASIGNAR A OTRO COACH (Siempre visible si hay coaches)
        if(freshU.role === 'athlete') {
             // Forzar carga de assistants
             const qAssist = query(collection(db,"users"), where("role", "==", "assistant"));
             const snapA = await getDocs(qAssist);
             assistantsCache = snapA.docs.map(d=>({id:d.id, name:d.data().name}));
             
             if(assistantsCache.length > 0) {
                 let options = `<option value="">-- Asignar a Coach --</option>`;
                 assistantsCache.forEach(a => options += `<option value="${a.id}">${a.name}</option>`);
                 adminActions += `<div style="margin-top:10px;"><select onchange="window.assignToAssistant(this.value)">${options}</select></div>`;
             }
        }
        adminActions += `</div>`;
        document.getElementById('coach-user-meta').innerHTML += adminActions;
    }

    updateCoachPhotoDisplay('front');
    document.getElementById('coach-toggle-skinfolds').checked = !!freshU.showSkinfolds;
    document.getElementById('coach-toggle-measures').checked = !!freshU.showMeasurements;

    const pCard = document.getElementById('coach-view-skinfolds');
    const mCard = document.getElementById('coach-view-measures');
    
    if(freshU.showSkinfolds && freshU.skinfoldHistory && freshU.skinfoldHistory.length > 0) {
        pCard.classList.remove('hidden');
        if(coachFatChart) coachFatChart.destroy();
        const ctxF = document.getElementById('coachFatChart');
        const dataF = freshU.skinfoldHistory.map(f => f.fat || 0);
        const labels = freshU.skinfoldHistory.map(f => new Date(f.date.seconds*1000).toLocaleDateString());
        coachFatChart = new Chart(ctxF, { type: 'line', data: { labels: labels, datasets: [{ label: '% Grasa', data: dataF, borderColor: '#ffaa00', tension: 0.3 }] }, options: { plugins: { legend: { display: false } }, scales: { y: { grid: { color: '#333' } }, x: { display: false } }, maintainAspectRatio: false } });
    } else { pCard.classList.add('hidden'); }

    if(freshU.showMeasurements && freshU.measureHistory && freshU.measureHistory.length > 0) {
        mCard.classList.remove('hidden');
        renderMeasureChart('coachMeasuresChart', freshU.measureHistory);
    } else { mCard.classList.add('hidden'); }

    try {
        const s = document.getElementById('coach-routine-select'); s.innerHTML = '';
        const allRoutinesSnap = await getDocs(collection(db, "routines"));
        allRoutinesCache = [];
        allRoutinesSnap.forEach(r => {
            const data = r.data(); allRoutinesCache.push({id: r.id, ...data});
            const o = document.createElement('option'); o.value = r.id; o.innerText = data.name; s.appendChild(o); 
        });
        const rList = document.getElementById('coach-assigned-list'); rList.innerHTML = '';
        const assignedRoutines = allRoutinesCache.filter(r => r.assignedTo && r.assignedTo.includes(uid));
        if(assignedRoutines.length === 0) { rList.innerHTML = 'Ninguna rutina asignada.'; } else {
            assignedRoutines.forEach(r => {
                const div = document.createElement('div'); div.className = "assigned-routine-item";
                div.innerHTML = `<span>${r.name}</span><button style="background:none;border:none;color:#f55;font-weight:bold;cursor:pointer;" onclick="unassignRoutine('${r.id}')">❌</button>`;
                rList.appendChild(div);
            });
        }
    } catch(e) { console.error("Error loading routines", e); }

    try {
        const st = freshU.stats || {};
        const age = freshU.age ? freshU.age : 'N/D';
        document.getElementById('coach-stats-text').innerHTML = `<div class="stat-pill"><b>${st.workouts||0}</b><span>ENTRENOS</span></div><div class="stat-pill"><b>${(st.totalKg/1000||0).toFixed(1)}t</b><span>CARGA</span></div><div class="stat-pill"><b>${age}</b><span>AÑOS</span></div>`;
        if(coachChart) coachChart.destroy();
        const ctx = document.getElementById('coachWeightChart');
        const wData = freshU.weightHistory || [];
        const data = (wData && wData.length > 0) ? wData : [70];
        coachChart = new Chart(ctx, { type:'line', data: { labels:data.map((_,i)=>i+1), datasets:[{label:'Kg', data:data, borderColor:'#ff3333', fill:false}] }, options:{plugins:{legend:{display:false}}, scales:{x:{display:false},y:{grid:{color:'#333'}}}, maintainAspectRatio: false}});

        const hList = document.getElementById('coach-history-list');
        hList.innerHTML = 'Cargando historial...';
        const qH = query(collection(db,"workouts"), where("uid","==",uid));
        const wSnap = await getDocs(qH);
        hList.innerHTML = '';
        if(wSnap.empty) {
            hList.innerHTML='Sin datos recientes.';
        } else {
            const sortedDocs = wSnap.docs.map(doc => ({id: doc.id, ...doc.data()})).sort((a,b) => b.date - a.date).slice(0, 10);
            sortedDocs.forEach(d => {
                const date = d.date ? new Date(d.date.seconds*1000).toLocaleDateString() : '-';
                let rpeBadge = d.rpe === 'Suave' ? '<span class="badge green">🟢</span>' : (d.rpe === 'Duro' ? '<span class="badge orange">🟠</span>' : (d.rpe === 'Fallo' ? '<span class="badge red">🔴</span>' : '<span class="badge gray">-</span>'));
                const detailsStr = d.details ? encodeURIComponent(JSON.stringify(d.details)) : "";
                const noteStr = d.note ? encodeURIComponent(d.note) : "";
                const btnVer = d.details ? `<button class="btn-small btn-outline" style="margin:0; padding:2px 6px;" onclick="viewWorkoutDetails('${d.routine}', '${detailsStr}', '${noteStr}')">Ver Detalles</button>` : '';
                hList.innerHTML += `<div class="history-row" style="grid-template-columns: 60px 1fr 30px 40px;"><div class="hist-date">${date}</div><div class="hist-name" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${d.routine}</div><div class="hist-rpe">${rpeBadge}</div><div>${btnVer}</div></div>`;
            });
        }
    } catch(e) { console.error("Error loading coach details", e); hList.innerHTML='Error cargando datos.'; }
}

window.viewWorkoutDetails = (title, dataStr, noteStr) => {
    if(!dataStr) return;
    const data = JSON.parse(decodeURIComponent(dataStr));
    const note = noteStr ? decodeURIComponent(noteStr) : "Sin notas.";
    const content = document.getElementById('detail-content');
    document.getElementById('detail-title').innerText = title;
    let html = `<div class="note-display">📝 ${note}</div>`;
    data.forEach(ex => {
        html += `<div style="margin-bottom:10px; border-bottom:1px solid #333; padding-bottom:5px;"><strong style="color:white;">${ex.n}</strong><div style="display:flex; flex-wrap:wrap; gap:5px; margin-top:5px;">`;
        ex.s.forEach((set, i) => { html += `<span style="background:#222; padding:3px 6px; border-radius:4px; border:1px solid #444; color:#ccc;">#${i+1}: <b>${set.r}</b> x ${set.w}kg</span>`; });
        html += `</div></div>`;
    });
    content.innerHTML = html;
    document.getElementById('modal-details').classList.add('active');
};

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
            joined: serverTimestamp()
        });
    }catch(e){alert("Error: " + e.message + " (Posiblemente código secreto incorrecto)");}
};
document.getElementById('btn-login').onclick=()=>signInWithEmailAndPassword(auth,document.getElementById('login-email').value,document.getElementById('login-pass').value).catch(e=>alert(e.message));