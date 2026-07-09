# Day-Trip Planner Bot

Bot Telegram penyusun rencana main harian yang mencocokkan jadwal aktivitas dengan prakiraan cuaca lokal (WeatherAPI) dan LLM.

## Alur

1. `/main <lokasi> dari jam <x> siang sampe <y> malem`
   → bot mengambil prakiraan cuaca per jam dan membalas **daftar pilihan tempat** bernomor.
2. Balas dengan nomor tempat yang dipilih (mis. `1 3 4` atau cukup `1`)
   → bot menyusun **rundown acara** hanya dari tempat yang dipilih, langsung mulai di jam mulai (tanpa aktivitas perjalanan menuju lokasi), plus pantauan cuaca per jam (kondisi diterjemahkan ke Bahasa Indonesia, lengkap dengan % peluang hujan dan suhu °C).

## Setup

```bash
npm install
cp .env.example .env   # lalu isi nilainya
node index.js
```

## Environment Variables

| Variabel | Keterangan |
|----------|-----------|
| `BOT_TOKEN` | Token bot Telegram (BotFather) |
| `WEATHER_API_KEY` | API key dari weatherapi.com |
| `LLM_BASE_URL` | Base URL endpoint LLM (OpenAI-compatible) |
| `LLM_API_KEY` | API key LLM |
| `LLM_MODEL` | Model utama |
| `LLM_FALLBACK_MODEL` | Model cadangan |
