const $ = (id) => document.getElementById(id);

let ctx = {
    lokasi: "", jamMulai: "", jamSelesai: "", tanggal: null,
    weatherContext: "", daftarTempat: [], excluded: []
};
let activeGaleri = null;

/* ================= helpers ================= */
function setStatus(msg, isErr) {
    const el = $("status");
    el.textContent = msg || "";
    el.className = "status" + (isErr ? " err" : "");
}

function showPeringatan(msg) {
    const el = $("peringatan");
    if (msg) { el.textContent = "⚠️ " + msg; el.classList.remove("hidden"); }
    else { el.textContent = ""; el.classList.add("hidden"); }
}

function titleCase(s) {
    return String(s).replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1));
}

function mapsUrl(q) {
    return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q);
}

function mapsLink(nama, teks) {
    const q = ctx.lokasi ? `${nama} ${ctx.lokasi}` : nama;
    return `<a class="maps-link" href="${mapsUrl(q)}" target="_blank" rel="noopener">📍 ${teks || "Buka di Google Maps"}</a>`;
}

// ikon kategori dari nama tempat
function kategoriIkon(nama) {
    const s = nama.toLowerCase();
    if (/(timezone|funworld|game|bioskop|cinema|xxi|cgv|kolam|waterboom|waterpark|studio|trans studio|dufan)/.test(s)) return "🎡";
    if (/(mall|plaza|square|transmart|summarecon|metropolitan|town\s?squa|living world|aeon|itc)/.test(s)) return "🛍️";
    if (/(kopi|coffee|cafe|kafe|nako|janji jiwa|kenangan|starbucks|kedai|tea|j\.?co|roti|bakery|donut)/.test(s)) return "☕";
    if (/(taman|kebun|hutan|alun|park|situ|danau|telaga|curug|air terjun|gunung|bukit|pantai|wisata alam|camping|villa)/.test(s)) return "🌳";
    if (/(museum|monumen|candi|masjid|gereja|vihara|edukasi|sejarah|galeri)/.test(s)) return "🏛️";
    if (/(resto|restoran|rumah makan|\brm\b|warung|nasi|sate|bakso|soto|ayam|seafood|bakmi|\bmie\b|gelato|kuliner|food|dapur|solaria|ampera)/.test(s)) return "🍽️";
    return "📍";
}

// ikon + kelas dari kondisi cuaca
function cuacaIkon(kondisi) {
    const s = String(kondisi).toLowerCase();
    if (/petir|thunder|badai/.test(s)) return "⛈️";
    if (/hujan|rain|gerimis|drizzle/.test(s)) return "🌧️";
    if (/salju|snow/.test(s)) return "❄️";
    if (/mendung|overcast/.test(s)) return "☁️";
    if (/berawan|cloud/.test(s)) return "⛅";
    if (/kabut|mist|fog|haze|asap/.test(s)) return "🌫️";
    if (/cerah|sunny|clear|terik/.test(s)) return "☀️";
    return "🌤️";
}

function formatTanggalID(iso) {
    if (!iso) return "";
    const hari = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
    const bulan = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
    const d = new Date(iso + "T00:00:00");
    if (isNaN(d)) return "";
    return `${hari[d.getDay()]}, ${d.getDate()} ${bulan[d.getMonth()]} ${d.getFullYear()}`;
}

function loading(btn, on, teksLoading) {
    if (on) {
        btn.dataset.old = btn.innerHTML;
        btn.innerHTML = `<span class="spin"></span>${teksLoading || "Memproses..."}`;
        btn.disabled = true;
    } else {
        if (btn.dataset.old) btn.innerHTML = btn.dataset.old;
        btn.disabled = false;
    }
}

async function api(path, body) {
    const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Gagal.");
    return data;
}

/* ================= tema ================= */
function applyTheme(dark) {
    document.body.classList.toggle("dark", dark);
    $("btnTheme").textContent = dark ? "☀️" : "🌙";
    localStorage.setItem("theme", dark ? "dark" : "light");
}
$("btnTheme").addEventListener("click", () => applyTheme(!document.body.classList.contains("dark")));
applyTheme(localStorage.getItem("theme") === "dark"
    || (localStorage.getItem("theme") === null && window.matchMedia("(prefers-color-scheme: dark)").matches));

/* ================= step 2: daftar tempat ================= */
function showSkeleton() {
    const wrap = $("daftarTempat");
    wrap.innerHTML = "";
    for (let i = 0; i < 10; i++) {
        const s = document.createElement("div");
        s.className = "skeleton";
        wrap.appendChild(s);
    }
    $("panelPilih").classList.remove("hidden");
}

