require("dotenv").config();
const { Telegraf } = require("telegraf");
const axios = require("axios");

const bot = new Telegraf(process.env.BOT_TOKEN);

// State percakapan per chat. Tetap disimpan supaya konteks nyambung:
// user bisa lanjut milih nomor, minta list lain, rombak rundown, atau ganti lokasi.
const userState = {};

// Balas dengan Markdown; kalau gagal (mis. karakter aneh di nama tempat), fallback plain text.
async function safeReply(ctx, text) {
    try {
        return await ctx.reply(text, { parse_mode: "Markdown" });
    } catch (e) {
        return ctx.reply(text);
    }
}

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
    return str.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1));
}

function parseJam(cleanText, prev) {
    let lokasi = cleanText;
    let jamMulai = (prev && prev.jamMulai) || "07:00";
    let jamSelesai = (prev && prev.jamSelesai) || "21:00";

    const matchJam = cleanText.match(/dari\s+jam\s+(\d+)\s*(siang|pagi|sore|malem)?\s+sampe\s+(\d+)\s*(siang|pagi|sore|malem)?/);

    if (matchJam) {
        lokasi = cleanText.split("dari jam")[0].trim();

        let angkaMulai = parseInt(matchJam[1]);
        const ketMulai = matchJam[2];
        let angkaSelesai = parseInt(matchJam[3]);
        const ketSelesai = matchJam[4];

        if ((ketMulai === "siang" || ketMulai === "sore" || ketMulai === "malem") && angkaMulai < 12) angkaMulai += 12;
        jamMulai = String(angkaMulai).padStart(2, "0") + ":00";

        if ((ketSelesai === "siang" || ketSelesai === "sore" || ketSelesai === "malem") && angkaSelesai < 12) angkaSelesai += 12;
        jamSelesai = String(angkaSelesai).padStart(2, "0") + ":00";
    }

    // Buang kata bantu di awal supaya nama lokasi lebih bersih
    lokasi = lokasi.replace(/^(main|jalan|jalan-jalan|di|ke|sekitar|daerah|area)\s+/gi, "").trim() || cleanText;

    return { lokasi, jamMulai, jamSelesai };
}

async function ambilCuaca(lokasi, jamMulai, jamSelesai) {
    const apiKey = process.env.WEATHER_API_KEY;
    const weatherUrl = `http://api.weatherapi.com/v1/forecast.json?key=${apiKey}&q=${encodeURIComponent(lokasi)}&days=1&aqi=no&alerts=no`;

    const weatherRes = await axios.get(weatherUrl);
    const weatherData = weatherRes.data;
    const hours = weatherData.forecast.forecastday[0].hour;

    let weatherContext = "";
    hours.forEach(h => {
        const timeStr = h.time.split(" ")[1];
        if (timeStr >= jamMulai && timeStr <= jamSelesai) {
            weatherContext += `- Jam ${timeStr}: ${h.condition.text} (Peluang Hujan: ${h.chance_of_rain}%, Suhu: ${Math.round(h.temp_c)}°C)\n`;
        }
    });

    return { weatherData, weatherContext };
}

// Minta LLM menghasilkan daftar 10 tempat bernomor. exclude = tempat yang sudah pernah disarankan.
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
- Format tiap baris persis: "1. Nama Tempat" (nomor, titik, spasi, lalu nama tempat).
- JANGAN tulis kalimat pembuka, deskripsi, penjelasan, atau penutup apa pun. Hanya daftar nama.

Contoh format:
1. Nama Tempat A
2. Nama Tempat B
...
10. Nama Tempat J
`;

    const raw = await callGemini(prompt);

    const tempat = raw
        .split("\n")
        .map(l => l.trim())
        .map(l => {
            const m = l.match(/^\d+[.)]\s*(.+)$/);
            return m ? m[1].replace(/\*/g, "").trim() : null;
        })
        .filter(Boolean);

    return tempat;
}

// Minta LLM menyusun rundown (dalam bentuk JSON) berdasarkan tempat yang DIPILIH user.
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
  "kesimpulan": "Satu kalimat: udara cenderung terik/panas atau adem/sejuk di rentang waktu tersebut."
}
`;

    const raw = await callGemini(prompt);
    return extractJson(raw);
}

