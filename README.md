# 🗺️ Rundown Main — Day Trip Planner

Bot Telegram cerdas untuk merencanakan perjalanan harian dengan prediksi cuaca real-time. Cukup sebutkan lokasi dan waktu, bot akan memberikan rekomendasi tempat terbaik beserta jadwal yang optimal.

## ✨ Fitur Utama

- 🤖 **Bot Telegram Interaktif** - Chat natural tanpa perlu command rumit
- 🌤️ **Prediksi Cuaca Real-time** - Integrasi OpenWeather API untuk akurasi tinggi
- 📍 **Rekomendasi Tempat Dinamis** - 10 pilihan tempat yang disesuaikan dengan lokasi dan waktu
- 📝 **Rundown Otomatis** - Jadwal kegiatan lengkap dengan detail aktivitas
- 🔄 **Fleksibel** - Bisa rombak jadwal untuk menghindari hujan atau ganti pilihan tempat
- 🌐 **Dashboard Web** - Interface web modern untuk pengalaman yang lebih visual

## 🚀 Quick Start

### Prasyarat
- Node.js v14+
- Telegram Bot Token (dari [@BotFather](https://t.me/BotFather))
- OpenWeather API Key (dari [OpenWeather](https://openweathermap.org/api))

### Instalasi

1. **Clone repository**
```bash
git clone <repository-url>
cd rundown-main
```

2. **Install dependencies**
```bash
npm install
```

3. **Setup environment variables**
```bash
cp .env.example .env
```

Edit file `.env` dan isi dengan credentials Anda:
```env
BOT_TOKEN=your_telegram_bot_token_here
OPENWEATHER_API_KEY=your_openweather_api_key_here
PORT=3000
```

4. **Jalankan bot**
```bash
npm start
```

Bot akan berjalan di:
- **Telegram**: Chat dengan bot Anda
- **Web Dashboard**: http://localhost:3000

## 📖 Cara Menggunakan

### Via Telegram Bot

1. **Mulai percakapan** dengan bot Anda
2. **Sebutkan lokasi dan waktu**:
   ```
   cileungsi dari jam 12 siang sampe 8 malem
   ```
3. **Pilih tempat** dari 10 rekomendasi yang diberikan (balas dengan nomor)
4. **Lihat rundown** lengkap dengan jadwal dan info cuaca
5. **Opsi lanjutan**:
   - Ketik `rombak` → atur ulang jadwal menghindari hujan
   - Ketik `lain` → minta rekomendasi tempat lain
   - Ketik `oke` → konfirmasi rencana

### Via Web Dashboard

1. Buka http://localhost:3000
2. Masukkan lokasi dan waktu
3. Pilih tempat yang diinginkan
4. Lihat rundown dengan timeline visual yang cantik

## 🏗️ Struktur Project

```
rundown-main/
├── index.js              # Bot Telegram utama
├── planner.js            # Logic perencanaan & AI
├── server.js             # Express server & API endpoints
├── package.json          # Dependencies & scripts
├── .env                  # Environment variables (create from .env.example)
├── .gitignore           # Git ignore rules
├── public/              # Dashboard web
│   ├── index.html       # HTML structure
│   ├── style.css        # Styling modern dark theme
│   └── app.js           # Frontend logic
└── README.md            # Dokumentasi ini
```

## 🔧 Teknologi

- **Backend**: Node.js, Express, Telegraf
- **Frontend**: Vanilla JavaScript, CSS3 (Dark Theme)
- **API**: OpenWeather API, Groq AI (LLM)
- **Styling**: Modern CSS dengan animations & gradients

## 📝 API Endpoints

### POST `/api/places`
Mendapatkan daftar rekomendasi tempat.

**Request Body:**
```json
{
  "input": "cileungsi dari jam 12 siang sampe 8 malem",
  "exclude": []
}
```

**Response:**
```json
{
  "lokasi": "cileungsi",
  "jamMulai": "12:00",
  "jamSelesai": "20:00",
  "weatherContext": "...",
  "cuacaList": [...],
  "daftarTempat": ["tempat1", "tempat2", ...]
}
```

### POST `/api/rundown`
Menyusun rundown berdasarkan tempat yang dipilih.

**Request Body:**
```json
{
  "lokasi": "cileungsi",
  "jamMulai": "12:00",
  "jamSelesai": "20:00",
  "weatherContext": "...",
  "tempatDipilih": ["tempat1", "tempat2"],
  "hindariHujan": false
}
```

## 🎨 Fitur Dashboard Web

- ✨ **Dark Theme Modern** - Desain elegan dengan gradient animations
- 📱 **Responsive** - Tampil sempurna di desktop & mobile
- 🎯 **Interactive Timeline** - Visualisasi jadwal yang intuitif
- 🌤️ **Weather Cards** - Info cuaca dengan emoji dinamis
- 🔄 **Smooth Transitions** - Animasi halus di setiap interaksi

## 🐛 Troubleshooting

**Bot tidak merespons di Telegram:**
- Pastikan `BOT_TOKEN` valid di file `.env`
- Cek koneksi internet
- Lihat console untuk error messages

**API cuaca error:**
- Verifikasi `OPENWEATHER_API_KEY` aktif
- Cek quota API Anda di OpenWeather dashboard

**Dashboard web tidak bisa diakses:**
- Pastikan server berjalan (`npm start`)
- Cek port 3000 tidak digunakan aplikasi lain
- Coba akses http://localhost:3000

## 📄 License

MIT License - Bebas digunakan dan dimodifikasi.

## 🤝 Kontribusi

Pull requests dan issues sangat diterima! Mari bersama membuat project ini lebih baik.

## 👨‍💻 Author

Dibuat dengan ❤️ untuk memudahkan perencanaan perjalanan harian.

---

**Selamat merencanakan perjalanan Anda! 🗺️✨**
