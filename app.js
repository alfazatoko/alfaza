const APP_URL = "https://script.google.com/macros/s/AKfycbznrUnfSQotqFVuNbhWpBDYJy8HnWoJNiDzItt-dBahQ5cq-8SDPQq-falf8SPnKJ4/exec";
const PINS = { "KASIR 01": "1212", "KASIR 02": "2323", "KASIR 03": "3434", "OWNER": "9999" };
const KASIR_NAMES = ["KASIR 01", "KASIR 02", "KASIR 03"];

let db = JSON.parse(localStorage.getItem('alfaza_db')) || {};
KASIR_NAMES.forEach(k => { if (!db[k]) db[k] = { bank:0, cash:0, tarik:0, aks:0, admin:0, tr:[], ts:[] }; });

let currentUser = "", currentKasir = null, currentData = null, userRole = "";
let activeCategory = "BANK", transFilter = "all";

function doLogin() {
    let u = document.getElementById('user-name').value;
    let p = document.getElementById('user-pin').value;
    if (PINS[u] === p) {
        currentUser = u;
        userRole = (u === "OWNER") ? "owner" : "kasir";
        if (userRole === "owner") {
            currentKasir = "KASIR 01"; currentData = db[currentKasir];
            document.getElementById('ownerPanel').style.display = 'block';
        } else {
            currentKasir = u; currentData = db[u];
            document.getElementById('ownerPanel').style.display = 'none';
        }
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('main-app').style.display = 'block';
        document.getElementById('userName').innerText = u;
        document.getElementById('reportDate').value = new Date().toISOString().split('T')[0];
        updateUI();
        startAutoSync();
        setInterval(updateLiveClock, 1000);
        document.getElementById('todayDate').innerText = new Date().toLocaleDateString('id-ID', {weekday:'short', day:'numeric', month:'short'});
    } else { alert("PIN SALAH!"); }
}

async function syncCloud(isManual = false) {
    const statusEl = document.getElementById('syncStatus');
    statusEl.innerHTML = '<i class="fa-solid fa-arrows-rotate fa-spin"></i> Sync...';
    try {
        if (userRole === 'kasir') {
            await fetch(APP_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ action: "pushData", kasir: currentKasir, data: db[currentKasir] }) });
        }
        const res = await fetch(`${APP_URL}?action=pullAll`);
        const cloudData = await res.json();
        if (cloudData) {
            db = cloudData;
            localStorage.setItem('alfaza_db', JSON.stringify(db));
            currentData = db[currentKasir];
            updateUI();
        }
        statusEl.innerHTML = '<i class="fa-solid fa-cloud-check" style="color:#10b981"></i> Terhubung';
        if (isManual) showToast("Sync Berhasil");
    } catch (e) { statusEl.innerHTML = '<i class="fa-solid fa-cloud-exclamation" style="color:red"></i> Offline'; }
}

function startAutoSync() { syncCloud(); setInterval(syncCloud, 3600000); }
function manualSync() { syncCloud(true); }

function saveTransaction() {
    if (userRole === 'owner') return alert("Owner tidak bisa input!");
    let nom = toNumber(document.getElementById('inputNominal').value);
    let adm = toNumber(document.getElementById('inputAdmin').value);
    let ket = document.getElementById('inputNote').value;
    if (!nom) return alert("Nominal kosong!");

    let data = { id: Date.now(), tgl: new Date().toISOString().split('T')[0], jam: new Date().toLocaleTimeString('id-ID', {hour:'2-digit', minute:'2-digit'}), kat: activeCategory, nom, adm, ket };
    if (activeCategory === 'TARIK TUNAI') { currentData.cash -= nom; currentData.tarik += nom; }
    else if (activeCategory === 'AKSESORIS') { currentData.aks += nom; }
    else { currentData.bank -= nom; currentData.cash += nom; }
    currentData.admin += adm;
    currentData.tr.unshift(data);

    localStorage.setItem('alfaza_db', JSON.stringify(db));
    updateUI(); clearForm(); showToast("Tersimpan!");
    syncCloud();
}

