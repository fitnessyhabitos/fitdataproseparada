import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, getDoc, updateDoc, onSnapshot, query, where, addDoc, deleteDoc, getDocs, serverTimestamp, increment, orderBy, limit, arrayRemove, arrayUnion } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-storage.js";
import { EXERCISES } from './data.js';

console.log("⚡ FIT DATA: Iniciando App con Menu Responsive y Notificaciones...");

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
let restNotificationShown = false; // PARA EVITAR NOTIFICACIONES DUPLICADAS

const normalizeText = (text) => {
  if(!text) return "";
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
};

window.toggleElement = (id) => {
  const el = document.getElementById(id);
  if(el) el.classList.toggle('hidden');
};

// ========== AUDIO SETUP ==========
function unlockAudio() {
  if(!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContext();
  }
  if(audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
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
      osc.type = 'square';
      osc.frequency.value = 880;
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      const start = now + (i * 0.6);
      const end = start + 0.15;
      osc.start(start);
      osc.stop(end);
      gain.gain.setValueAtTime(0.5, start);
      gain.gain.exponentialRampToValueAtTime(0.01, end);
    }
  }
}

window.testSound = () => { play5Beeps(); };

// ========== NOTIFICACIONES WEB API ==========
window.enableNotifications = () => {
  if (!(("Notification" in window))) {
    alert("Tu dispositivo no soporta notificaciones web.");
    return;
  }

  Notification.requestPermission().then((permission) => {
    if (permission === "granted") {
      alert("✅ Vinculado. El reloj vibrará al acabar.");
      new Notification("Fit Data", {
        body: "Prueba de conexión exitosa.",
        icon: "logo.png",
        tag: "fitdata-test",
        requireInteraction: false
      });
    } else {
      alert("❌ Permiso denegado. Revisa la configuración.");
    }
  });
};

// MOSTRAR NOTIFICACIÓN DE DESCANSO
function showRestNotification(secondsRemaining) {
  if (restNotificationShown) return; // Evitar duplicadas
  restNotificationShown = true;

  if (("Notification" in window) && Notification.permission === "granted") {
    const notif = new Notification("🛑 ¡DESCANSO TERMINADO!", {
      body: `Tu tiempo de descanso ha finalizado. ¡A por el siguiente set!`,
      icon: "logo.png",
      tag: "fitdata-rest",
      requireInteraction: true,
      badge: "logo.png"
    });

    // Cerrar notificación automáticamente después de 5 segundos
    setTimeout(() => {
      notif.close();
    }, 5000);
  }
}

// MOSTRAR NOTIFICACIÓN DE RECORDATORIO DE FOTOS
function showPhotoReminder() {
  if (("Notification" in window) && Notification.permission === "granted") {
    const notif = new Notification("📸 ¡HORA DE TU FOTO DE PROGRESO!", {
      body: `Es momento de tomar tu foto de progreso. Mantén la consistencia.`,
      icon: "logo.png",
      tag: "fitdata-photo",
      requireInteraction: true,
      badge: "logo.png"
    });

    setTimeout(() => {
      notif.close();
    }, 10000);
  }
}

// VERIFICAR RECORDATORIO DE FOTOS PERIÓDICAMENTE
function checkPhotoReminder() {
  if(!userData || !userData.photoDay) return;
  
  const now = new Date();
  const day = now.getDay().toString();
  const time = now.toTimeString().substr(0,5);

  if(day === userData.photoDay && time === userData.photoTime) {
    showPhotoReminder();
  }
}

// Chequear foto cada minuto
setInterval(() => {
  if(currentUser && userData) {
    checkPhotoReminder();
  }
}, 60000);

// ========== AUTH HANDLERS ==========
onAuthStateChanged(auth, async (user) => {
  if(user) {
    currentUser = user;
    const snap = await getDoc(doc(db,"users",user.uid));
    if(snap.exists()){
      userData = snap.data();
      
      // COACH BUTTON
      if(userData.role === 'admin' || userData.role === 'assistant') {
        const btn = document.getElementById('top-btn-coach');
        if(btn) btn.classList.remove('hidden');
      }

      // NOTIFICACIÓN BADGE
      if(userData.role !== 'admin' && userData.role !== 'assistant' && !sessionStorage.getItem('notif_dismissed')) {
        const routinesSnap = await getDocs(query(collection(db, "routines"), where("assignedTo", "array-contains", user.uid)));
        if(!routinesSnap.empty) document.getElementById('notif-badge').style.display = 'block';
      }

      if(userData.approved){
        setTimeout(() => {
          document.getElementById('loading-screen').classList.add('hidden');
        }, 1500);
        document.getElementById('main-header').classList.remove('hidden');
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
      } else {
        alert("Cuenta en revisión.");
        signOut(auth);
      }
    }
  } else {
    setTimeout(() => {
      document.getElementById('loading-screen').classList.add('hidden');
    }, 1500);
    switchTab('auth-view');
    document.getElementById('main-header').classList.add('hidden');
  }
});

