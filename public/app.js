// State management
let state = {
    lokasi: null,
    jamMulai: null,
    jamSelesai: null,
    weatherContext: null,
    cuacaList: [],
    daftarTempat: [],
    tempatDipilih: [],
    exclude: [],
    tempatManual: [] // Tempat yang ditambahkan manual via Google Maps
};

const placeEmojis = ['🏛️', '🍽️', '☕', '🌳', '🎨', '🎭', '🏖️', '🛍️', '🎪', '🏯'];

// Helper functions
function showElement(id) { document.getElementById(id).classList.remove('hidden'); }
function hideElement(id) { document.getElementById(id).classList.add('hidden'); }

function getWeatherEmoji(kondisi) {
    const k = kondisi.toLowerCase();
    if (k.includes('cerah') || k.includes('sunny') || k.includes('clear')) return '☀️';
    if (k.includes('berawan') || k.includes('cloudy')) return '⛅';
    if (k.includes('mendung') || k.includes('overcast')) return '☁️';
    if (k.includes('hujan') && (k.includes('lebat') || k.includes('heavy'))) return '🌧️';
    if (k.includes('hujan')) return '🌦️';
    if (k.includes('petir') || k.includes('thunder')) return '⛈️';
    if (k.includes('kabut') || k.includes('mist')) return '🌫️';
    return '🌤️';
}

function titleCase(str) {
    return String(str).replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1));
}

// Step 1: Cari Tempat
async function cariTempat(refresh = false) {
    const input = document.getElementById('input-lokasi').value.trim();
    if (!input) {
        showError('error-input', 'Lokasi wajib diisi!');
        return;
    }

    hideElement('error-input');
    setLoading('btn-cari', true);

    try {
        const response = await fetch('/api/places', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                input: input,
                exclude: refresh ? state.exclude : []
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Gagal mengambil data');
        }

        // Update state
        state.lokasi = data.lokasi;
        state.jamMulai = data.jamMulai;
        state.jamSelesai = data.jamSelesai;
        state.weatherContext = data.weatherContext;
        state.cuacaList = data.cuacaList || [];
        state.daftarTempat = data.daftarTempat;
        state.tempatDipilih = [];
        if (refresh) {
            state.exclude = [...state.exclude, ...data.daftarTempat];
        } else {
            state.exclude = [...data.daftarTempat];
        }

        // Render places
        renderPlaces();
        
        // Show step 2
        hideElement('step-input');
        showElement('step-places');
        document.getElementById('step-places').classList.add('fade-in');

    } catch (error) {
        showError('error-input', error.message);
    } finally {
        setLoading('btn-cari', false);
    }
}

// Render places grid
function renderPlaces() {
    const grid = document.getElementById('places-grid');
    const subtitle = document.getElementById('places-subtitle');
    
    subtitle.textContent = `${titleCase(state.lokasi)} • ${state.jamMulai} - ${state.jamSelesai}`;
    
    grid.innerHTML = state.daftarTempat.map((tempat, idx) => `
        <div class="place-item" onclick="togglePlace(${idx})" data-idx="${idx}">
            <div class="checkbox"></div>
            <span class="place-emoji">${placeEmojis[idx % 10]}</span>
            <span class="place-name">${tempat}</span>
        </div>
    `).join('');
}

// Toggle place selection
function togglePlace(idx) {
    const item = document.querySelector(`.place-item[data-idx="${idx}"]`);
    const tempat = state.daftarTempat[idx];
    
    if (state.tempatDipilih.includes(tempat)) {
        state.tempatDipilih = state.tempatDipilih.filter(t => t !== tempat);
        item.classList.remove('selected');
    } else {
        state.tempatDipilih.push(tempat);
        item.classList.add('selected');
    }
}

// Step 2: Susun Rundown
async function susunRundown() {
    if (state.tempatDipilih.length === 0) {
        alert('Pilih minimal satu tempat!');
        return;
    }

    setLoading('btn-susun', true);

    try {
        const response = await fetch('/api/rundown', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                lokasi: state.lokasi,
                jamMulai: state.jamMulai,
                jamSelesai: state.jamSelesai,
                weatherContext: state.weatherContext,
                tempatDipilih: state.tempatDipilih,
                hindariHujan: false
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Gagal menyusun rundown');
        }

        renderRundown(data);
        
        hideElement('step-places');
        showElement('step-result');
        document.getElementById('step-result').classList.add('fade-in');

    } catch (error) {
        alert('Error: ' + error.message);
    } finally {
        setLoading('btn-susun', false);
    }
}

