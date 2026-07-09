// Logika inti (LLM, cuaca, daftar tempat, rundown) yang dipakai bareng
// oleh bot Telegram (index.js) dan dashboard web (server.js).
const axios = require("axios");

async function callGemini(prompt) {
    const baseUrl = process.env.LLM_BASE_URL.replace(/\/$/, "");
    const models = [process.env.LLM_MODEL, process.env.LLM_FALLBACK_MODEL].filter(Boolean);
    let lastError = null;

    for (const model of models) {
        try {
            const response = await axios.post(`${baseUrl}/chat/completions`, {
                model: model,
                messages: [{ role: "user", content: prompt }],
                temperature: 0.7
            }, {
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${process.env.LLM_API_KEY}`
                },
                timeout: 60000
            });

            const aiText = response.data.choices[0]?.message?.content;
            if (aiText) return aiText;
        } catch (err) {
            console.log(`Model ${model} gagal/sibuk, nyoba fallback...`);
            lastError = err;
        }
    }
    throw new Error(`Semua model AI gagal. Detail: ${lastError?.message}`);
}

// Ambil objek JSON pertama dari teks LLM (buang fence / kalimat pembuka kalau ada).
function extractJson(raw) {
    if (!raw) return null;
    let s = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start === -1 || end === -1 || end < start) return null;
    try {
        return JSON.parse(s.slice(start, end + 1));
    } catch (e) {
        return null;
    }
}

function titleCase(str) {
    return String(str).replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1));
}

// Ubah angka + keterangan (siang/malam/am/pm) jadi jam 24 jam.
function to24(jam, menit, ket) {
    let h = parseInt(jam, 10);
    const m = menit ? String(menit).padStart(2, "0") : "00";
    ket = (ket || "").toLowerCase();

    if (ket === "pm") {
        if (h < 12) h += 12;
    } else if (ket === "am") {
        if (h === 12) h = 0;
    } else if (ket === "pagi") {
        if (h === 12) h = 0;
    } else if (ket === "siang" || ket === "sore" || ket === "malam" || ket === "malem") {
        if (h < 12) h += 12;
    }
    if (h > 23) h = 23;
    return String(h).padStart(2, "0") + ":" + m;
}

// Ubah "16/7/26" / "16-7-2026" jadi ISO "YYYY-MM-DD".
function normalisasiTanggal(d, mo, y) {
    const day = parseInt(d, 10);
    const month = parseInt(mo, 10);
    let year;
    if (y) {
        year = parseInt(y, 10);
        if (year < 100) year += 2000;
    } else {
        year = new Date().getFullYear();
    }
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseJam(cleanText, prev) {
    let lokasi = cleanText;
    let jamMulai = (prev && prev.jamMulai) || "07:00";
    let jamSelesai = (prev && prev.jamSelesai) || "21:00";
    let tanggal = (prev && prev.tanggal) || null;

    const ket = "(pagi|siang|sore|malam|malem|am|pm)";
    const num = "(\\d{1,2})(?:[.:](\\d{2}))?";
    const sep = "(?:sampai|sampe|hingga|s\\/d|sd|s\\.d|-|–|—|ke)";
    const rangeRe = new RegExp(
        `(?:dari\\s+)?jam\\s*${num}\\s*${ket}?\\s*${sep}\\s*(?:jam\\s*)?${num}\\s*${ket}?`,
        "i"
    );

    const mJam = cleanText.match(rangeRe);
    if (mJam) {
        jamMulai = to24(mJam[1], mJam[2], mJam[3]);
        jamSelesai = to24(mJam[4], mJam[5], mJam[6]);
        lokasi = lokasi.replace(mJam[0], " ");
    }

    // Tanggal: "tanggal 16/7/26" atau angka "16/7/2026" / "16-7".
    const dateRe = /(?:tanggal|tgl|tgl\.|pada)?\s*\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/i;
    const mTgl = cleanText.match(dateRe);
    if (mTgl) {
        const iso = normalisasiTanggal(mTgl[1], mTgl[2], mTgl[3]);
        if (iso) {
            tanggal = iso;
            lokasi = lokasi.replace(mTgl[0], " ");
        }
    }

    // Bersihin sisa kata kunci waktu/tanggal + prefix umum dari nama lokasi.
    lokasi = lokasi
        .replace(/\b(tanggal|tgl|tgl\.|pada|dari|jam|pukul)\b/gi, " ")
        .replace(/^(main|jalan|jalan-jalan|di|ke|sekitar|daerah|area)\s+/gi, " ")
        .replace(/\s{2,}/g, " ")
        .trim();

    if (!lokasi) lokasi = cleanText;

    return { lokasi, jamMulai, jamSelesai, tanggal };
}

async function ambilCuaca(lokasi, jamMulai, jamSelesai, tanggal) {
    const apiKey = process.env.WEATHER_API_KEY;
    let peringatan = null;

    // Tentukan jarak hari dari hari ini (0 = hari ini).
    let diffHari = 0;
    if (tanggal) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const target = new Date(tanggal + "T00:00:00");
        diffHari = Math.round((target - today) / 86400000);
    }

    // WeatherAPI paket gratis: prakiraan cuma sampai ~3 hari ke depan (hari ini + 2).
    if (diffHari < 0) {
        peringatan = "Tanggalnya sudah lewat, jadi dipakai prakiraan hari ini. Ganti ke tanggal yang belum lewat kalau mau data akurat.";
        diffHari = 0;
        tanggal = null;
    } else if (diffHari > 2) {
        peringatan = "Prakiraan cuaca per jam nggak tersedia untuk tanggal itu (di luar jangkauan ~3 hari API gratis). Rundown tetap dibuat, tapi tanpa data cuaca detail.";
        return { weatherData: null, weatherContext: "", cuacaList: [], peringatan };
    }

    let weatherUrl = `http://api.weatherapi.com/v1/forecast.json?key=${apiKey}&q=${encodeURIComponent(lokasi)}&days=3&aqi=no&alerts=no`;
    if (tanggal) weatherUrl += `&dt=${tanggal}`;

    const weatherRes = await axios.get(weatherUrl);
    const weatherData = weatherRes.data;
    const forecastDays = weatherData.forecast.forecastday;
    const dayData = (tanggal && forecastDays.find(d => d.date === tanggal)) || forecastDays[0];
    const hours = dayData.hour;

    let weatherContext = "";
    const cuacaList = [];
    hours.forEach(h => {
        const timeStr = h.time.split(" ")[1];
        if (timeStr >= jamMulai && timeStr <= jamSelesai) {
            weatherContext += `- Jam ${timeStr}: ${h.condition.text} (Peluang Hujan: ${h.chance_of_rain}%, Suhu: ${Math.round(h.temp_c)}°C)\n`;
            cuacaList.push({ jam: timeStr, kondisi: h.condition.text, hujan: h.chance_of_rain, suhu: Math.round(h.temp_c) });
        }
    });

    return { weatherData, weatherContext, cuacaList, peringatan };
}

// Daftar 10 tempat bernomor. exclude = tempat yang sudah pernah disarankan.
async function generateDaftarTempat(lokasi, jamMulai, jamSelesai, exclude = []) {
    const excludeText = exclude.length
        ? `\nJANGAN sebutkan lagi tempat-tempat berikut karena sudah pernah disarankan (WAJIB kasih yang benar-benar baru dan berbeda):\n${exclude.map((t, i) => `${i + 1}. ${t}`).join("\n")}\n`
        : "";

    const prompt = `
Kamu adalah asisten penyusun rencana perjalanan harian yang paham betul tempat-tempat menarik di suatu daerah.

Sebutkan 10 nama tempat spesifik (bisa tempat main, kuliner, cafe, atau taman) yang searah, logis, dan saling berdekatan di daerah "${lokasi}", cocok untuk agenda harian dari jam ${jamMulai} sampai ${jamSelesai}.
${excludeText}
ATURAN OUTPUT (WAJIB DIIKUTI):
- Balas HANYA berupa daftar bernomor, satu tempat per baris.
- Format tiap baris persis: "1. Nama Tempat".
- JANGAN tulis kalimat pembuka, deskripsi, penjelasan, atau penutup apa pun.

Contoh:
1. Nama Tempat A
2. Nama Tempat B
`;

    const raw = await callGemini(prompt);

    return raw
        .split("\n")
        .map(l => l.trim())
        .map(l => {
            const m = l.match(/^\d+[.)]\s*(.+)$/);
            return m ? m[1].replace(/\*/g, "").trim() : null;
        })
        .filter(Boolean);
}

// Rundown dalam bentuk JSON berdasarkan tempat yang dipilih.
async function generateRundownData(lokasi, jamMulai, jamSelesai, weatherContext, tempatDipilih, hindariHujan) {
    const daftarDipilih = tempatDipilih.map((t, i) => `${i + 1}. ${t}`).join("\n");

    const aturanHujan = hindariHujan
        ? `\n- PENTING: Susun ulang jadwal agar aktivitas di area terbuka DIHINDARI pada jam dengan peluang hujan tinggi. Pada jam rawan hujan, tempatkan user di tempat indoor/terlindung.`
        : "";

    const prompt = `
Kamu adalah asisten penyusun rencana perjalanan harian (day-trip planner) yang sangat terstruktur dan efisien.

User sudah BERADA di daerah: "${lokasi}" dan ingin menyusun agenda dari jam ${jamMulai} sampai ${jamSelesai}.

User HANYA memilih tempat-tempat berikut. Rundown WAJIB hanya memakai tempat-tempat ini dan JANGAN menambahkan tempat lain:
${daftarDipilih}

Data mentah cuaca riil per jam:
${weatherContext}

ATURAN:
- User SUDAH berada di lokasi. JANGAN buat aktivitas "perjalanan menuju...", "berangkat ke...", "tiba di lokasi", atau "sarapan di perjalanan". Rundown WAJIB langsung dimulai dari aktivitas di salah satu tempat pilihan tepat pada jam ${jamMulai}.
- Terjemahkan semua istilah kondisi cuaca dari Bahasa Inggris ke Bahasa Indonesia baku (Sunny -> Cerah, Clear -> Cerah, Partly Cloudy -> Berawan Sebagian, Cloudy -> Berawan, Overcast -> Mendung, Mist -> Berkabut, Patchy rain nearby -> Hujan Ringan di Sekitar, Light rain -> Hujan Ringan, Moderate rain -> Hujan Sedang, Heavy rain -> Hujan Lebat, Thundery outbreaks -> Berpotensi Petir).${aturanHujan}

Balas HANYA dengan JSON valid (tanpa teks lain, tanpa markdown fence) dengan struktur PERSIS:
{
  "rekomendasi": ["Nama tempat yang dipakai", "..."],
  "rundown": [
    { "waktu": "07:00 - 11:00", "tempat": "Nama Tempat", "aktivitas": ["kegiatan 1", "kegiatan 2"] }
  ],
  "cuaca": [
    { "jam": "12:00", "kondisi": "Cerah", "hujan": 2, "suhu": 32 }
  ],
  "kesimpulan": "Satu kalimat: udara cenderung terik/panas atau adem/sejuk."
}
`;

    const raw = await callGemini(prompt);
    return extractJson(raw);
}

module.exports = {
    callGemini,
    extractJson,
    titleCase,
    parseJam,
    ambilCuaca,
    generateDaftarTempat,
    generateRundownData
};
