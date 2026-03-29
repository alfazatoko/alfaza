/**
 * ALFAZA CELL PRO - CORE LOGIC
 * Penanganan: Transaksi Lokal, Sync Cloud, Laporan, Grafik, & Owner Mode.
 */

// === 1. KONFIGURASI ===
// Ganti URL ini dengan URL Web App dari Google Apps Script Anda
const APP_URL = "https://script.google.com/macros/s/AKfycbwQn6nEHk-tCJ7JgfCmEGq8R6CPGzAgWr6HbJ4ciq7V5HfQ520I9dt3Ryr5iBkMjmZD/exec"; 

const PINS = { 
    "KASIR 01": "1212", 
    "KASIR 02": "2323", 
    "KASIR 03": "3434", 
    "OWNER": "9999" 
};

const KASIR_NAMES = ["KASIR 01", "KASIR 02", "KASIR 03"];

// === 2. DATABASE & STATE ===
let db = JSON.parse(localStorage.getItem('alfaza_db')) || {};

// Inisialisasi struktur database jika baru
function initDB() {
    KASIR_NAMES.forEach(k => {
        if (!db[k]) db[k] = { 
            bank: 0, cash: 0, tarik: 0, aks: 0, admin: 0, 
            tr: [], ts: [], attendance: {} 
        };
    });
    if (!db.OWNER) db.OWNER = { bank: 0, cash: 0, tarik: 0, aks: 0, admin: 0, tr: [], ts: [] };
}
initDB();

let currentUser = "";
let currentKasir = null; // Kasir yang sedang dilihat datanya
let currentData = null;  // Referensi ke db[kasir]
let userRole = "";       // 'owner' atau 'kasir'
let activeCategory = "BANK";
let editId = null;
let transFilter = "all";
let graphType = "daily";
let graphChart = null;

// === 3. HELPERS ===
const formatNumber = (v) => new Intl.NumberFormat('id-ID').format(v);
const toNumber = (v) => parseInt(v.toString().replace(/\D/g, '')) || 0;
const getToday = () => new Date().toISOString().split('T')[0];
const getCurrentTime = () => new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
const saveLocal = () => localStorage.setItem('alfaza_db', JSON.stringify(db));

function formatRupiah(el) {
    let v = el.value.replace(/\D/g, '');
    el.value = v ? formatNumber(v) : '';
}

function showToast(msg) {
    let t = document.getElementById('toast');
    t.innerText = msg;
    t.style.opacity = '1';
    setTimeout(() => t.style.opacity = '0', 2000);
}

// === 4. SISTEM LOGIN & ABSEN ===
function doLogin() {
    let u = document.getElementById('user-name').value;
    let p = document.getElementById('user-pin').value;
    
    if (PINS[u] === p) {
        currentUser = u;
        userRole = (u === "OWNER") ? "owner" : "kasir";
        
        if (userRole === "owner") {
            currentKasir = "KASIR 01";
            currentData = db[currentKasir];
            document.getElementById('ownerPanel').style.display = 'block';
            document.getElementById('navGraph').style.display = 'block';
        } else {
            currentKasir = u;
            currentData = db[u];
            document.getElementById('ownerPanel').style.display = 'none';
            document.getElementById('navGraph').style.display = 'none';
            recordAttendance(u);
        }
        
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('main-app').style.display = 'block';
        document.getElementById('userName').innerText = currentUser;
        
        initAppValues();
        updateUI();
        startClock();
        startQuoteRotator();
        
        // Auto Sync pertama kali
        syncWithCloud();
        // Set timer sync otomatis tiap 1 jam (3600000 ms)
        setInterval(syncWithCloud, 3600000);
    } else {
        alert("PIN SALAH!");
    }
}

function initAppValues() {
    let today = getToday();
    document.getElementById('dateStart').value = today;
    document.getElementById('dateEnd').value = today;
    document.getElementById('reportDate').value = today;
    document.getElementById('graphStart').value = today;
    document.getElementById('graphEnd').value = today;
    document.getElementById('loginTime').innerText = getCurrentTime();
    
    let jam = new Date().getHours();
    document.getElementById('userShift').innerText = (jam >= 6 && jam < 15) ? "?? Pagi" : "?? Malam";
    document.getElementById('todayDate').innerText = new Date().toLocaleDateString('id-ID', { weekday:'long', day:'numeric', month:'long' });
}