function renderDaftar() {
    const wrap = $("daftarTempat");
    wrap.innerHTML = "";
    ctx.daftarTempat.forEach((t, i) => {
        const label = document.createElement("label");
        label.className = "place";
        label.innerHTML =
            `<input type="checkbox" value="${i}" />` +
            `<span class="kat">${kategoriIkon(t)}</span>` +
            `<span class="nm">${i + 1}. ${t}</span>`;
        wrap.appendChild(label);
    });
    $("panelPilih").classList.remove("hidden");
    $("btnLain").disabled = false;
}

async function cariTempat(exclude) {
    const input = $("inputLokasi").value.trim();
    if (!input) { setStatus("Isi lokasinya dulu ya.", true); return; }

    setStatus("⏳ Ngambil cuaca & nyari tempat...");
    showPeringatan(null);
    loading($("btnCari"), true, "Mencari...");
    $("btnLain").disabled = true;
    if (!exclude || !exclude.length) showSkeleton();

    try {
        const data = await api("/api/places", { input, exclude: exclude || [] });
        ctx.lokasi = data.lokasi;
        ctx.jamMulai = data.jamMulai;
        ctx.jamSelesai = data.jamSelesai;
        ctx.tanggal = data.tanggal || null;
        ctx.weatherContext = data.weatherContext;
        ctx.daftarTempat = data.daftarTempat;
        ctx.excluded = [...ctx.excluded, ...data.daftarTempat];
        renderDaftar();
        showPeringatan(data.peringatan);
        const tglTxt = ctx.tanggal ? ` · ${formatTanggalID(ctx.tanggal)}` : "";
        setStatus(`✅ ${data.daftarTempat.length} tempat di sekitar ${titleCase(data.lokasi)} (${data.jamMulai}-${data.jamSelesai})${tglTxt}. Pilih, lalu susun rundown.`);
        $("btnReset").disabled = false;
    } catch (e) {
        setStatus("❌ " + e.message, true);
        $("daftarTempat").innerHTML = "";
    } finally {
        loading($("btnCari"), false);
        $("btnLain").disabled = ctx.daftarTempat.length === 0;
    }
}

function tempatDipilih() {
    return [...document.querySelectorAll("#daftarTempat input:checked")]
        .map(c => ctx.daftarTempat[parseInt(c.value)]);
}

/* ================= step 3: rundown ================= */
async function susunRundown() {
    const dipilih = tempatDipilih();
    if (!dipilih.length) { setStatus("Centang minimal satu tempat dulu.", true); return; }

    setStatus("✍️ Nyusun rundown...");
    loading($("btnRundown"), true, "Menyusun...");
    try {
        const data = await api("/api/rundown", {
            lokasi: ctx.lokasi, jamMulai: ctx.jamMulai, jamSelesai: ctx.jamSelesai,
            weatherContext: ctx.weatherContext, tempatDipilih: dipilih,
            hindariHujan: $("hindariHujan").checked
        });
        renderHasil(data, dipilih);
        setStatus("✅ Rundown siap. Scroll ke bawah buat edit & tempel foto.");
        $("panelHasil").scrollIntoView({ behavior: "smooth" });
    } catch (e) {
        setStatus("❌ " + e.message, true);
    } finally {
        loading($("btnRundown"), false);
    }
}

function renderHasil(data, dipilih) {
    $("panelHasil").classList.remove("hidden");
    $("judul").textContent = `🗺️ Rencana main di sekitar ${titleCase(ctx.lokasi)}`;

    const tglTxt = ctx.tanggal ? formatTanggalID(ctx.tanggal) : "";
    $("subJudul").textContent = `${tglTxt ? tglTxt + " · " : ""}${ctx.jamMulai} - ${ctx.jamSelesai}`;
    $("printTanggal").textContent = `${tglTxt || "Rencana Harian"} · ${ctx.jamMulai}-${ctx.jamSelesai}`;

    $("rekomendasi").innerHTML = "";
    (data.rekomendasi || dipilih).forEach(t => {
        const li = document.createElement("li");
        li.textContent = t;
        $("rekomendasi").appendChild(li);
    });

    let block = "";
    (data.rundown || []).forEach(item => {
        const tempat = item.tempat ? ` | ${item.tempat}` : "";
        block += `${item.waktu}${tempat}\n`;
        (item.aktivitas || []).forEach(a => { block += `   - ${a}\n`; });
    });
    $("rundown").textContent = block.trim();

    // cuaca sebagai grid dengan ikon + badge
    const cuacaWrap = $("cuaca");
    cuacaWrap.innerHTML = "";
    (data.cuaca || []).forEach(c => {
        const cell = document.createElement("div");
        cell.className = "cuaca-cell";
        cell.innerHTML =
            `<span class="ic">${cuacaIkon(c.kondisi)}</span>` +
            `<span class="info"><span class="jm">${c.jam}</span><br><span class="kd">${c.kondisi}</span></span>` +
            `<span class="badges"><span class="badge suhu">${c.suhu}°C</span><span class="badge hujan">${c.hujan}%</span></span>`;
        cuacaWrap.appendChild(cell);
    });
    $("kesimpulan").textContent = data.kesimpulan || "";

    // link Google Maps lokasi utama
    $("mapsMain").innerHTML = mapsLink(ctx.lokasi, `Buka "${titleCase(ctx.lokasi)}" di Google Maps`);

    // galeri foto + link maps per tempat
    const galeri = $("galeri");
    galeri.innerHTML = "";
    (data.rekomendasi && data.rekomendasi.length ? data.rekomendasi : dipilih).forEach(nama => {
        galeri.appendChild(buatGaleri(nama));
    });
}

