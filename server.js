require("dotenv").config();
const express = require("express");
const path = require("path");
const {
    parseJam,
    ambilCuaca,
    generateDaftarTempat,
    generateRundownData,
    processGoogleMapsUrl,
    isGoogleMapsUrl
} = require("./planner");

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

// Ambil cuaca + daftar 10 tempat. Bisa kirim `exclude` buat minta tempat lain.
app.post("/api/places", async (req, res) => {
    try {
        const { input, exclude } = req.body || {};
        if (!input || !String(input).trim()) {
            return res.status(400).json({ error: "Lokasi wajib diisi." });
        }

        const { lokasi, jamMulai, jamSelesai } = parseJam(String(input).trim().toLowerCase());
        const { weatherContext, cuacaList } = await ambilCuaca(lokasi, jamMulai, jamSelesai);
        const daftarTempat = await generateDaftarTempat(lokasi, jamMulai, jamSelesai, exclude || []);

        if (!daftarTempat.length) {
            return res.status(502).json({ error: "Gagal menyusun daftar tempat, coba lagi." });
        }

        return res.json({ lokasi, jamMulai, jamSelesai, weatherContext, cuacaList, daftarTempat });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Gagal ambil data. Pastikan nama lokasi benar." });
    }
});

// Susun rundown dari tempat yang dipilih.
app.post("/api/rundown", async (req, res) => {
    try {
        const { lokasi, jamMulai, jamSelesai, weatherContext, tempatDipilih, hindariHujan } = req.body || {};
        if (!lokasi || !Array.isArray(tempatDipilih) || !tempatDipilih.length) {
            return res.status(400).json({ error: "Pilih minimal satu tempat dulu." });
        }

        const data = await generateRundownData(
            lokasi, jamMulai || "07:00", jamSelesai || "21:00",
            weatherContext || "", tempatDipilih, !!hindariHujan
        );

        if (!data || !data.rundown) {
            return res.status(502).json({ error: "Gagal menyusun rundown, coba lagi." });
        }

        return res.json(data);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Gagal menyusun rundown." });
    }
});

// Parse Google Maps URL menjadi info tempat
app.post("/api/parse-maps", async (req, res) => {
    try {
        const { url } = req.body || {};
        if (!url || !String(url).trim()) {
            return res.status(400).json({ error: "Link Google Maps wajib diisi." });
        }

        const cleanUrl = String(url).trim();
        if (!isGoogleMapsUrl(cleanUrl)) {
            return res.status(400).json({ error: "Link tidak terdeteksi sebagai Google Maps." });
        }

        const tempat = await processGoogleMapsUrl(cleanUrl);
        if (!tempat) {
            return res.status(400).json({ error: "Gagal membaca link Google Maps. Coba link lain." });
        }

        return res.json(tempat);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Gagal memproses link Google Maps." });
    }
});

const PORT = process.env.PORT || process.env.DASHBOARD_PORT || 3000;
app.listen(PORT, () => {
    console.log(`🖥️  Dashboard jalan di http://localhost:${PORT}`);
});