// ========== SWITCH TAB ==========
window.switchTab = (t) => {
  document.querySelectorAll('.view-container').forEach(e => e.classList.remove('active'));
  document.getElementById(t).classList.add('active');
  document.getElementById('main-container').scrollTop = 0;
  
  document.querySelectorAll('.top-nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.bottom-nav-item').forEach(n => n.classList.remove('active'));
  
  if (t === 'routines-view') {
    document.getElementById('top-btn-routines')?.classList.add('active');
    document.querySelectorAll('.bottom-nav-item')[0]?.classList.add('active');
  }
  if (t === 'profile-view') {
    document.getElementById('top-btn-profile')?.classList.add('active');
    document.querySelectorAll('.bottom-nav-item')[1]?.classList.add('active');
    loadProfile();
  }
  if (t === 'admin-view' || t === 'coach-detail-view') {
    const btnCoach = document.getElementById('top-btn-coach');
    if(btnCoach) btnCoach.classList.add('active');
  }
};

window.switchAdminTab = (tab) => {
  document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.remove('active'));
  
  event.target.classList.add('active');
  document.getElementById(tab + '-tab').classList.add('active');
};

window.switchPhotoTab = (pose) => {
  currentPose = pose;
  loadPhotoComparison();
};

// ========== AUTH HANDLERS ==========
window.handleLogin = async () => {
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;

  if(!email || !password) {
    alert("Completa todos los campos");
    return;
  }

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch(e) {
    alert("Error: " + e.message);
  }
};

window.handleRegister = async () => {
  const email = document.getElementById('register-email').value;
  const password = document.getElementById('register-password').value;
  const confirm = document.getElementById('register-confirm').value;
  const role = document.getElementById('register-role').value;

  if(!email || !password || !confirm) {
    alert("Completa todos los campos");
    return;
  }

  if(password !== confirm) {
    alert("Las contraseñas no coinciden");
    return;
  }

  try {
    const userCred = await createUserWithEmailAndPassword(auth, email, password);
    await setDoc(doc(db, "users", userCred.user.uid), {
      email: email,
      role: role,
      approved: role === 'athlete' ? false : true,
      createdAt: new Date()
    });
    alert("Cuenta creada. Espera aprobación del admin.");
    window.toggleAuth('login');
  } catch(e) {
    alert("Error: " + e.message);
  }
};

window.toggleAuth = (m) => {
  document.getElementById('login-form').classList.toggle('hidden', m !== 'login');
  document.getElementById('register-form').classList.toggle('hidden', m !== 'register');
};

window.logout = () => signOut(auth).then(() => location.reload());