// Rakit pesan rundown final. Bagian rundown dibungkus code block (monospace) biar gampang di-copy.
function formatRundownMessage(lokasi, data) {
    let msg = `🗺️ *Rencana main di sekitar ${titleCase(lokasi)}*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

    msg += `📍 *Rekomendasi Tempat:*\n`;
    (data.rekomendasi || []).forEach((t, i) => { msg += `${i + 1}. ${t}\n`; });
    msg += `\n`;

    msg += `📝 *Rundown Acara:*\n`;
    let block = "";
    (data.rundown || []).forEach(item => {
        const tempat = item.tempat ? ` | ${item.tempat}` : "";
        block += `${item.waktu}${tempat}\n`;
        (item.aktivitas || []).forEach(a => { block += `   - ${a}\n`; });
    });
    msg += "```\n" + block.trim() + "\n```\n\n";

    msg += `⚠️ *Pantauan Cuaca & Info Hujan:*\n`;
    (data.cuaca || []).forEach(c => {
        msg += `- Jam ${c.jam}: ${c.kondisi} (Peluang Hujan: ${c.hujan}%, Suhu: ${c.suhu}°C)\n`;
    });
    if (data.kesimpulan) msg += `\n${data.kesimpulan}\n`;

    msg += `\n💬 *Opsi:*\n`;
    msg += `Ketik *rombak* biar aku atur ulang jadwal menghindari jam rawan hujan, *lain* buat minta list tempat lain, atau *oke* kalau sudah pas.`;

    return msg;
}

// ==== Langkah 1: user minta lokasi (via /main ATAU langsung ketik lokasinya) ====
async function handleLokasiRequest(ctx, cleanText) {
    const prev = userState[ctx.chat.id];
    const { lokasi, jamMulai, jamSelesai } = parseJam(cleanText, prev);

    await safeReply(ctx, `🗺️ Nyari pilihan tempat di *${titleCase(lokasi)}* (${jamMulai} - ${jamSelesai}) & cek langit dulu ya...`);

    try {
        const { weatherContext } = await ambilCuaca(lokasi, jamMulai, jamSelesai);
        const daftarTempat = await generateDaftarTempat(lokasi, jamMulai, jamSelesai);

        if (!daftarTempat.length) {
            return safeReply(ctx, "❌ Gagal menyusun daftar tempat. Coba ulangi lagi ya.");
        }

        userState[ctx.chat.id] = {
            lokasi,
            jamMulai,
            jamSelesai,
            weatherContext,
            daftarTempat,
            tempatDisarankan: [...daftarTempat],
            tempatDipilih: null
        };

        return kirimDaftarTempat(ctx, lokasi, daftarTempat);
    } catch (err) {
        console.error(err);
        return safeReply(ctx, "❌ Gagal memproses rencana main. Pastikan nama lokasinya benar ya.");
    }
}

function kirimDaftarTempat(ctx, lokasi, daftarTempat) {
    let msg = `📍 *Pilihan Tempat di sekitar ${titleCase(lokasi)}*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    daftarTempat.forEach((t, i) => { msg += `${i + 1}. ${t}\n`; });
    msg += `\nBalas dengan nomor tempat yang kamu mau (bisa lebih dari satu).\n`;
    msg += `Contoh: *1 3 4* atau cukup *1*.\n`;
    msg += `Kurang cocok? Ketik *lain* biar aku kasih pilihan tempat yang beda.`;
    return safeReply(ctx, msg);
}

// ==== Susun rundown dari tempat yang dipilih ====
async function buatRundown(ctx, state, tempatDipilih, hindariHujan) {
    const info = hindariHujan ? " (dirombak biar hindari jam hujan)" : "";
    await safeReply(ctx, `✍️ Oke, aku susun rundown pakai: *${tempatDipilih.join(", ")}*${info}...`);

    try {
        const data = await generateRundownData(
            state.lokasi, state.jamMulai, state.jamSelesai,
            state.weatherContext, tempatDipilih, hindariHujan
        );

        if (!data || !data.rundown) {
            return safeReply(ctx, "❌ Gagal menyusun rundown. Coba lagi ya.");
        }

        state.tempatDipilih = tempatDipilih;
        return safeReply(ctx, formatRundownMessage(state.lokasi, data));
    } catch (err) {
        console.error(err);
        return safeReply(ctx, "❌ Gagal menyusun rundown. Coba lagi ya.");
    }
}

