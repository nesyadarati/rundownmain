require("dotenv").config();
const { Telegraf } = require("telegraf");
const {
    titleCase,
    parseJam,
    ambilCuaca,
    generateDaftarTempat,
    generateRundownData
} = require("./planner");

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
