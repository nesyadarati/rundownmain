require("dotenv").config();
const { Telegraf } = require("telegraf");
const axios = require("axios");

const bot = new Telegraf(process.env.BOT_TOKEN);

// State sementara per chat, buat nyimpen pilihan lokasi/jam/cuaca/daftar tempat
// antara langkah "/main" dan langkah "user milih nomor".
const userState = {};

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

function parseJam(cleanText) {
    let lokasi = cleanText;
    let jamMulai = "07:00";
    let jamSelesai = "21:00";

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

// Minta LLM menghasilkan daftar tempat bernomor untuk dipilih user.
async function generateDaftarTempat(lokasi, jamMulai, jamSelesai) {
    const prompt = `
Kamu adalah asisten penyusun rencana perjalanan harian yang paham betul tempat-tempat menarik di suatu daerah.

Sebutkan 5 nama tempat spesifik (bisa tempat main, kuliner, cafe, atau taman) yang searah, logis, dan saling berdekatan di daerah "${lokasi}", cocok untuk agenda harian dari jam ${jamMulai} sampai ${jamSelesai}.

ATURAN OUTPUT (WAJIB DIIKUTI):
- Balas HANYA berupa daftar bernomor, satu tempat per baris.
- Format tiap baris persis: "1. Nama Tempat" (nomor, titik, spasi, lalu nama tempat).
- JANGAN tulis kalimat pembuka, deskripsi, penjelasan, atau penutup apa pun. Hanya daftar nama.

Contoh format:
1. Nama Tempat A
2. Nama Tempat B
3. Nama Tempat C
4. Nama Tempat D
5. Nama Tempat E
`;

    const raw = await callGemini(prompt);

    // Ambil nama tempat dari tiap baris "N. Nama"
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

// Minta LLM menyusun rundown berdasarkan tempat yang DIPILIH user.
async function generateRundown(lokasi, jamMulai, jamSelesai, weatherContext, tempatDipilih) {
    const daftarDipilih = tempatDipilih.map((t, i) => `${i + 1}. ${t}`).join("\n");

    const prompt = `
Kamu adalah asisten penyusun rencana perjalanan harian (day-trip planner) yang sangat terstruktur, efisien, dan mahir dalam mencocokkan jadwal aktivitas dengan prakiraan cuaca lokal.

User sudah BERADA di daerah: "${lokasi}" dan ingin menyusun agenda dari jam ${jamMulai} sampai ${jamSelesai}.

User HANYA memilih tempat-tempat berikut. Rundown WAJIB hanya memakai tempat-tempat ini dan JANGAN menambahkan tempat lain di luar daftar:
${daftarDipilih}

Berikut adalah data mentah cuaca riil per jam dari API di lokasi tersebut pada rentang waktu yang diinginkan:
${weatherContext}

Tolong buatkan respon teks bersih (plain text) yang langsung masuk ke inti informasi tanpa kalimat pembuka, tanpa basa-basi, dan tanpa kesimpulan penutup di luar format. 

⚠️ ATURAN GAYA BAHASA & FORMAT:
1. JANGAN gunakan kata sapaan atau panggilan seperti "bro", "lu", "gua", "sobat", atau sejenisnya. Gunakan bahasa yang netral, santai namun tetap sopan dan jelas.
2. JANGAN tulis kalimat basa-basi di awal seperti "Waduh siap bro, ini gua bikinin...", "Cekidot", atau "Berikut adalah rencana...". Langsung mulai dari simbol pembuka (📍).
3. JANGAN gunakan format markdown tebal ganda seperti **text**. WAJIB hanya menggunakan single asterik (*) untuk membuat teks miring/penekanan atau heading (Contoh: *Rekomendasi Tempat:* atau _Teks_).
4. Teks rundown harus dibuat bersih agar mudah di-copy-paste oleh user ke grup chat mereka.
5. User SUDAH berada di lokasi. JANGAN masukkan aktivitas "perjalanan menuju...", "berangkat ke...", "tiba di lokasi", atau sarapan di perjalanan. Rundown WAJIB langsung dimulai dari aktivitas di salah satu tempat pilihan tepat pada jam ${jamMulai}.

Silakan susun struktur respon secara persis mengikuti format di bawah ini:

📍 *Rekomendasi Tempat:*
[Tuliskan ulang tempat-tempat yang sudah dipilih user di atas]

📝 *Rundown Acara (Tinggal Copy):*
[Buat daftar lini masa atau rundown per jam yang logis dan efisien dimulai tepat dari jam ${jamMulai} sampai jam ${jamSelesai}, hanya memakai tempat-tempat pilihan di atas]

⚠️ *Pantauan Cuaca & Info Hujan:*
[Tuliskan daftar kondisi cuaca per jam berdasarkan data mentah yang diberikan di atas. WAJIB menerjemahkan semua istilah kondisi cuaca dari Bahasa Inggris ke Bahasa Indonesia yang baku dan mudah dipahami (Contoh: Sunny -> Cerah, Patchy rain nearby -> Hujan ringan di sekitar, Overcast -> Mendung, Clear -> Cerah). WAJIB sertakan angka persentase peluang hujan dan perkiraan suhu dalam derajat Celcius (°C) di setiap jamnya. Di bagian bawah daftar jam, berikan kesimpulan singkat 1 kalimat apakah udara di rentang waktu tersebut cenderung terik/panas atau adem/sejuk]

💬 *Opsi:*
Mau merombak rundown ini agar otomatis menghindari jam rawan hujan, atau sudah oke?
`;

    return callGemini(prompt);
}

bot.start((ctx) => {
    ctx.reply("👋 Halo! Ketik perintahnya seperti ini untuk mulai bikin rencana main:\n\n" +
              "`/main cileungsi dari jam 12 siang sampe 8 malem`\n\n" +
              "Nanti aku kasih daftar pilihan tempat dulu, tinggal balas nomornya (contoh: `1 3 4`), baru aku susun rundown-nya.", { parse_mode: "Markdown" });
});

bot.command("main", async (ctx) => {
    const cleanText = ctx.message.text.replace("/main", "").trim().toLowerCase();

    if (!cleanText) {
        return ctx.reply("⚠️ *Format Salah!*\nContoh: `/main sekitar cileungsi dari jam 12 siang sampe 8 malem`", { parse_mode: "Markdown" });
    }

    const { lokasi, jamMulai, jamSelesai } = parseJam(cleanText);

    await ctx.reply(`🗺️ Nyari pilihan tempat di *${lokasi}* (${jamMulai} - ${jamSelesai}) & cek langit dulu ya...`, { parse_mode: "Markdown" });

    try {
        const { weatherData, weatherContext } = await ambilCuaca(lokasi, jamMulai, jamSelesai);
        const daftarTempat = await generateDaftarTempat(lokasi, jamMulai, jamSelesai);

        if (!daftarTempat.length) {
            return ctx.reply("❌ Gagal menyusun daftar tempat. Coba ulangi lagi ya.");
        }

        // Simpan state buat langkah berikutnya
        userState[ctx.chat.id] = {
            lokasi,
            jamMulai,
            jamSelesai,
            weatherContext,
            namaLokasi: weatherData.location.name,
            daftarTempat
        };

        let msg = `📍 *Pilihan Tempat di ${weatherData.location.name.toUpperCase()}*\n`;
        msg += `━━━━━━━━━━━━━━━━━━━━\n`;
        daftarTempat.forEach((t, i) => {
            msg += `${i + 1}. ${t}\n`;
        });
        msg += `\nBalas dengan nomor tempat yang kamu mau (bisa lebih dari satu).\n`;
        msg += `Contoh: *1 3 4* atau cukup *1*`;

        return ctx.reply(msg, { parse_mode: "Markdown" });

    } catch (err) {
        console.error(err);
        return ctx.reply("❌ Gagal memproses rencana main. Pastikan nama lokasinya benar ya.");
    }
});

// Langkah 2: user balas dengan nomor pilihan tempat
bot.on("text", async (ctx) => {
    const text = ctx.message.text.trim();

    // Abaikan command (misal /main, /start) — sudah ditangani handler lain
    if (text.startsWith("/")) return;

    const state = userState[ctx.chat.id];
    if (!state) {
        return ctx.reply("Mulai dulu dengan perintah, contoh:\n`/main cileungsi dari jam 12 siang sampe 8 malem`", { parse_mode: "Markdown" });
    }

    // Ambil semua angka yang diketik user
    const nomor = (text.match(/\d+/g) || []).map(n => parseInt(n));
    const validNomor = [...new Set(nomor)].filter(n => n >= 1 && n <= state.daftarTempat.length);

    if (!validNomor.length) {
        return ctx.reply(`⚠️ Nomor tidak valid. Pilih antara 1 sampai ${state.daftarTempat.length}, contoh: *1 3*`, { parse_mode: "Markdown" });
    }

    const tempatDipilih = validNomor.map(n => state.daftarTempat[n - 1]);

    await ctx.reply(`✍️ Oke, aku susun rundown pakai: *${tempatDipilih.join(", ")}*...`, { parse_mode: "Markdown" });

    try {
        const aiResponse = await generateRundown(
            state.lokasi,
            state.jamMulai,
            state.jamSelesai,
            state.weatherContext,
            tempatDipilih
        );

        let msg = `🗺️ *RENCANA JALAN-JALAN DI ${state.namaLokasi.toUpperCase()}*\n`;
        msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;
        msg += aiResponse;

        // Rundown selesai, state boleh dibuang
        delete userState[ctx.chat.id];

        return ctx.reply(msg, { parse_mode: "Markdown" });

    } catch (err) {
        console.error(err);
        return ctx.reply("❌ Gagal menyusun rundown. Coba lagi ya.");
    }
});

bot.launch().then(() => {
    console.log("🚀 Bot Perkiraan Main & Cuaca Berhasil Jalan!");
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
