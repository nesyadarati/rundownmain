const { parseJam, ambilCuaca, generateDaftarTempat } = require("../planner");

module.exports = async (req, res) => {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
    }
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

        return res.status(200).json({ lokasi, jamMulai, jamSelesai, weatherContext, cuacaList, daftarTempat });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Gagal ambil data. Pastikan nama lokasi benar." });
    }
};
