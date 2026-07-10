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
    const cuacaList = [];
    hours.forEach(h => {
        const timeStr = h.time.split(" ")[1];
        if (timeStr >= jamMulai && timeStr <= jamSelesai) {
            weatherContext += `- Jam ${timeStr}: ${h.condition.text} (Peluang Hujan: ${h.chance_of_rain}%, Suhu: ${Math.round(h.temp_c)}°C)\n`;
            cuacaList.push({ jam: timeStr, kondisi: h.condition.text, hujan: h.chance_of_rain, suhu: Math.round(h.temp_c) });
        }
    });

    return { weatherData, weatherContext, cuacaList };
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

// Parse Google Maps URL untuk extract nama tempat dan koordinat
function parseGoogleMapsUrl(url) {
    const result = { nama: null, lat: null, lng: null, placeId: null };
    
    try {
        // Extract coordinates dari URL: @lat,lng,zoom
        const coordMatch = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
        if (coordMatch) {
            result.lat = parseFloat(coordMatch[1]);
            result.lng = parseFloat(coordMatch[2]);
        }
        
        // Extract place ID: !1sPLACE_ID atau place_id=PLACE_ID
        const placeIdMatch = url.match(/place_id[=:]([a-zA-Z0-9_]+)/) || url.match(/!1s([a-zA-Z0-9_]+)/);
        if (placeIdMatch) {
            result.placeId = placeIdMatch[1];
        }
        
        // Extract nama tempat dari path URL
        // Format: /place/NAMA_PLACE/ atau /maps/place/NAMA_PLACE/
        const pathMatch = url.match(/\/place\/([^/]+)/) || url.match(/\/maps\/place\/([^/]+)/);
        if (pathMatch) {
            result.nama = decodeURIComponent(pathMatch[1].replace(/\+/g, ' ')).replace(/_/g, ' ');
        }
        
        // Extract dari query parameter q= atau query=
        const queryMatch = url.match(/[?&]q=([^&]+)/) || url.match(/[?&]query=([^&]+)/);
        if (queryMatch && !result.nama) {
            result.nama = decodeURIComponent(queryMatch[1].replace(/\+/g, ' '));
        }
        
        // Extract dari search query di URL maps
        const searchMatch = url.match(/\/search\/([^/]+)/);
        if (searchMatch && !result.nama) {
            result.nama = decodeURIComponent(searchMatch[1].replace(/\+/g, ' '));
        }
        
    } catch (e) {
        console.error('Error parsing Google Maps URL:', e);
    }
    
    return result;
}

// Cek apakah teks mengandung Google Maps URL
function isGoogleMapsUrl(text) {
    return /maps\.app\.goo\.gl|google\.com\/maps|goo\.gl\/maps/i.test(text);
}

// Resolve short URL (goo.gl/maps/...) ke full URL
async function resolveShortUrl(shortUrl) {
    try {
        const response = await axios.get(shortUrl, {
            maxRedirects: 5,
            timeout: 10000,
            validateStatus: (status) => status < 400
        });
        return response.request?.res?.responseUrl || shortUrl;
    } catch (e) {
        // Jika error karena redirect, coba ambil dari header Location
        if (e.response?.headers?.location) {
            return e.response.headers.location;
        }
        return shortUrl;
    }
}

// Geocode koordinat ke nama tempat menggunakan WeatherAPI
async function geocodeFromCoords(lat, lng) {
    try {
        const apiKey = process.env.WEATHER_API_KEY;
        const res = await axios.get(
            `http://api.weatherapi.com/v1/current.json?key=${apiKey}&q=${lat},${lng}&aqi=no`,
            { timeout: 10000 }
        );
        return res.data.location?.name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    } catch (e) {
        return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }
}

// Proses Google Maps URL menjadi info tempat yang lengkap
async function processGoogleMapsUrl(url) {
    let fullUrl = url;
    
    // Resolve short URL dulu
    if (/goo\.gl\/maps|maps\.app\.goo\.gl/i.test(url)) {
        fullUrl = await resolveShortUrl(url);
    }
    
    const parsed = parseGoogleMapsUrl(fullUrl);
    
    // Jika ada nama dari URL, gunakan itu
    if (parsed.nama) {
        return {
            nama: parsed.nama,
            lat: parsed.lat,
            lng: parsed.lng,
            mapsUrl: fullUrl,
            sumber: 'google_maps'
        };
    }
    
    // Jika ada koordinat, geocode ke nama tempat
    if (parsed.lat && parsed.lng) {
        const nama = await geocodeFromCoords(parsed.lat, parsed.lng);
        return {
            nama: nama,
            lat: parsed.lat,
            lng: parsed.lng,
            mapsUrl: fullUrl,
            sumber: 'google_maps'
        };
    }
    
    return null;
}

module.exports = {
    callGemini,
    extractJson,
    titleCase,
    parseJam,
    ambilCuaca,
    generateDaftarTempat,
    generateRundownData,
    parseGoogleMapsUrl,
    isGoogleMapsUrl,
    resolveShortUrl,
    geocodeFromCoords,
    processGoogleMapsUrl
};
