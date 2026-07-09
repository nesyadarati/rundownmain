const { generateRundownData } = require("../planner");

module.exports = async (req, res) => {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
    }
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

        return res.status(200).json(data);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Gagal menyusun rundown." });
    }
};