window.recoverPass = async () => {
  const email = prompt("Introduce tu email:");
  if(email) {
    try {
      await sendPasswordResetEmail(auth, email);
      alert("📧 Correo enviado.");
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

// ========== FUNCIONES DE UTILIDAD ==========
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
    else if(n.includes("isquio")||n.includes("peso muerto")) { m="Isquios"; img="isquios.png"; }
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

// ========== RUTINAS ==========
async function loadRoutines() {
  const l = document.getElementById('routines-list');
  l.innerHTML = 'Cargando...';

  onSnapshot(query(collection(db,"routines")), (s) => {
    l.innerHTML = '';
    s.forEach(d => {
      const r = d.data();
      if(r.uid === currentUser.uid || userData.role === 'admin' || (r.assignedTo && r.assignedTo.includes(currentUser.uid))) {
        const isMine = r.uid === currentUser.uid;
        const div = document.createElement('div');
        div.className = 'card';
        div.innerHTML = `
          <h3>${r.name}</h3>
          <p>${r.exercises.length} Ejercicios</p>
          ${isMine ? `<button class="btn-small" onclick="window.openEditor('${d.id}')">Editar</button>` : ''}
        `;
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
  const c = document.getElementById('exercise-selector-list');
  c.innerHTML = '';
  
  l.forEach(e => {
    const d = document.createElement('div');
    d.className = 'ex-select-item';
    if(currentRoutineSelections.includes(e.n)) d.classList.add('selected');
    
    d.innerHTML = `
      <img src="${e.img}" alt="${e.n}">
      <div>
        <b>${e.n}</b>
        <p style="font-size: 0.7rem; color: #888; margin: 0;">${e.m}</p>
      </div>
    `;
    
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
    pill.innerHTML = `${name} <span onclick="window.removeExercise('${name}')">×</span>`;
    div.appendChild(pill);
  });
}

window.removeExercise = (name) => {
  currentRoutineSelections = currentRoutineSelections.filter(x => x !== name);
  renderSelectedSummary();
};

window.saveRoutine = async () => {
  const name = document.getElementById('editor-name').value;
  if(!name) { alert("Nombre requerido"); return; }
  if(currentRoutineSelections.length === 0) { alert("Selecciona ejercicios"); return; }

  try {
    if(editingRoutineId) {
      await updateDoc(doc(db,"routines",editingRoutineId), {
        name: name,
        exercises: currentRoutineSelections
      });
      alert("Rutina actualizada");
    } else {
      await addDoc(collection(db,"routines"), {
        uid: currentUser.uid,
        name: name,
        exercises: currentRoutineSelections,
        createdAt: serverTimestamp()
      });
      alert("Rutina guardada");
    }
    switchTab('routines-view');
  } catch(e) {
    alert("Error: " + e.message);
  }
};

// ========== TIMER Y WORKOUT ==========
function startTimerMini() {
  if(timerInt) clearInterval(timerInt);
  
  timerInt = setInterval(() => {
    if(!activeWorkout) return;

    const now = Date.now();
    const elapsed = Math.floor((now - activeWorkout.startTime) / 1000);
    const totalSecs = activeWorkout.duration || 0;

    document.getElementById('timer-main').innerText = formatTime(elapsed);

    // REST TIMER
    if(restEndTime > 0) {
      const restRemaining = Math.max(0, Math.floor((restEndTime - now) / 1000));
      document.getElementById('rest-counter').innerText = formatTime(restRemaining);

      if(restRemaining === 0 && restEndTime > 0) {
        restEndTime = 0;
        play5Beeps();
        showRestNotification(0); // MOSTRAR NOTIFICACIÓN
        restNotificationShown = false; // Reset para próximo descanso
      }
    }
  }, 100);
}

function formatTime(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

window.startRest = (seconds) => {
  restEndTime = Date.now() + (seconds * 1000);
  restNotificationShown = false; // Reset para nueva notificación
};

function renderWorkout() {
  if(!activeWorkout) return;

  const container = document.getElementById('workout-content');
  container.innerHTML = '';

  activeWorkout.exercises.forEach((ex, idx) => {
    const exData = getExerciseData(ex.name);
    const card = document.createElement('div');
    card.className = 'card';

    const setsHtml = ex.sets.map((set, setIdx) => `
      <div class="set-row">
        <div class="set-num">${setIdx + 1}</div>
        <input type="number" value="${set.reps || ''}" placeholder="Reps" onchange="window.updateSetReps(${idx}, ${setIdx}, this.value)">
        <input type="number" value="${set.weight || ''}" placeholder="Kg" onchange="window.updateSetWeight(${idx}, ${setIdx}, this.value)">
        <input type="number" value="${set.rpe || ''}" placeholder="RPE" onchange="window.updateSetRpe(${idx}, ${setIdx}, this.value)">
        <button class="btn-set-control" onclick="window.deleteSet(${idx}, ${setIdx})">✕</button>
      </div>
    `).join('');

    card.innerHTML = `
      <div class="workout-split">
        <div class="workout-visual">
          <img src="${exData.img}" alt="${ex.name}">
        </div>
        <div>
          <h4 style="margin-bottom: 5px;">${ex.name}</h4>
          <div style="font-size: 0.75rem; color: #888;">${exData.mInfo.main}</div>
        </div>
      </div>

      <div class="set-header">
        <div>Set</div>
        <div>Reps</div>
        <div>Kg</div>
        <div>RPE</div>
        <div></div>
      </div>
      ${setsHtml}

      <div class="sets-actions">
        <button class="btn-small btn-outline" style="margin: 0; margin-top: 10px;" onclick="window.addSet(${idx})">+ Set</button>
      </div>
    `;

    container.appendChild(card);
  });

  const finishBtn = document.createElement('button');
  finishBtn.className = 'btn btn-success';
  finishBtn.innerHTML = '✓ TERMINAR ENTRENO';
  finishBtn.onclick = () => window.finishWorkout();
  container.appendChild(finishBtn);
}

window.updateSetReps = (exIdx, setIdx, val) => {
  activeWorkout.exercises[exIdx].sets[setIdx].reps = parseInt(val) || 0;
  localStorage.setItem('fit_active_workout', JSON.stringify(activeWorkout));
};

window.updateSetWeight = (exIdx, setIdx, val) => {
  activeWorkout.exercises[exIdx].sets[setIdx].weight = parseFloat(val) || 0;
  localStorage.setItem('fit_active_workout', JSON.stringify(activeWorkout));
};

window.updateSetRpe = (exIdx, setIdx, val) => {
  activeWorkout.exercises[exIdx].sets[setIdx].rpe = parseFloat(val) || 0;
  localStorage.setItem('fit_active_workout', JSON.stringify(activeWorkout));
};

window.addSet = (exIdx) => {
  activeWorkout.exercises[exIdx].sets.push({ reps: 0, weight: 0, rpe: 0 });
  localStorage.setItem('fit_active_workout', JSON.stringify(activeWorkout));
  renderWorkout();
};

window.deleteSet = (exIdx, setIdx) => {
  activeWorkout.exercises[exIdx].sets.splice(setIdx, 1);
  localStorage.setItem('fit_active_workout', JSON.stringify(activeWorkout));
  renderWorkout();
};

window.finishWorkout = async () => {
  try {
    await addDoc(collection(db, "workouts"), {
      uid: currentUser.uid,
      routine: activeWorkout.routineName,
      exercises: activeWorkout.exercises,
      duration: Math.floor((Date.now() - activeWorkout.startTime) / 1000),
      completedAt: serverTimestamp()
    });

    localStorage.removeItem('fit_active_workout');
    activeWorkout = null;
    clearInterval(timerInt);

    alert("✓ Entreno guardado");
    switchTab('routines-view');
  } catch(e) {
    alert("Error: " + e.message);
  }
};

// ========== PROFILE ==========
async function loadProfile() {
  if(!userData) return;

  document.getElementById('profile-name').innerText = userData.email.split('@')[0];
  document.getElementById('profile-role').innerText = userData.role === 'admin' ? '🏆 COACH' : '💪 ATLETA';

  // SETTINGS
  document.getElementById('show-skinfolds').checked = userData.showSkinfolds || false;
  document.getElementById('show-measures').checked = userData.showMeasures || false;
  document.getElementById('rest-time').value = userData.restTime || 60;
  document.getElementById('enable-sound').checked = userData.enableSound !== false;
  document.getElementById('keep-awake').checked = userData.keepAwake || false;

  if(userData.photoDay) {
    document.getElementById('photo-day').value = userData.photoDay;
    document.getElementById('photo-time').value = userData.photoTime || '07:00';
  }

  // STATS
  const workoutsSnap = await getDocs(query(collection(db, "workouts"), where("uid", "==", currentUser.uid)));
  let totalWorkouts = workoutsSnap.size;
  let totalKg = 0;
  let totalSeries = 0;
  let totalReps = 0;

  workoutsSnap.forEach(doc => {
    const w = doc.data();
    w.exercises?.forEach(ex => {
      ex.sets?.forEach(set => {
        totalSeries++;
        totalReps += set.reps || 0;
        totalKg += (set.weight || 0) * (set.reps || 0);
      });
    });
  });

  document.getElementById('stat-workouts').innerText = totalWorkouts;
  document.getElementById('stat-kg').innerText = Math.round(totalKg);
  document.getElementById('stat-series').innerText = totalSeries;
  document.getElementById('stat-reps').innerText = totalReps;
}

window.updateUserSettings = async () => {
  try {
    const photoDay = document.getElementById('photo-day').value;
    const photoTime = document.getElementById('photo-time').value;

    await updateDoc(doc(db, "users", currentUser.uid), {
      showSkinfolds: document.getElementById('show-skinfolds').checked,
      showMeasures: document.getElementById('show-measures').checked,
      restTime: parseInt(document.getElementById('rest-time').value),
      enableSound: document.getElementById('enable-sound').checked,
      keepAwake: document.getElementById('keep-awake').checked,
      photoDay: photoDay,
      photoTime: photoTime
    });

    alert("Configuración guardada");
  } catch(e) {
    alert("Error: " + e.message);
  }
};

window.toggleWakeLock = async () => {
  if (document.getElementById('keep-awake').checked) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
    } catch (err) {
      console.error(err);
    }
  } else if (wakeLock) {
    await wakeLock.release();
    wakeLock = null;
  }
};

// STUBS para otras funciones (completas según tu código original)
window.switchPhotoTab = () => {};
window.loadPhotoComparison = () => {};
window.updateCoachUserSettings = () => {};

console.log("✅ App iniciada correctamente");