bot.start((ctx) => {
    ctx.reply("👋 Halo! Sebutin aja lokasinya, contoh:\n\n" +
              "`cileungsi dari jam 12 siang sampe 8 malem`\n\n" +
              "Nanti aku kasih 10 pilihan tempat dulu. Tinggal balas nomornya (contoh: `1 3 4`), baru aku susun rundown-nya. " +
              "Kurang suka listnya? Ketik `lain`. Gak perlu pakai `/main` kok.", { parse_mode: "Markdown" });
});

// Tetap dukung /main biar kompatibel
bot.command("main", async (ctx) => {
    const cleanText = ctx.message.text.replace("/main", "").trim().toLowerCase();
    if (!cleanText) {
        return safeReply(ctx, "⚠️ *Format:* `cileungsi dari jam 12 siang sampe 8 malem`");
    }
    return handleLokasiRequest(ctx, cleanText);
});

// Router utama: tangani semua teks biasa secara "spontan" tanpa perlu command.
bot.on("text", async (ctx) => {
    const raw = ctx.message.text.trim();
    if (raw.startsWith("/")) return; // command lain sudah ditangani

    const text = raw.toLowerCase();
    const state = userState[ctx.chat.id];

    // Affirmasi / basa-basi
    if (/^(oke|ok|okay|sip|mantap|makasih|terima kasih|thanks|thank you|gas|siap|cukup)\b/.test(text)) {
        return safeReply(ctx, "👍 Siap, selamat jalan-jalan! Kalau mau rencana lokasi lain tinggal sebutin aja.");
    }

    if (state && state.daftarTempat && state.daftarTempat.length) {
        // Minta list tempat lain
        if (/(lain|ganti|yang lain|kurang suka|nggak suka|ga suka|gak suka|opsi lain|saran lain|acak|refresh)/.test(text)) {
            await safeReply(ctx, "🔄 Oke, aku cariin pilihan tempat yang beda...");
            try {
                const baru = await generateDaftarTempat(state.lokasi, state.jamMulai, state.jamSelesai, state.tempatDisarankan);
                if (!baru.length) return safeReply(ctx, "❌ Gagal cari tempat lain. Coba lagi ya.");
                state.daftarTempat = baru;
                state.tempatDisarankan = [...state.tempatDisarankan, ...baru];
                return kirimDaftarTempat(ctx, state.lokasi, baru);
            } catch (err) {
                console.error(err);
                return safeReply(ctx, "❌ Gagal cari tempat lain. Coba lagi ya.");
            }
        }

        // Rombak rundown biar hindari hujan (butuh pilihan tempat sebelumnya)
        if (state.tempatDipilih && /(rombak|hindari|rawan|atur ulang|geser|ubah jam)/.test(text)) {
            return buatRundown(ctx, state, state.tempatDipilih, true);
        }

        // Pilih nomor tempat
        if (/^[\d\s,.]+$/.test(text)) {
            const nomor = (text.match(/\d+/g) || []).map(n => parseInt(n));
            const validNomor = [...new Set(nomor)].filter(n => n >= 1 && n <= state.daftarTempat.length);
            if (!validNomor.length) {
                return safeReply(ctx, `⚠️ Nomor tidak valid. Pilih antara 1 sampai ${state.daftarTempat.length}, contoh: *1 3*`);
            }
            const tempatDipilih = validNomor.map(n => state.daftarTempat[n - 1]);
            return buatRundown(ctx, state, tempatDipilih, false);
        }
    }

    // Selain itu: anggap ini permintaan lokasi baru
    return handleLokasiRequest(ctx, text);
});

bot.launch().then(() => {
    console.log("🚀 Bot Perkiraan Main & Cuaca Berhasil Jalan!");
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