function recordAttendance(kasir) {
    let today = getToday();
    if (!db[kasir].attendance) db[kasir].attendance = {};
    if (!db[kasir].attendance[today]) {
        db[kasir].attendance[today] = getCurrentTime();
        saveLocal();
    }
    document.getElementById('attendanceTime').innerText = db[kasir].attendance[today];
}

// === 5. TRANSAKSI (CREATE, READ, UPDATE, DELETE) ===
function selectCategory(cat, el) {
    activeCategory = cat;
    document.querySelectorAll('#categoryGrid .category-btn').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
}

function saveTransaction() {
    if (userRole === 'owner') return alert("Mode Owner hanya untuk memantau.");
    
    let nom = toNumber(document.getElementById('inputNominal').value);
    let adm = toNumber(document.getElementById('inputAdmin').value);
    let ket = document.getElementById('inputNote').value;
    
    if (!nom) return alert("Masukkan nominal!");

    let data = {
        id: Date.now(),
        tgl: getToday(),
        jam: getCurrentTime(),
        kat: activeCategory, 
        nom: nom, 
        adm: adm, 
        ket: ket
    };

    // Update Saldo Lokal
    if (activeCategory === 'TARIK TUNAI') { 
        currentData.cash -= nom; 
        currentData.tarik += nom; 
    } else if (activeCategory === 'AKSESORIS') { 
        currentData.aks += nom; 
    } else { 
        currentData.bank -= nom; 
        currentData.cash += nom; 
    }
    currentData.admin += adm;

    currentData.tr.unshift(data);
    saveLocal();
    updateUI();
    
    // Clear Form
    document.getElementById('inputNominal').value = '';
    document.getElementById('inputAdmin').value = '';
    document.getElementById('inputNote').value = '';
    
    showToast("? Berhasil Simpan");
    syncWithCloud(); // Sync ke cloud di background
}

function deleteTransaction(id) {
    if (!confirm("Hapus transaksi ini?")) return;
    
    let idx = currentData.tr.findIndex(t => t.id === id);
    if (idx > -1) {
        let t = currentData.tr[idx];
        
        // Balikkan Saldo
        if (t.kat === 'TARIK TUNAI') { 
            currentData.cash += t.nom; 
            currentData.tarik -= t.nom; 
        } else if (t.kat === 'AKSESORIS') { 
            currentData.aks -= t.nom; 
        } else { 
            currentData.bank += t.nom; 
            currentData.cash -= t.nom; 
        }
        currentData.admin -= t.adm;

        currentData.tr.splice(idx, 1);
        saveLocal();
        updateUI();
        refreshHistory();
        showToast("??? Terhapus");
        syncWithCloud();
    }
}

function openEditModal(id) {
    let t = currentData.tr.find(x => x.id === id);
    if (!t) return;
    editId = id;
    document.getElementById('editAmount').value = formatNumber(t.nom);
    document.getElementById('editAdminFee').value = formatNumber(t.adm);
    document.getElementById('editNote').value = t.ket;
    document.getElementById('modalEdit').style.display = 'flex';
}

function saveEdit() {
    let idx = currentData.tr.findIndex(x => x.id === editId);
    if (idx === -1) return;
    
    let t = currentData.tr[idx];
    let newNom = toNumber(document.getElementById('editAmount').value);
    let newAdm = toNumber(document.getElementById('editAdminFee').value);
    let newKet = document.getElementById('editNote').value;

    // Balikkan saldo lama
    if (t.kat === 'TARIK TUNAI') { currentData.cash += t.nom; currentData.tarik -= t.nom; }
    else if (t.kat === 'AKSESORIS') { currentData.aks -= t.nom; }
    else { currentData.bank += t.nom; currentData.cash -= t.nom; }
    currentData.admin -= t.adm;

    // Terapkan saldo baru
    t.nom = newNom; t.adm = newAdm; t.ket = newKet;

    if (t.kat === 'TARIK TUNAI') { currentData.cash -= newNom; currentData.tarik += newNom; }
    else if (t.kat === 'AKSESORIS') { currentData.aks += newNom; }
    else { currentData.bank -= newNom; currentData.cash += newNom; }
    currentData.admin += newAdm;

    saveLocal();
    updateUI();
    refreshHistory();
    closeModal('modalEdit');
    showToast("?? Berhasil Update");
    syncWithCloud();
}

