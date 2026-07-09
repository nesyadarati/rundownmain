const $ = (id) => document.getElementById(id);

let ctx = {
    lokasi: "", jamMulai: "", jamSelesai: "",
    weatherContext: "", daftarTempat: [], excluded: []
};
let activeGaleri = null;

function setStatus(msg, isErr) {
    const el = $("status");
    el.textContent = msg || "";
    el.className = "status" + (isErr ? " err" : "");
}

function titleCase(s) {
    return String(s).replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1));
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

function renderDaftar() {
    const wrap = $("daftarTempat");
    wrap.innerHTML = "";
    ctx.daftarTempat.forEach((t, i) => {
        const label = document.createElement("label");
        label.className = "place";
        label.innerHTML = `<input type="checkbox" value="${i}" /> <span>${i + 1}. ${t}</span>`;
        wrap.appendChild(label);
    });
    $("panelPilih").classList.remove("hidden");
    $("btnLain").disabled = false;
}

async function cariTempat(exclude) {
    const input = $("inputLokasi").value.trim();
    if (!input) { setStatus("Isi lokasinya dulu ya.", true); return; }

    setStatus("⏳ Ngambil cuaca & nyari tempat...");
    $("btnCari").disabled = true; $("btnLain").disabled = true;
    try {
        const data = await api("/api/places", { input, exclude: exclude || [] });
        ctx.lokasi = data.lokasi;
        ctx.jamMulai = data.jamMulai;
        ctx.jamSelesai = data.jamSelesai;
        ctx.weatherContext = data.weatherContext;
        ctx.daftarTempat = data.daftarTempat;
        ctx.excluded = [...ctx.excluded, ...data.daftarTempat];
        renderDaftar();
        setStatus(`✅ ${data.daftarTempat.length} tempat di sekitar ${titleCase(data.lokasi)} (${data.jamMulai}-${data.jamSelesai}). Pilih, lalu susun rundown.`);
    } catch (e) {
        setStatus("❌ " + e.message, true);
    } finally {
        $("btnCari").disabled = false;
        $("btnLain").disabled = ctx.daftarTempat.length === 0;
    }
}

function tempatDipilih() {
    return [...document.querySelectorAll("#daftarTempat input:checked")]
        .map(c => ctx.daftarTempat[parseInt(c.value)]);
}

async function susunRundown() {
    const dipilih = tempatDipilih();
    if (!dipilih.length) { setStatus("Centang minimal satu tempat dulu.", true); return; }

    setStatus("✍️ Nyusun rundown...");
    $("btnRundown").disabled = true;
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
        $("btnRundown").disabled = false;
    }
}

function renderHasil(data, dipilih) {
    $("panelHasil").classList.remove("hidden");
    $("judul").textContent = `🗺️ Rencana main di sekitar ${titleCase(ctx.lokasi)}`;

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

    $("cuaca").innerHTML = "";
    (data.cuaca || []).forEach(c => {
        const li = document.createElement("li");
        li.textContent = `Jam ${c.jam}: ${c.kondisi} (Peluang Hujan: ${c.hujan}%, Suhu: ${c.suhu}°C)`;
        $("cuaca").appendChild(li);
    });
    $("kesimpulan").textContent = data.kesimpulan || "";

    // Galeri foto per tempat yang dipilih
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
        <h4>📷 ${nama}</h4>
        <div class="thumbs"></div>
        <div class="galeri-actions no-print">
            <button type="button" class="ghost btn-upload">Upload Foto</button>
            <span class="hint">atau klik area ini lalu Ctrl+V</span>
            <input type="file" accept="image/*" multiple hidden />
        </div>`;

    const thumbs = box.querySelector(".thumbs");
    const fileInput = box.querySelector("input[type=file]");
    box.querySelector(".btn-upload").addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", (e) => {
        [...e.target.files].forEach(f => bacaFile(f, thumbs));
        fileInput.value = "";
    });

    box.addEventListener("click", () => {
        document.querySelectorAll(".tempat-galeri").forEach(g => g.classList.remove("active"));
        box.classList.add("active");
        activeGaleri = thumbs;
    });

    return box;
}

function bacaFile(file, thumbs) {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = (e) => tambahThumb(e.target.result, thumbs);
    reader.readAsDataURL(file);
}

function tambahThumb(dataUrl, thumbs) {
    const t = document.createElement("div");
    t.className = "thumb";
    t.innerHTML = `<img src="${dataUrl}" /><span class="del">×</span>`;
    t.querySelector(".del").addEventListener("click", () => t.remove());
    thumbs.appendChild(t);
}

// Paste screenshot langsung ke galeri yang aktif
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

$("btnCari").addEventListener("click", () => { ctx.excluded = []; cariTempat([]); });
$("btnLain").addEventListener("click", () => cariTempat(ctx.excluded));
$("btnRundown").addEventListener("click", susunRundown);
$("btnPdf").addEventListener("click", () => window.print());
$("inputLokasi").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { ctx.excluded = []; cariTempat([]); }
});