function updateUI() {
    if (!currentData) return;
    document.getElementById('saldoBank').innerText = "Rp " + formatNumber(currentData.bank);
    document.getElementById('saldoCash').innerText = "Rp " + formatNumber(currentData.cash);
    refreshHistory();
}

function refreshHistory() {
    let html = '';
    let search = document.getElementById('searchHistory').value.toLowerCase();
    currentData.tr.slice(0, 30).forEach(t => {
        if (t.ket.toLowerCase().includes(search) || t.kat.toLowerCase().includes(search)) {
            html += `<tr><td>${t.jam}</td><td>${t.kat}</td><td>${formatNumber(t.nom)}</td><td>${t.ket}</td></tr>`;
        }
    });
    document.getElementById('historyList').innerHTML = html || '<tr><td colspan="4">Kosong</td></tr>';
}

function showReport() {
    let tgl = document.getElementById('reportDate').value;
    let tr = currentData.tr.filter(x => x.tgl === tgl);
    let sBank = tr.filter(x => x.kat === 'BANK').reduce((a,b) => a+b.nom, 0);
    let sTarik = tr.filter(x => x.kat === 'TARIK TUNAI').reduce((a,b) => a+b.nom, 0);
    let adm = tr.reduce((a,b) => a+b.adm, 0);
    document.getElementById('reportArea').innerHTML = `
        <div class="form-card" style="margin-top:10px;">
            <p style="font-size:12px; margin-bottom:5px;">Laporan: <b>${tgl}</b></p>
            <div style="display:flex; justify-content:space-between; font-size:13px; padding:5px 0; border-bottom:1px solid #eee;"><span>Penjualan Bank</span><b>Rp ${formatNumber(sBank)}</b></div>
            <div style="display:flex; justify-content:space-between; font-size:13px; padding:5px 0; border-bottom:1px solid #eee;"><span>Total Admin</span><b>Rp ${formatNumber(adm)}</b></div>
            <div style="display:flex; justify-content:space-between; font-size:13px; padding:5px 0;"><span>Tarik Tunai</span><b>Rp ${formatNumber(sTarik)}</b></div>
        </div>`;
}

function formatNumber(v) { return new Intl.NumberFormat('id-ID').format(v); }
function toNumber(v) { return parseInt(v.toString().replace(/\D/g,'')) || 0; }
function formatRupiah(el) { let v = el.value.replace(/\D/g,''); el.value = v ? formatNumber(v) : ''; }
function selectCategory(cat, el) { activeCategory = cat; document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active')); el.classList.add('active'); }
function changePage(p, el) { document.querySelectorAll('.page').forEach(pg => pg.classList.remove('active')); document.querySelectorAll('.nav-item').forEach(ni => ni.classList.remove('active')); document.getElementById('page-'+p).classList.add('active'); el.classList.add('active'); }
function selectKasir(k, el) { currentKasir = k; currentData = db[k]; document.querySelectorAll('#kasirSelector .filter-btn').forEach(b => b.classList.remove('active')); el.classList.add('active'); updateUI(); }
function openSaldoModal() { document.getElementById('modalSaldo').style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }
function saveSaldo() {
    let jenis = document.getElementById('saldoType').value;
    let nom = toNumber(document.getElementById('saldoAmount').value);
    if (!nom) return;
    if (jenis === 'Bank') currentData.bank += nom; else currentData.cash += nom;
    currentData.ts.unshift({tgl: new Date().toISOString().split('T')[0], jenis, nom});
    localStorage.setItem('alfaza_db', JSON.stringify(db));
    updateUI(); closeModal('modalSaldo'); showToast("Saldo Ditambah");
}
function clearForm() { document.getElementById('inputNominal').value = ''; document.getElementById('inputAdmin').value = ''; document.getElementById('inputNote').value = ''; }
function showToast(m) { let t = document.getElementById('toast'); t.innerText = m; t.style.opacity = 1; setTimeout(() => t.style.opacity = 0, 2000); }
function updateLiveClock() { document.getElementById('liveClock').innerText = new Date().toLocaleTimeString('id-ID'); }
function logout() { if(confirm("Keluar?")) location.reload(); }

if ('serviceWorker' in navigator) { window.addEventListener('load', () => { navigator.serviceWorker.register('service-worker.js'); }); }