// === 6. SALDO & SALDO REAL ===
function saveSaldo() {
    let type = document.getElementById('saldoType').value;
    let nom = toNumber(document.getElementById('saldoAmount').value);
    if (!nom) return;

    if (type === 'Bank') currentData.bank += nom;
    else currentData.cash += nom;

    currentData.ts.unshift({
        id: Date.now(),
        jam: getCurrentTime(),
        tgl: getToday(),
        jenis: type,
        nom: nom,
        ket: "Tambah Saldo"
    });

    saveLocal();
    updateUI();
    closeModal('modalSaldo');
    document.getElementById('saldoAmount').value = '';
    showToast("?? Saldo Bertambah");
    syncWithCloud();
}

function saveSaldoReal() {
    let nom = toNumber(document.getElementById('realAmount').value);
    let ket = document.getElementById('realNote').value;
    if (!nom) return;

    currentData.ts.unshift({
        id: Date.now(),
        jam: getCurrentTime(),
        tgl: getToday(),
        jenis: "Saldo Real App",
        nom: nom,
        ket: ket
    });

    saveLocal();
    updateUI();
    closeModal('modalSaldoReal');
    document.getElementById('realAmount').value = '';
    document.getElementById('realNote').value = '';
    showToast("?? Saldo Real Dicatat");
    syncWithCloud();
}

function resetSaldo() {
    if (confirm("Reset semua angka saldo kasir ini menjadi 0? (Riwayat tidak hilang)")) {
        currentData.bank = 0;
        currentData.cash = 0;
        currentData.tarik = 0;
        currentData.aks = 0;
        currentData.admin = 0;
        saveLocal();
        updateUI();
        showReport();
        showToast("?? Saldo direset");
    }
}

// === 7. RIWAYAT & LAPORAN ===
function setTransFilter(f, el) {
    transFilter = f;
    document.querySelectorAll('#transFilter .filter-btn').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
    refreshHistory();
}

function refreshHistory() {
    let start = document.getElementById('dateStart').value;
    let end = document.getElementById('dateEnd').value;
    let search = document.getElementById('searchHistory').value.toLowerCase();
    
    // Filter Transaksi Penjualan
    let filteredTr = currentData.tr.filter(t => {
        let dMatch = t.tgl >= start && t.tgl <= end;
        let cMatch = transFilter === 'all' || t.kat === transFilter;
        let sMatch = t.ket.toLowerCase().includes(search) || t.kat.toLowerCase().includes(search);
        return dMatch && cMatch && sMatch;
    });

    let htmlTr = "";
    filteredTr.forEach(t => {
        htmlTr += `<tr>
            <td>${t.jam}</td>
            <td><b>${t.kat}</b></td>
            <td>${formatNumber(t.nom)}</td>
            <td>${formatNumber(t.adm)}</td>
            <td>${t.ket}</td>
            <td>
                <button class="nav-item" style="color:blue" onclick="openEditModal(${t.id})"><i class="fa-solid fa-pen"></i></button>
                <button class="nav-item" style="color:red" onclick="deleteTransaction(${t.id})"><i class="fa-solid fa-trash"></i></button>
            </td>
        </tr>`;
    });
    document.getElementById('historyList').innerHTML = htmlTr || "<tr><td colspan='6' style='text-align:center'>Kosong</td></tr>";

    // Filter Riwayat Saldo
    let filteredTs = currentData.ts.filter(s => s.tgl >= start && s.tgl <= end);
    let htmlTs = "";
    filteredTs.forEach(s => {
        htmlTs += `<tr>
            <td>${s.jam}</td>
            <td>${s.jenis}</td>
            <td>${formatNumber(s.nom)}</td>
            <td>${s.ket}</td>
        </tr>`;
    });
    document.getElementById('saldoHistoryList').innerHTML = htmlTs || "<tr><td colspan='4' style='text-align:center'>Kosong</td></tr>";
}