// Rombak rundown
async function rombakRundown() {
    showElement('step-places');
    hideElement('step-result');
    setLoading('btn-susun', true);

    try {
        const response = await fetch('/api/rundown', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                lokasi: state.lokasi,
                jamMulai: state.jamMulai,
                jamSelesai: state.jamSelesai,
                weatherContext: state.weatherContext,
                tempatDipilih: state.tempatDipilih,
                hindariHujan: true
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Gagal merombak rundown');
        }

        renderRundown(data);
        
        hideElement('step-places');
        showElement('step-result');

    } catch (error) {
        alert('Error: ' + error.message);
    } finally {
        setLoading('btn-susun', false);
    }
}

// Render rundown result
function renderRundown(data) {
    // Title
    document.getElementById('result-title').textContent = `🗺️ Rencana di ${titleCase(state.lokasi)}`;
    document.getElementById('result-subtitle').textContent = `${state.jamMulai} - ${state.jamSelesai}`;

    // Recommendations
    const recsEl = document.getElementById('result-recs');
    recsEl.innerHTML = (data.rekomendasi || []).map(r => 
        `<span class="rec-tag">📍 ${r}</span>`
    ).join('');

    // Timeline
    const timelineEl = document.getElementById('result-timeline');
    timelineEl.innerHTML = (data.rundown || []).map(item => `
        <div class="timeline-item">
            <div class="timeline-dot"></div>
            <div class="timeline-content">
                <div class="timeline-time">⏰ ${item.waktu}</div>
                ${item.tempat ? `<div class="timeline-place">📍 ${item.tempat}</div>` : ''}
                <ul class="timeline-activities">
                    ${(item.aktivitas || []).map(a => `<li>${a}</li>`).join('')}
                </ul>
            </div>
        </div>
    `).join('');

    // Weather
    const weatherEl = document.getElementById('result-weather');
    weatherEl.innerHTML = (data.cuaca || []).map(c => `
        <div class="weather-item">
            <div class="weather-emoji">${getWeatherEmoji(c.kondisi)}</div>
            <div class="weather-time">${c.jam}</div>
            <div class="weather-cond">${c.kondisi}</div>
            <div class="weather-stats">
                <span>🌡️ ${c.suhu}°C</span>
                <span>💧 ${c.hujan}%</span>
            </div>
        </div>
    `).join('');

    // Conclusion
    const conclusionEl = document.getElementById('result-conclusion');
    if (data.kesimpulan) {
        conclusionEl.textContent = `💡 ${data.kesimpulan}`;
        conclusionEl.classList.remove('hidden');
    } else {
        conclusionEl.classList.add('hidden');
    }
}

// Navigation
function goToPlaces() {
    hideElement('step-result');
    showElement('step-places');
}

function resetAll() {
    state = {
        lokasi: null,
        jamMulai: null,
        jamSelesai: null,
        weatherContext: null,
        cuacaList: [],
        daftarTempat: [],
        tempatDipilih: [],
        exclude: []
    };
    
    hideElement('step-places');
    hideElement('step-result');
    showElement('step-input');
    document.getElementById('input-lokasi').value = '';
}

// Utility functions
function setLoading(btnId, loading) {
    const btn = document.getElementById(btnId);
    const text = document.getElementById(`${btnId}-text`);
    const spinner = document.getElementById(`${btnId}-spinner`);
    
    if (loading) {
        btn.disabled = true;
        text.classList.add('hidden');
        spinner.classList.remove('hidden');
    } else {
        btn.disabled = false;
        text.classList.remove('hidden');
        spinner.classList.add('hidden');
    }
}

function showError(elementId, message) {
    const el = document.getElementById(elementId);
    el.textContent = message;
    el.classList.remove('hidden');
}

// Tambah tempat manual via Google Maps link
async function tambahTempatManual() {
    const input = document.getElementById('input-maps-link');
    const url = input.value.trim();
    
    if (!url) {
        showError('error-maps', 'Link Google Maps wajib diisi!');
        return;
    }
    
    hideElement('error-maps');
    setLoading('btn-tambah-tempat', true);
    
    try {
        const response = await fetch('/api/parse-maps', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: url })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Gagal memproses link Google Maps');
        }
        
        // Tambahkan ke daftar tempat manual
        const tempatBaru = {
            nama: data.nama,
            mapsUrl: data.mapsUrl,
            lat: data.lat,
            lng: data.lng,
            sumber: 'manual'
        };
        
        state.tempatManual.push(tempatBaru);
        input.value = '';
        
        // Render ulang daftar tempat manual
        renderTempatManual();
        
    } catch (error) {
        showError('error-maps', error.message);
    } finally {
        setLoading('btn-tambah-tempat', false);
    }
}

