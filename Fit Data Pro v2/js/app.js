import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, getDoc, updateDoc, onSnapshot, query, where, addDoc, deleteDoc, getDocs, serverTimestamp, increment, orderBy, limit, arrayRemove, arrayUnion } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { EXERCISES } from './data.js';

const firebaseConfig = {
    apiKey: "AIzaSyCmM0gViU3itZ4HIZZVTEm7OaV0iBtsiGs",
    authDomain: "fitdata-7a86b.firebaseapp.com",
    projectId: "fitdata-7a86b",
    storageBucket: "fitdata-7a86b.firebasestorage.app",
    messagingSenderId: "949628013924",
    appId: "1:949628013924:web:86278ae2c2bafb384d7e71"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const ADMIN = "toni@fitdatapro.es";
const CODE = "fityhab";

let audioCtx = null;
let currentUser=null, userData=null, activeWorkout=null, timerInt=null, restTimeRemaining=0, wakeLock=null, chartInstance=null, progressChart=null, selectedUserCoach=null, selectedUserObj=null, editingRoutineId=null, coachChart=null, currentPose='front', coachCurrentPose='front', allRoutinesCache=[], adminUnsub=null;
let currentRoutineSelections = [];

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

function getExerciseData(name) {
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
        return { img: img, mInfo: getMuscleInfoByGroup(m) };
    }
    return { img: match.img, mInfo: getMuscleInfoByGroup(match.m) };
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

onAuthStateChanged(auth, async (user) => {
    if(user) {
        currentUser = user;
        const snap = await getDoc(doc(db,"users",user.uid));
        if(snap.exists()){
            userData = snap.data();
            checkPhotoReminder();
            
            if(userData.role !== 'admin' && !sessionStorage.getItem('notif_dismissed')) {
                const routinesSnap = await getDocs(query(collection(db, "routines"), where("assignedTo", "array-contains", user.uid)));
                if(!routinesSnap.empty) {
                    document.getElementById('notif-badge').style.display = 'block';
                }
            }

            if(userData.email === ADMIN){
                document.getElementById('coach-btn').classList.remove('hidden');
                document.getElementById('coach-btn').onclick = () => { window.loadAdminUsers(); switchTab('admin-view'); };
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
                } else {
                    switchTab('routines-view');
                }

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
    const email = prompt("Introduce tu email para restablecer la contraseña:");
    if(email) {
        try {
            await sendPasswordResetEmail(auth, email);
            alert("📧 Correo enviado. Revisa tu bandeja de entrada.");
        } catch(e) {
            alert("Error: " + e.message);
        }
    }
};

window.dismissNotif = () => {
    document.getElementById('notif-badge').style.display = 'none';
    switchTab('routines-view');
    sessionStorage.setItem('notif_dismissed', 'true');
};

async function loadRoutines() {
    const l = document.getElementById('routines-list'); l.innerHTML = 'Cargando...';
    onSnapshot(query(collection(db,"routines")), (s)=>{
        l.innerHTML = '';
        s.forEach(d=>{
            const r = d.data();
            if(r.uid===currentUser.uid || (r.assignedTo && r.assignedTo.includes(currentUser.uid))){
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
    const filtered = EXERCISES.filter(e => e.n.toLowerCase().includes(t.toLowerCase()));
    renderExercises(filtered);
};

function renderExercises(l) {
    const c = document.getElementById('exercise-selector-list'); c.innerHTML = '';
    l.forEach(e => {
        const d = document.createElement('div'); 
        d.className = 'ex-select-item';
        if(currentRoutineSelections.includes(e.n)) d.classList.add('selected');
        d.innerHTML = `<img src="${e.img}" onerror="this.src='logo.png'"><span>${e.n}</span>`;
        d.onclick = () => {
            if(currentRoutineSelections.includes(e.n)) {
                currentRoutineSelections = currentRoutineSelections.filter(x => x !== e.n);
                d.classList.remove('selected');
            } else {
                currentRoutineSelections.push(e.n);
                d.classList.add('selected');
            }
            renderSelectedSummary();
        };
        c.appendChild(d);
    });
}

function renderSelectedSummary() {
    const div = document.getElementById('selected-summary');
    div.innerHTML = '';
    currentRoutineSelections.forEach(name => {
        const pill = document.createElement('div');
        pill.className = 'summary-pill';
        pill.innerHTML = `<span>${name}</span> <b onclick="removeSelection('${name}')">✕</b>`;
        div.appendChild(pill);
    });
}

window.removeSelection = (name) => {
    currentRoutineSelections = currentRoutineSelections.filter(x => x !== name);
    renderSelectedSummary();
    const searchVal = document.getElementById('ex-search').value;
    window.filterExercises(searchVal); 
}

window.saveRoutine = async () => {
    const n = document.getElementById('editor-name').value;
    const s = currentRoutineSelections;
    if(!n || s.length===0) return alert("❌ Faltan datos: Pon un nombre y elige ejercicios.");
    const btn = document.getElementById('btn-save-routine');
    const originalText = btn.innerText;
    btn.innerText = "💾 GUARDANDO...";
    try {
        const data = { uid:currentUser.uid, name:n, exercises:s, createdAt:serverTimestamp(), assignedTo: [] };
        if(editingRoutineId) await updateDoc(doc(db,"routines",editingRoutineId), {name:n, exercises:s});
        else await addDoc(collection(db,"routines"), data);
        switchTab('routines-view');
    } catch(e) {
        alert("Error al guardar: " + e.message);
    } finally {
        btn.innerText = originalText;
    }
};

window.delRoutine = async (id) => { if(confirm("¿Borrar?")) await deleteDoc(doc(db,"routines",id)); };

window.switchPose = (pose) => {
    currentPose = pose;
    document.getElementById('tab-front').classList.toggle('active', pose==='front');
    document.getElementById('tab-back').classList.toggle('active', pose==='back');
    updatePhotoDisplay(userData); 
};

function updatePhotoDisplay(u) {
    const prefix = currentPose === 'front' ? '' : '_back';
    const before = u[`photoBefore${prefix}`] || '';
    const after = u[`photoAfter${prefix}`] || '';
    const dateB = u[`dateBefore${prefix}`] || '-';
    const dateA = u[`dateAfter${prefix}`] || '-';
    const imgB = document.getElementById('img-before'); 
    const imgA = document.getElementById('img-overlay'); 
    if(before) imgB.src = before; else imgB.src = ""; 
    if(after) imgA.src = after; else imgA.src = ""; 
    document.getElementById('date-before').innerText = `ANTES (${dateB})`;
    document.getElementById('date-after').innerText = `AHORA (${dateA})`;
    document.getElementById('slider-handle').style.left = '0%';
    imgA.style.clipPath = 'inset(0 0 0 0)';
}

window.loadCompImg = (inp, field) => { 
    if(inp.files[0]) { 
        const r = new FileReader(); 
        r.onload = (e) => {
            const img = new Image();
            img.src = e.target.result;
            img.onload = async () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                const MAX_WIDTH = 600;
                const scale = MAX_WIDTH / img.width;
                canvas.width = MAX_WIDTH;
                canvas.height = img.height * scale;
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
                const prefix = currentPose === 'front' ? '' : '_back';
                const fieldName = field === 'before' ? `photoBefore${prefix}` : `photoAfter${prefix}`;
                const dateField = field === 'before' ? `dateBefore${prefix}` : `dateAfter${prefix}`;
                const today = new Date().toLocaleDateString();
                let update = {}; 
                update[fieldName] = dataUrl;
                update[dateField] = today;
                await updateDoc(doc(db, "users", currentUser.uid), update);
                userData[fieldName] = dataUrl;
                userData[dateField] = today;
                updatePhotoDisplay(userData);
            };
        }; 
        r.readAsDataURL(inp.files[0]); 
    } 
};

window.deletePhoto = async (type) => {
    if(!confirm("¿Borrar esta foto permanentemente?")) return;
    const prefix = currentPose === 'front' ? '' : '_back';
    const fieldPhoto = type === 'before' ? `photoBefore${prefix}` : `photoAfter${prefix}`;
    const fieldDate = type === 'before' ? `dateBefore${prefix}` : `dateAfter${prefix}`;
    let update = {};
    update[fieldPhoto] = "";
    update[fieldDate] = "";
    await updateDoc(doc(db, "users", currentUser.uid), update);
    userData[fieldPhoto] = "";
    userData[fieldDate] = "";
    updatePhotoDisplay(userData);
}

window.moveSlider = (v) => { 
    document.getElementById('img-overlay').style.clipPath = `inset(0 0 0 ${v}%)`; 
    document.getElementById('slider-handle').style.left = `${v}%`; 
};

window.moveCoachSlider = (v) => { 
    document.getElementById('coach-overlay-img').style.clipPath = `inset(0 0 0 ${v}%)`; 
    document.getElementById('coach-slider-handle').style.left = `${v}%`; 
};

window.openProgress = () => {
    document.getElementById('modal-progress').classList.add('active');
    const s = document.getElementById('progress-select');
    s.innerHTML = '<option value="">Selecciona ejercicio...</option>';
    EXERCISES.sort((a,b)=>a.n.localeCompare(b.n)).forEach(e => {
        const o = document.createElement('option'); o.value = e.n; o.innerText = e.n; s.appendChild(o);
    });
};

window.renderProgressChart = async (exName) => {
    if(!exName) return;
    const ctx = document.getElementById('progressChart');
    if(progressChart) progressChart.destroy();

    const q = query(collection(db, "workouts"), where("uid", "==", currentUser.uid));
    const snap = await getDocs(q);
    
    let dataPoints = [];
    snap.forEach(doc => {
        const d = doc.data();
        if(d.details) {
            const exData = d.details.find(e => e.n === exName);
            if(exData && exData.s) {
                let maxW = 0;
                exData.s.forEach(set => { if(parseInt(set.w) > maxW) maxW = parseInt(set.w); });
                if(maxW > 0) {
                    dataPoints.push({
                        x: d.date ? new Date(d.date.seconds*1000).toLocaleDateString() : '?',
                        y: maxW,
                        rawDate: d.date ? d.date.seconds : 0
                    });
                }
            }
        }
    });

    dataPoints.sort((a,b) => a.rawDate - b.rawDate);

    progressChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: dataPoints.map(p => p.x),
            datasets: [{
                label: 'Kg Máximos',
                data: dataPoints.map(p => p.y),
                borderColor: '#ff3333',
                backgroundColor: 'rgba(255,51,51,0.1)',
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            plugins: { legend: { display: false } },
            scales: { y: { grid: { color: '#333' } }, x: { display: false } },
            maintainAspectRatio: false
        }
    });
};

async function loadProfile() {
    document.getElementById('profile-name').innerText = userData.name;
    if(userData.photo) { document.getElementById('avatar-text').style.display='none'; document.getElementById('avatar-img').src = userData.photo; document.getElementById('avatar-img').style.display='block'; }
    updatePhotoDisplay(userData);
    if(userData.restTime) document.getElementById('cfg-rest-time').value = userData.restTime;
    if(userData.stats) {
        document.getElementById('stat-workouts').innerText = userData.stats.workouts || 0;
        document.getElementById('stat-kg').innerText = userData.stats.totalKg ? (userData.stats.totalKg/1000).toFixed(1)+'t' : 0;
        document.getElementById('stat-sets').innerText = userData.stats.totalSets || 0;
        document.getElementById('stat-reps').innerText = userData.stats.totalReps || 0;
    }
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
    const ctx = document.getElementById('weightChart'); 
    if(chartInstance) chartInstance.destroy();
    const rawData = userData.weightHistory;
    const data = (rawData && rawData.length > 0) ? rawData : [70]; 
    chartInstance = new Chart(ctx, { 
        type:'line', 
        data:{ labels:data.map((_,i)=>`T${i}`), datasets:[{label:'Kg', data:data, borderColor:'#ff3333', backgroundColor:'rgba(255,51,51,0.1)', fill:true, tension:0.4}] }, 
        options:{plugins:{legend:{display:false}}, scales:{x:{display:false},y:{grid:{color:'#333'}}}, maintainAspectRatio:false} 
    });

    const histDiv = document.getElementById('user-history-list');
    histDiv.innerHTML = "Cargando...";
    try {
        const q = query(collection(db, "workouts"), where("uid", "==", currentUser.uid));
        const snap = await getDocs(q);
        const workouts = snap.docs.map(d => ({id:d.id, ...d.data()}))
                                .sort((a,b) => b.date - a.date)
                                .slice(0, 5);
        
        histDiv.innerHTML = "";
        if(workouts.length === 0) histDiv.innerHTML = "Sin historial aún.";
        
        workouts.forEach(d => {
            const date = d.date ? new Date(d.date.seconds*1000).toLocaleDateString() : '-';
            const detailsStr = d.details ? encodeURIComponent(JSON.stringify(d.details)) : "";
            const noteStr = d.note ? encodeURIComponent(d.note) : "";
            const btnVer = d.details ? `<button class="btn-small btn-outline" style="margin:0; padding:2px 6px;" onclick="viewWorkoutDetails('${d.routine}', '${detailsStr}', '${noteStr}')">🔍</button>` : '';
            histDiv.innerHTML += `
                <div class="history-row" style="grid-template-columns: 1fr 40px;">
                    <div><span style="color:#accent-color">${date}</span> - ${d.routine}</div>
                    <div style="text-align:right;">${btnVer}</div>
                </div>`;
        });
    } catch(e) { console.error(e); histDiv.innerHTML = "Error cargando historial."; }
}

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
window.uploadAvatar = (inp) => { if(inp.files[0]) { const r = new FileReader(); r.onload=async(e)=>{ await updateDoc(doc(db,"users",currentUser.uid), {photo:e.target.result}); loadProfile(); }; r.readAsDataURL(inp.files[0]); } };

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
        loadProfile(); 
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
    const snap = await getDoc(doc(db,"routines",rid));
    const r = snap.data();

    let lastWorkoutData = null;
    try {
        const q = query(collection(db, "workouts"), where("uid", "==", currentUser.uid));
        const wSnap = await getDocs(q);
        const sameRoutine = wSnap.docs.map(d=>d.data())
                            .filter(d => d.routine === r.name)
                            .sort((a,b) => b.date - a.date); 
        
        if(sameRoutine.length > 0 && sameRoutine[0].details) {
            lastWorkoutData = sameRoutine[0].details;
        }
    } catch(e) { console.log("No historial previo"); }

    activeWorkout = { name: r.name, exs: r.exercises.map(n => {
        const data = getExerciseData(n);
        
        let sets = Array(5).fill().map((_,i)=>({r: i===0 ? 20 : 16, w:0, d:false, prev:'-'}));

        if(lastWorkoutData) {
            const prevEx = lastWorkoutData.find(ld => ld.n === n);
            if(prevEx && prevEx.s) {
                sets = sets.map((s, i) => {
                    if(prevEx.s[i]) {
                        s.prev = `${prevEx.s[i].r} x ${prevEx.s[i].w}kg`; 
                    }
                    return s;
                });
            }
        }

        return { n:n, img:data.img, mInfo: data.mInfo, sets: sets }; 
    })};
    
    saveLocalWorkout(); 
    renderWorkout();
    switchTab('workout-view');
    startTimerMini();
};

window.addSet = (exIdx) => {
    activeWorkout.exs[exIdx].sets.push({r:16, w:0, d:false, prev:'-'}); 
    saveLocalWorkout();
    renderWorkout();
};

window.removeSet = (exIdx) => {
    if(activeWorkout.exs[exIdx].sets.length > 1) {
        activeWorkout.exs[exIdx].sets.pop();
        saveLocalWorkout();
        renderWorkout();
    }
};

function renderWorkout() {
    const c = document.getElementById('workout-exercises'); c.innerHTML = '';
    document.getElementById('workout-title').innerText = activeWorkout.name;
    activeWorkout.exs.forEach((e,i) => {
        const card = document.createElement('div'); card.className = 'card'; card.style.borderLeft="3px solid var(--accent-color)";
        let bars = `<div class="mini-bar-label"><span>${e.mInfo.main}</span><span>100%</span></div><div class="mini-track"><div class="mini-fill fill-primary"></div></div>`;
        e.mInfo.sec.forEach(s => { bars += `<div class="mini-bar-label" style="margin-top:4px;"><span>${s}</span><span>40%</span></div><div class="mini-track"><div class="mini-fill fill-sec"></div></div>`; });
        let setsHtml = `<div class="set-header"><div>#</div><div>PREV</div><div>REPS</div><div>KG</div><div></div></div>`;
        e.sets.forEach((s,j) => {
            const weightVal = s.w === 0 ? '' : s.w;
            setsHtml += `<div class="set-row">
                <div class="set-num">${j+1}</div>
                <div class="prev-data">${s.prev}</div>
                <div><input type="number" value="${s.r}" onchange="uS(${i},${j},'r',this.value)"></div>
                <div><input type="number" placeholder="kg" value="${weightVal}" onchange="uS(${i},${j},'w',this.value)"></div>
                <button id="btn-${i}-${j}" class="btn-outline ${s.d?'btn-done':''}" style="margin:0;padding:0;height:35px;" onclick="tS(${i},${j})">${s.d?'✓':''}</button>
            </div>`;
        });
        setsHtml += `<div class="sets-actions"><button class="btn-set-control" onclick="removeSet(${i})">- Serie</button><button class="btn-set-control" onclick="addSet(${i})">+ Serie</button></div>`;
        card.innerHTML = `<div class="workout-split"><div class="workout-visual"><img src="${e.img}" onerror="this.src='logo.png'"></div><div class="workout-bars" style="width:100%">${bars}</div></div><h3 style="margin-bottom:10px; border:none;">${e.n}</h3>${setsHtml}`;
        c.appendChild(card);
    });
}

window.uS = (i,j,k,v) => { 
    activeWorkout.exs[i].sets[j][k]=v;
    saveLocalWorkout();
};

window.tS = (i,j) => {
    const s = activeWorkout.exs[i].sets[j]; s.d = !s.d;
    saveLocalWorkout();
    const btn = document.getElementById(`btn-${i}-${j}`);
    if(s.d) {
        btn.classList.add('btn-done');
        btn.innerText = '✓';
        openRest();
    } else {
        btn.classList.remove('btn-done');
        btn.innerText = '';
    }
};

function openRest() {
    const m = document.getElementById('modal-timer'); m.classList.add('active');
    const rest = userData.restTime || 60;
    restTimeRemaining = rest;
    document.getElementById('timer-display').innerText = restTimeRemaining;
    if(timerInt) clearInterval(timerInt);
    timerInt = setInterval(() => {
        restTimeRemaining--;
        document.getElementById('timer-display').innerText = restTimeRemaining;
        if(restTimeRemaining <= 0) {
            clearInterval(timerInt); m.classList.remove('active');
            if(document.getElementById('cfg-sound').checked) {
                play5Beeps();
            }
        }
    }, 1000);
}
window.closeTimer = () => { clearInterval(timerInt); document.getElementById('modal-timer').classList.remove('active'); };
window.addRestTime = (s) => { 
    restTimeRemaining += s; 
    document.getElementById('timer-display').innerText = restTimeRemaining; 
};

function startTimerMini() { const d=document.getElementById('mini-timer'); const s=Date.now(); setInterval(()=>{const df=Math.floor((Date.now()-s)/1000); d.innerText=`${Math.floor(df/60)}:${(df%60).toString().padStart(2,'0')}`;},1000); }

window.promptRPE = () => {
    document.getElementById('workout-notes').value = ''; 
    document.getElementById('modal-rpe').classList.add('active');
};

window.finishWorkout = async (rpeVal) => {
    document.getElementById('modal-rpe').classList.remove('active');
    const note = document.getElementById('workout-notes').value; 
    let s=0, r=0, k=0;
    let muscleCounts = {};
    let prAlert = ""; 

    const cleanLog = activeWorkout.exs.map(e => {
        return {
            n: e.n, 
            s: e.sets.filter(set => set.d).map(set => ({ r: set.r, w: set.w })) 
        };
    }).filter(e => e.s.length > 0); 

    if(!userData.prs) userData.prs = {};
    activeWorkout.exs.forEach(e => {
        e.sets.forEach(st => { 
            if(st.d) { 
                s++; r+=parseInt(st.r)||0; 
                const weight = parseInt(st.w)||0;
                k+=weight*(parseInt(st.r)||0); 
                const mName = e.mInfo.main;
                muscleCounts[mName] = (muscleCounts[mName] || 0) + 1;
                if(weight > (userData.prs[e.n] || 0)) {
                    userData.prs[e.n] = weight;
                    prAlert = `🏆 RÉCORD: ${e.n} (${weight}kg)\n`;
                }
            }
        });
    });
    if(prAlert) alert(prAlert); 

    await addDoc(collection(db,"workouts"), {
        uid:currentUser.uid, 
        date:serverTimestamp(), 
        routine:activeWorkout.name, 
        rpe: rpeVal,
        note: note,
        details: cleanLog 
    });
    
    const updates = { 
        "stats.workouts": increment(1), "stats.totalSets": increment(s), "stats.totalReps": increment(r), "stats.totalKg": increment(k), "prs": userData.prs 
    };
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
    l.innerHTML = '<div style="text-align:center;padding:20px;color:#888;">↻ Cargando atletas...</div>';
    try {
        const s = await getDocs(collection(db, "users"));
        l.innerHTML = '';
        if (s.empty) { l.innerHTML = '<div style="text-align:center;padding:20px;">Sin atletas.</div>'; return; }
        s.forEach(d => {
            const u = d.data(); if(u.email === ADMIN) return;
            const div = document.createElement('div');
            div.className = "admin-user-row";
            const statusIcon = u.approved ? '🟢' : '⏳';
            div.innerHTML=`<div><strong>${u.name}</strong><br><small>${statusIcon} ${u.email}</small></div><button class="btn-outline btn-small" style="width:auto;">⚙️ FICHA</button>`;
            div.onclick=()=>openCoachView(d.id,u); 
            l.appendChild(div);
        });
    } catch (e) { l.innerHTML = '<div style="text-align:center;color:red;padding:20px;">Error.</div>'; }
};

window.loadAdminLibrary = async () => {
    const l = document.getElementById('admin-lib-list');
    l.innerHTML = '<div style="text-align:center;padding:20px;color:#888;">↻ Cargando librería...</div>';
    try {
        const uSnap = await getDocs(collection(db, "users"));
        const userMap = {};
        uSnap.forEach(u => userMap[u.id] = u.data().name);

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
            else if(r.uid === 'admin' || r.uid === ADMIN) author = "Admin";
            else author = "Usuario " + r.uid.substr(0,4);

            div.innerHTML = `
                <div style="flex:1;">
                    <b>${r.name}</b><br>
                    <span style="font-size:0.7rem; color:#666;">Creado por: ${author}</span>
                </div>
                <div style="display:flex; gap:10px;">
                    <button class="btn-small btn-outline" style="margin:0; width:auto;" onclick="viewRoutineContent('${r.name}','${dataStr}')">👁️</button>
                    <button class="btn-small btn-danger" style="margin:0; width:auto; border:none;" onclick="delRoutine('${d.id}')">🗑️</button>
                </div>
            `;
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

async function openCoachView(uid,u) {
    selectedUserCoach=uid;
    const freshSnap = await getDoc(doc(db, "users", uid));
    const freshU = freshSnap.data();
    selectedUserObj = freshU; 
    switchTab('coach-detail-view');
    document.getElementById('coach-user-name').innerText=freshU.name;
    document.getElementById('coach-user-email').innerText=freshU.email;
    const banner = document.getElementById('pending-approval-banner');
    if(!freshU.approved) { banner.classList.remove('hidden'); } else { banner.classList.add('hidden'); }
    const img = document.getElementById('coach-user-img');
    const initial = document.getElementById('coach-user-initial');
    if(freshU.photo) { img.src = freshU.photo; img.style.display = 'block'; initial.style.display = 'none'; } else { img.style.display = 'none'; initial.style.display = 'block'; }
    updateCoachPhotoDisplay('front');

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
        coachChart = new Chart(ctx, { type:'line', data:{ labels:data.map((_,i)=>i+1), datasets:[{label:'Kg', data:data, borderColor:'#ff3333', fill:false}] }, options:{plugins:{legend:{display:false}}, scales:{x:{display:false},y:{grid:{color:'#333'}}}, maintainAspectRatio: false}});

        const hList = document.getElementById('coach-history-list');
        hList.innerHTML = 'Cargando historial...';
        const qH = query(collection(db,"workouts"), where("uid","==",uid));
        const wSnap = await getDocs(qH);
        
        hList.innerHTML = '';
        if(wSnap.empty) {
            hList.innerHTML='Sin datos recientes.';
        } else {
            const sortedDocs = wSnap.docs.map(doc => ({id: doc.id, ...doc.data()}))
                                           .sort((a,b) => b.date - a.date)
                                           .slice(0, 10);

            sortedDocs.forEach(d => {
                const date = d.date ? new Date(d.date.seconds*1000).toLocaleDateString() : '-';
                let rpeBadge = d.rpe === 'Suave' ? '<span class="badge green">🟢</span>' : (d.rpe === 'Duro' ? '<span class="badge orange">🟠</span>' : (d.rpe === 'Fallo' ? '<span class="badge red">🔴</span>' : '<span class="badge gray">-</span>'));
                const detailsStr = d.details ? encodeURIComponent(JSON.stringify(d.details)) : "";
                const noteStr = d.note ? encodeURIComponent(d.note) : "";
                const btnVer = d.details ? `<button class="btn-small btn-outline" style="margin:0; padding:2px 6px;" onclick="viewWorkoutDetails('${d.routine}', '${detailsStr}', '${noteStr}')">Ver Detalles</button>` : '';

                hList.innerHTML += `<div class="history-row" style="grid-template-columns: 60px 1fr 30px 80px;"><div class="hist-date">${date}</div><div class="hist-name" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${d.routine}</div><div class="hist-rpe">${rpeBadge}</div><div>${btnVer}</div></div>`;
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

window.approveUser = async () => {
    if(confirm("¿Confirmar acceso a este atleta?")) {
        await updateDoc(doc(db,"users",selectedUserCoach), {approved: true});
        alert("Atleta Aprobado ✅");
        openCoachView(selectedUserCoach, selectedUserObj); 
    }
};

window.renderCoachRoutines = (list) => {
    const s = document.getElementById('coach-routine-select'); s.innerHTML = '';
    list.forEach(r => { const o = document.createElement('option'); o.value = r.id; o.innerText = r.name; s.appendChild(o); });
};

window.filterCoachRoutines = (val) => {
    const filtered = allRoutinesCache.filter(r => r.name.toLowerCase().includes(val.toLowerCase()));
    renderCoachRoutines(filtered);
};

window.switchCoachPose = (pose) => {
    coachCurrentPose = pose;
    document.getElementById('coach-tab-front').classList.toggle('active', pose==='front');
    document.getElementById('coach-tab-back').classList.toggle('active', pose==='back');
    updateCoachPhotoDisplay(pose);
};

function updateCoachPhotoDisplay(pose) {
    const u = selectedUserObj;
    if(!u) return;
    const prefix = pose === 'front' ? '' : '_back';
    const b = u[`photoBefore${prefix}`];
    const a = u[`photoAfter${prefix}`];
    const dateB = u[`dateBefore${prefix}`] || '-';
    const dateA = u[`dateAfter${prefix}`] || '-';
    const pCont = document.getElementById('coach-photos-container');
    pCont.innerHTML = `<div class="compare-wrapper"><div class="slider-labels"><span class="label-tag">ANTES</span><span class="label-tag">AHORA</span></div><img src="${b || ''}" class="compare-img"><img src="${a || ''}" id="coach-overlay-img" class="compare-img img-overlay" style="clip-path:inset(0 0 0 0)"><div class="slider-handle" id="coach-slider-handle" style="left:0%"><div class="slider-btn"></div></div></div><input type="range" min="0" max="100" value="0" style="width:100%; margin-top:15px;" oninput="moveCoachSlider(this.value)"><div style="display:flex; justify-content:space-between; font-size:0.7rem; color:#888;"><span>ANTES (${dateB})</span><span>AHORA (${dateA})</span></div>`;
}

window.moveCoachSlider = (v) => {
    document.getElementById('coach-overlay-img').style.clipPath = `inset(0 0 0 ${v}%)`;
    document.getElementById('coach-slider-handle').style.left = `${v}%`;
};

window.goToCreateRoutine = () => {
    switchTab('routines-view'); 
    openEditor(); 
};

window.assignRoutine = async () => {
    const rid=document.getElementById('coach-routine-select').value; if(!rid||!selectedUserCoach)return;
    const rRef=doc(db,"routines",rid); 
    await updateDoc(rRef,{assignedTo: arrayUnion(selectedUserCoach)}); 
    alert("Rutina Asignada");
    openCoachView(selectedUserCoach, selectedUserObj); 
};

window.unassignRoutine = async (rid) => {
    if(confirm("¿Quitar esta rutina al atleta?")) {
        await updateDoc(doc(db, "routines", rid), { assignedTo: arrayRemove(selectedUserCoach) });
        openCoachView(selectedUserCoach, selectedUserObj); 
    }
};

window.deleteUser = async () => {
    if(confirm("⚠ ¿ELIMINAR ATLETA DEFINITIVAMENTE?")) {
        if(confirm("Esta acción borrará todo su historial y acceso. ¿Proceder?")) {
            try {
                await deleteDoc(doc(db, "users", selectedUserCoach));
                alert("Atleta eliminado.");
                switchTab('admin-view');
                window.loadAdminUsers();
            } catch(e) { alert("Error: " + e.message); }
        }
    }
};

document.getElementById('btn-login').onclick=()=>signInWithEmailAndPassword(auth,document.getElementById('login-email').value,document.getElementById('login-pass').value).catch(e=>alert(e.message));
document.getElementById('btn-register').onclick=async()=>{
    if(document.getElementById('reg-code').value!==CODE)return alert("Código incorrecto");
    try{ const c=await createUserWithEmailAndPassword(auth,document.getElementById('reg-email').value,document.getElementById('reg-pass').value);
    // CRITICAL FIX: Ensure user object has ALL fields to prevent permission errors
    await setDoc(doc(db,"users",c.user.uid),{
        name:document.getElementById('reg-name').value,
        email:document.getElementById('reg-email').value,
        approved:document.getElementById('reg-email').value===ADMIN,
        age:parseInt(document.getElementById('reg-age').value),
        height:parseInt(document.getElementById('reg-height').value), 
        weightHistory: [],
        prs: {}, // Fixed: Initialize PRs object
        stats: {workouts:0, totalKg:0, totalSets:0, totalReps:0},
        muscleStats: {},
        joined: serverTimestamp()
    });
    }catch(e){alert(e.message)}
};