function showReport() {
    let tgl = document.getElementById('reportDate').value;
    let tr = currentData.tr.filter(x => x.tgl === tgl);
    let ts = currentData.ts.filter(x => x.tgl === tgl);

    let sBank = tr.filter(x => x.kat === 'BANK').reduce((a,b) => a+b.nom, 0);
    let sFlip = tr.filter(x => x.kat === 'FLIP').reduce((a,b) => a+b.nom, 0);
    let sDana = tr.filter(x => x.kat === 'DANA').reduce((a,b) => a+b.nom, 0);
    let sApp = tr.filter(x => x.kat === 'APP PULSA').reduce((a,b) => a+b.nom, 0);
    let sTarik = tr.filter(x => x.kat === 'TARIK TUNAI').reduce((a,b) => a+b.nom, 0);
    let sAks = tr.filter(x => x.kat === 'AKSESORIS').reduce((a,b) => a+b.nom, 0);
    let totalAdm = tr.reduce((a,b) => a+b.adm, 0);
    
    let realApp = ts.find(x => x.jenis === "Saldo Real App")?.nom || 0;
    let selisih = currentData.bank - realApp;

    let html = `
        <div class="report-card">
            <h3 style="margin-bottom:15px; border-bottom:1px solid #eee; padding-bottom:5px;">Laporan: ${tgl}</h3>
            <div class="report-row"><span>Bank</span> <b>Rp ${formatNumber(sBank)}</b></div>
            <div class="report-row"><span>Flip</span> <b>Rp ${formatNumber(sFlip)}</b></div>
            <div class="report-row"><span>Dana</span> <b>Rp ${formatNumber(sDana)}</b></div>
            <div class="report-row"><span>App Pulsa</span> <b>Rp ${formatNumber(sApp)}</b></div>
            <div class="report-row" style="background:#f0f7ff"><span>Total Jual</span> <b>Rp ${formatNumber(sBank+sFlip+sDana+sApp)}</b></div>
            <div class="report-row"><span>Tarik Tunai</span> <b>- Rp ${formatNumber(sTarik)}</b></div>
            <div class="report-row"><span>Aksesoris</span> <b>Rp ${formatNumber(sAks)}</b></div>
            <div class="report-row"><span>Admin</span> <b>Rp ${formatNumber(totalAdm)}</b></div>
            <div class="report-total">?? SISA CASH: Rp ${formatNumber(currentData.cash)}</div>
            <div style="margin-top:15px; padding:10px; background:#f9f9f9; border-radius:10px; font-size:12px;">
                <div><b>Data Saldo Bank:</b></div>
                <div class="report-row"><span>Catatan App</span> <span>Rp ${formatNumber(currentData.bank)}</span></div>
                <div class="report-row"><span>Saldo Real</span> <span>Rp ${formatNumber(realApp)}</span></div>
                <div class="report-row"><span>Selisih</span> <b style="color:${selisih===0?'green':'red'}">Rp ${formatNumber(selisih)}</b></div>
            </div>
            <button class="btn-save" style="margin-top:15px; background:var(--danger)" onclick="resetSaldo()">Reset Angka Saldo</button>
        </div>
    `;
    document.getElementById('reportArea').innerHTML = html;
}

// === 8. GRAFIK (CHART.JS) ===
function setGraphType(t, el) {
    graphType = t;
    document.querySelectorAll('#page-graph .filter-btn').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
    refreshGraph();
}