// Render daftar tempat manual yang sudah ditambahkan
function renderTempatManual() {
    const container = document.getElementById('tempat-manual-list');
    
    if (state.tempatManual.length === 0) {
        container.innerHTML = '';
        return;
    }
    
    container.innerHTML = `
        <div style="font-size:.85rem;color:var(--text-secondary);margin-bottom:.5rem;font-weight:600;">
            Tempat Manual (${state.tempatManual.length}):
        </div>
        ${state.tempatManual.map((t, idx) => `
            <div style="display:flex;align-items:center;gap:.5rem;padding:.5rem;background:var(--bg-primary);border-radius:8px;margin-bottom:.5rem;">
                <span style="flex:1;font-size:.9rem;">📍 ${t.nama}</span>
                <a href="${t.mapsUrl}" target="_blank" style="color:var(--accent);text-decoration:none;font-size:.8rem;">🔗 Maps</a>
                <button onclick="hapusTempatManual(${idx})" style="background:none;border:none;color:var(--error);cursor:pointer;font-size:1rem;padding:0 .25rem;">×</button>
            </div>
        `).join('')}
    `;
}

// Hapus tempat manual
function hapusTempatManual(idx) {
    state.tempatManual.splice(idx, 1);
    renderTempatManual();
}

// Override togglePlace untuk support tempat manual
const originalTogglePlace = togglePlace;
togglePlace = function(idx) {
    const item = document.querySelector(`.place-item[data-idx="${idx}"]`);
    const tempat = state.daftarTempat[idx];
    
    if (state.tempatDipilih.includes(tempat)) {
        state.tempatDipilih = state.tempatDipilih.filter(t => t !== tempat);
        item.classList.remove('selected');
    } else {
        state.tempatDipilih.push(tempat);
        item.classList.add('selected');
    }
};

// Tambah fungsi untuk toggle tempat manual
function toggleTempatManual(idx) {
    const item = document.querySelector(`.manual-place-item[data-idx="${idx}"]`);
    const tempat = state.tempatManual[idx];
    const namaTempat = tempat.nama;
    
    if (state.tempatDipilih.includes(namaTempat)) {
        state.tempatDipilih = state.tempatDipilih.filter(t => t !== namaTempat);
        item.classList.remove('selected');
    } else {
        state.tempatDipilih.push(namaTempat);
        item.classList.add('selected');
    }
}

// Override renderPlaces untuk include tempat manual
const originalRenderPlaces = renderPlaces;
renderPlaces = function() {
    const grid = document.getElementById('places-grid');
    const subtitle = document.getElementById('places-subtitle');
    
    subtitle.textContent = `${titleCase(state.lokasi)} • ${state.jamMulai} - ${state.jamSelesai}`;
    
    // Render tempat dari AI
    let html = state.daftarTempat.map((tempat, idx) => `
        <div class="place-item" onclick="togglePlace(${idx})" data-idx="${idx}">
            <div class="checkbox"></div>
            <span class="place-emoji">${placeEmojis[idx % 10]}</span>
            <span class="place-name">${tempat}</span>
        </div>
    `).join('');
    
    // Render tempat manual jika ada
    if (state.tempatManual.length > 0) {
        html += `
            <div style="grid-column:1/-1;margin-top:1rem;padding-top:1rem;border-top:1px solid var(--border);">
                <div style="font-size:.85rem;color:var(--text-secondary);margin-bottom:.75rem;font-weight:600;">
                    📍 Tempat Manual (${state.tempatManual.length})
                </div>
            </div>
        `;
        html += state.tempatManual.map((tempat, idx) => `
            <div class="place-item manual-place-item" onclick="toggleTempatManual(${idx})" data-idx="${idx}">
                <div class="checkbox"></div>
                <span class="place-emoji">📍</span>
                <span class="place-name">${tempat.nama}</span>
            </div>
        `).join('');
    }
    
    grid.innerHTML = html;
};

// Override resetAll untuk reset tempat manual
const originalResetAll = resetAll;
resetAll = function() {
    state = {
        lokasi: null,
        jamMulai: null,
        jamSelesai: null,
        weatherContext: null,
        cuacaList: [],
        daftarTempat: [],
        tempatDipilih: [],
        exclude: [],
        tempatManual: []
    };
    
    hideElement('step-places');
    hideElement('step-result');
    showElement('step-input');
    document.getElementById('input-lokasi').value = '';
    document.getElementById('tempat-manual-list').innerHTML = '';
};

// Enter key support
document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('input-lokasi');
    if (input) {
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                cariTempat();
            }
        });
    }
    
    // Enter key support untuk input maps link
    const mapsInput = document.getElementById('input-maps-link');
    if (mapsInput) {
        mapsInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                tambahTempatManual();
            }
        });
    }
});