function buatGaleri(nama) {
    const box = document.createElement("div");
    box.className = "tempat-galeri";
    box.innerHTML = `
        <h4>${kategoriIkon(nama)} ${nama} ${mapsLink(nama, "Maps")}</h4>
        <div class="thumbs"></div>
        <div class="galeri-actions no-print">
            <button type="button" class="ghost btn-upload">📤 Upload Foto</button>
            <span class="hint">atau klik area ini lalu Ctrl+V</span>
            <input type="file" accept="image/*" multiple hidden />
        </div>`;

    const thumbs = box.querySelector(".thumbs");
    const fileInput = box.querySelector("input[type=file]");
    box.querySelector(".btn-upload").addEventListener("click", (e) => { e.stopPropagation(); fileInput.click(); });
    fileInput.addEventListener("change", (e) => {
        [...e.target.files].forEach(f => bacaFile(f, thumbs));
        fileInput.value = "";
    });

    box.addEventListener("click", (e) => {
        if (e.target.closest("a")) return;
        document.querySelectorAll(".tempat-galeri").forEach(g => g.classList.remove("active"));
        box.classList.add("active");
        activeGaleri = thumbs;
    });

    return box;
}

function bacaFile(file, thumbs) {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = (e) => tambahThumb(e.target.result, thumbs);
    reader.readAsDataURL(file);
}

function tambahThumb(dataUrl, thumbs) {
    const t = document.createElement("div");
    t.className = "thumb";
    t.innerHTML = `<img src="${dataUrl}" /><span class="del no-print">×</span>`;
    t.querySelector(".del").addEventListener("click", () => t.remove());
    thumbs.appendChild(t);
}

/* ================= reset ================= */
function resetAll() {
    ctx = { lokasi: "", jamMulai: "", jamSelesai: "", tanggal: null, weatherContext: "", daftarTempat: [], excluded: [] };
    activeGaleri = null;
    $("inputLokasi").value = "";
    $("daftarTempat").innerHTML = "";
    $("galeri").innerHTML = "";
    $("hindariHujan").checked = false;
    $("panelPilih").classList.add("hidden");
    $("panelHasil").classList.add("hidden");
    $("btnLain").disabled = true;
    $("btnReset").disabled = true;
    showPeringatan(null);
    setStatus("Direset. Masukin lokasi baru ya.");
    $("inputLokasi").focus();
}

/* ================= paste screenshot ================= */
document.addEventListener("paste", (e) => {
    if (!activeGaleri) return;
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const it of items) {
        if (it.type.startsWith("image/")) {
            bacaFile(it.getAsFile(), activeGaleri);
            e.preventDefault();
        }
    }
});

/* ================= salin rundown ================= */
async function salinRundown() {
    const teks = $("rundown").innerText.trim();
    if (!teks) return;
    try {
        await navigator.clipboard.writeText(teks);
        const b = $("btnSalin");
        const old = b.innerHTML;
        b.innerHTML = "✅ Tersalin!";
        setTimeout(() => { b.innerHTML = old; }, 1500);
    } catch (e) {
        setStatus("Gagal menyalin otomatis, blok teks rundown lalu Ctrl+C ya.", true);
    }
}

/* ================= events ================= */
$("btnCari").addEventListener("click", () => { ctx.excluded = []; cariTempat([]); });
$("btnLain").addEventListener("click", () => cariTempat(ctx.excluded));
$("btnRundown").addEventListener("click", susunRundown);
$("btnReset").addEventListener("click", resetAll);
$("btnSalin").addEventListener("click", salinRundown);
$("btnPdf").addEventListener("click", () => window.print());
$("inputLokasi").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { ctx.excluded = []; cariTempat([]); }
});