function refreshGraph() {
    let start = document.getElementById('graphStart').value;
    let end = document.getElementById('graphEnd').value;
    let tr = currentData.tr.filter(x => x.tgl >= start && x.tgl <= end);

    let labels = [];
    let dataValues = [];

    if (graphType === 'daily') {
        let daily = {};
        tr.forEach(x => { daily[x.tgl] = (daily[x.tgl] || 0) + x.nom; });
        labels = Object.keys(daily).sort();
        dataValues = labels.map(l => daily[l]);
    } else {
        let cats = { BANK:0, FLIP:0, DANA:0, "APP PULSA":0 };
        tr.forEach(x => { if(cats[x.kat] !== undefined) cats[x.kat] += x.nom; });
        labels = Object.keys(cats);
        dataValues = Object.values(cats);
    }

    if (graphChart) graphChart.destroy();
    let ctx = document.getElementById('salesChart').getContext('2d');
    graphChart = new Chart(ctx, {
        type: graphType === 'daily' ? 'line' : 'pie',
        data: {
            labels: labels,
            datasets: [{
                label: 'Volume Penjualan',
                data: dataValues,
                backgroundColor: ['#2b67f6', '#f39c12', '#10b981', '#e74c3c', '#9b59b6'],
                borderColor: '#2b67f6',
                tension: 0.3
            }]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });
}

// === 9. SINKRONISASI (GAS BACKEND) ===
async function syncWithCloud() {
    const statusEl = document.getElementById('syncStatus');
    statusEl.innerHTML = '<i class="fa-solid fa-arrows-rotate fa-spin"></i> Sync...';

    try {
        // 1. Kirim data kasir aktif ke cloud
        await fetch(APP_URL, {
            method: 'POST',
            mode: 'no-cors', // Penting untuk GAS
            body: JSON.stringify({ action: "pushData", kasir: currentKasir, data: db[currentKasir] })
        });

        // 2. Jika Owner, ambil data seluruh kasir dari cloud
        const pullRes = await fetch(`${APP_URL}?action=pullAll`);
        const result = await pullRes.json();
        
        if (result && typeof result === 'object') {
            KASIR_NAMES.forEach(k => {
                if (result[k]) db[k] = result[k];
            });
            saveLocal();
            currentData = db[currentKasir];
            updateUI();
        }

        statusEl.innerHTML = '<i class="fa-solid fa-cloud-check"></i> Terhubung';
    } catch (e) {
        console.warn("Sync error:", e);
        statusEl.innerHTML = '<i class="fa-solid fa-cloud-exclamation" style="color:red"></i> Offline';
    }
}

function manualSync() {
    syncWithCloud().then(() => showToast("?? Sinkronisasi Selesai"));
}

// === 10. UI NAVIGATION & MISC ===
function updateUI() {
    if (!currentData) return;
    document.getElementById('saldoBank').innerText = "Rp " + formatNumber(currentData.bank);
    document.getElementById('saldoCash').innerText = "Rp " + formatNumber(currentData.cash);
    document.getElementById('statTarik').innerText = formatNumber(currentData.tarik);
    document.getElementById('statAks').innerText = formatNumber(currentData.aks);
    document.getElementById('statAdmin').innerText = formatNumber(currentData.admin);
}

function changePage(p, el) {
    document.querySelectorAll('.page').forEach(pg => pg.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(ni => ni.classList.remove('active'));
    document.getElementById('page-' + p).classList.add('active');
    el.classList.add('active');
    
    if (p === 'history') refreshHistory();
    if (p === 'report') showReport();
    if (p === 'graph') refreshGraph();
}

function selectKasir(k, el) {
    currentKasir = k;
    currentData = db[k];
    document.querySelectorAll('#kasirSelector .filter-btn').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
    updateUI();
    // Refresh page jika sedang di halaman riwayat/laporan
    if (document.getElementById('page-history').classList.contains('active')) refreshHistory();
    if (document.getElementById('page-report').classList.contains('active')) showReport();
}

function startClock() {
    setInterval(() => {
        document.getElementById('liveClock').innerText = new Date().toLocaleTimeString('id-ID');
    }, 1000);
}

function startQuoteRotator() {
    const quotes = [
        "Kejujuran adalah kunci keberkahan usaha.",
        "Pelayanan terbaik adalah magnet pelanggan.",
        "Disiplin mencatat adalah awal kesuksesan.",
        "Senyum ramah, rezeki melimpah."
    ];
    let i = 0;
    setInterval(() => {
        document.getElementById('dailyQuote').innerText = quotes[i];
        i = (i + 1) % quotes.length;
    }, 15000);
}

function openSaldoModal() { document.getElementById('modalSaldo').style.display = 'flex'; }
function openSaldoRealModal() { document.getElementById('modalSaldoReal').style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }
function logout() { if(confirm("Logout?")) location.reload(); }