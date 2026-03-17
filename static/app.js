/**
 * Elsie — AI Grocery Coach Frontend v14
 * ======================================
 * Cosmetic updates:
 *   - Color-coded health markers (green/yellow/red + arrows)
 *   - Fixed silent/mute button
 *   - Personalized greeting based on conditions
 *   - Typing animation while Elsie thinks
 *   - Better mic labels (Mic On/Mic Off)
 *   - Powered by Gemini badge (in HTML via camera overlay)
 *   - FIX: Camera cleanup on restart (prevents black screen)
 *   - FIX: Graceful handling of non-lab reports (0 markers)
 */

// ============================================================
// App State
// ============================================================

const APP = {
    userId: null,
    ws: null,
    mediaStream: null,
    isCameraOn: false,
    isSilentMode: false,
    isListening: false,
    selectedConditions: [],
    videoInterval: null,
    recognition: null,
    videoEl: null,
    silenceTimer: null,
    lastInteraction: Date.now(),
    SILENCE_TIMEOUT: 60000,
};

// ============================================================
// Health Marker Reference Ranges
// ============================================================

const MARKER_RANGES = {
    a1c:              { low: null, normalLow: 0,   normalHigh: 5.6, borderHigh: 6.4,  unit: '%' },
    fasting_glucose:  { low: 54,  normalLow: 70,  normalHigh: 99,  borderHigh: 125,  unit: 'mg/dL' },
    ldl:              { low: null, normalLow: 0,   normalHigh: 99,  borderHigh: 129,  unit: 'mg/dL' },
    hdl:              { low: 40,  normalLow: 40,  normalHigh: 999, borderHigh: null,  unit: 'mg/dL', inverse: true },
    triglycerides:    { low: null, normalLow: 0,   normalHigh: 149, borderHigh: 199,  unit: 'mg/dL' },
    sodium:           { low: 136, normalLow: 136, normalHigh: 145, borderHigh: 150,  unit: 'mEq/L' },
    potassium:        { low: 3.5, normalLow: 3.5, normalHigh: 5.0, borderHigh: 5.5,  unit: 'mEq/L' },
    egfr:             { low: 60,  normalLow: 60,  normalHigh: 999, borderHigh: null,  unit: 'mL/min', inverse: true },
    blood_pressure_systolic:  { low: null, normalLow: 90, normalHigh: 120, borderHigh: 139, unit: 'mmHg' },
    blood_pressure_diastolic: { low: null, normalLow: 60, normalHigh: 80,  borderHigh: 89,  unit: 'mmHg' },
};

function getMarkerStatus(key, value) {
    const range = MARKER_RANGES[key];
    if (!range || value === null || value === undefined) return { color: 'normal', arrow: '' };
    const v = parseFloat(value);
    if (isNaN(v)) return { color: 'normal', arrow: '' };
    if (range.inverse) {
        if (range.low !== null && v < range.low) return { color: 'abnormal', arrow: '' };
        if (v < range.normalLow) return { color: 'borderline', arrow: '' };
        return { color: 'normal', arrow: '' };
    }
    if (range.low !== null && v < range.low) return { color: 'abnormal', arrow: '' };
    if (v > range.borderHigh) return { color: 'abnormal', arrow: '' };
    if (v > range.normalHigh) return { color: 'borderline', arrow: '' };
    if (range.low !== null && v < range.normalLow) return { color: 'borderline', arrow: '' };
    return { color: 'normal', arrow: '' };
}

// ============================================================
// Onboarding: Health Condition Selection
// ============================================================

document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
        chip.classList.toggle('selected');
        const condition = chip.dataset.condition;
        if (chip.classList.contains('selected')) {
            APP.selectedConditions.push(condition);
        } else {
            APP.selectedConditions = APP.selectedConditions.filter(c => c !== condition);
        }
        updateSelectionSummary();
    });
});

function updateSelectionSummary() {
    const el = document.getElementById('selection-summary');
    if (APP.selectedConditions.length === 0) {
        el.textContent = '';
    } else {
        const count = APP.selectedConditions.length;
        el.textContent = `Got it! Elsie will filter for ${count} dietary goal${count > 1 ? 's' : ''}.`;
    }
}

// ============================================================
// Onboarding: Lab Report Upload with Color-coded Markers
// ============================================================

document.getElementById('lab-report').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const validTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'];
    if (!validTypes.includes(file.type) && !file.name.match(/\.(pdf|png|jpg|jpeg)$/i)) {
        showUploadStatus('Please upload a PDF, PNG, or JPG file.', 'error');
        return;
    }
    showUploadStatus('Elsie is reading your report...', 'loading');
    const userId = getOrCreateUserId();
    const formData = new FormData();
    formData.append('file', file);
    try {
        const resp = await fetch(`/api/upload-report/${userId}`, { method: 'POST', body: formData });
        const data = await resp.json();
        if (data.status === 'markers_extracted') {
            displayExtractedMarkers(data.data);
        } else {
            showUploadStatus("Couldn't read that file. Try a clearer image or PDF.", 'error');
        }
    } catch (err) {
        showUploadStatus('Upload failed. Check connection and try again.', 'error');
    }
});

function showUploadStatus(text, type) {
    const el = document.getElementById('upload-status');
    el.textContent = text;
    el.className = 'upload-status ' + type;
}

function displayExtractedMarkers(data) {
    const markers = data.markers || {};
    const conditions = data.conditions_detected || [];
    const foundMarkers = Object.entries(markers).filter(([k, v]) => v !== null);
    const markerCount = foundMarkers.length;
    const topMarkers = foundMarkers.slice(0, 7);
    const hasMore = foundMarkers.length > 7;

    const markerLabels = {
        a1c: 'HbA1c', fasting_glucose: 'Fasting Glucose', ldl: 'LDL Cholesterol',
        hdl: 'HDL Cholesterol', triglycerides: 'Triglycerides', sodium: 'Sodium',
        potassium: 'Potassium', egfr: 'eGFR', iron: 'Iron', ferritin: 'Ferritin',
        vitamin_d: 'Vitamin D', vitamin_b12: 'Vitamin B12', calcium: 'Calcium',
        tsh: 'TSH', hemoglobin: 'Hemoglobin', hematocrit: 'Hematocrit',
        white_blood_cells: 'WBC', red_blood_cells: 'RBC', platelets: 'Platelets',
        alt: 'ALT', ast: 'AST', albumin: 'Albumin', creatinine: 'Creatinine',
        bun: 'BUN', glucose: 'Glucose', magnesium: 'Magnesium', phosphorus: 'Phosphorus',
        blood_pressure_systolic: 'BP Systolic', blood_pressure_diastolic: 'BP Diastolic',
        total_cholesterol: 'Total Cholesterol', uric_acid: 'Uric Acid',
        total_protein: 'Total Protein', globulin: 'Globulin', bilirubin: 'Bilirubin',
    };

    function formatLabel(key) {
        return markerLabels[key] || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }

    function buildMarkerRow(key, val) {
        const label = formatLabel(key);
        const status = getMarkerStatus(key, val);
        const colorClass = 'marker-' + status.color;
        return '<div class="marker-row"><span class="marker-label">' + label + '</span><span class="marker-value ' + colorClass + '">' + val + '</span></div>';
    }

    // Handle 0 markers gracefully
    if (markerCount === 0) {
        let html = '<div style="margin:8px 0;padding:14px;background:#FFF3E0;border-radius:8px;font-size:14px;">';
        html += '<strong style="color:#E65100;">No numeric health markers found</strong><br>';
        html += '<span style="color:#666;font-size:13px;">This looks like a diagnostic or procedure report (e.g., endoscopy, biopsy, imaging). Elsie works best with <strong>blood test / lab panel reports</strong> that contain numeric values like cholesterol, blood sugar, iron, vitamins, etc.</span>';
        html += '<br><br><span style="color:#FF6B4A;font-size:13px;font-weight:600;">Try uploading a blood work or metabolic panel report instead!</span>';
        html += '</div>';
        if (conditions.length > 0) {
            html += '<div style="margin-top:6px;font-size:13px;color:#666;">Detected conditions: ' + conditions.join(', ') + '</div>';
        }
        html += '<div style="margin-top:6px;font-size:12px;color:#999;">Report deleted. No data saved.</div>';
        const statusEl = document.getElementById('upload-status');
        statusEl.innerHTML = html;
        statusEl.className = 'upload-status success';
        conditions.forEach(condition => {
            const normalized = condition.toLowerCase().replace(/[\s-]+/g, '_');
            const chipEl = document.querySelector('[data-condition="' + normalized + '"]');
            if (chipEl && !chipEl.classList.contains('selected')) {
                chipEl.classList.add('selected');
                APP.selectedConditions.push(normalized);
            }
        });
        updateSelectionSummary();
        return;
    }

    let html = '<strong>Extracted ' + markerCount + ' health markers:</strong><br>';
    if (markerCount > 0) {
        html += '<div id="markers-preview" style="margin:8px 0;padding:10px;background:#f8f9fa;border-radius:8px;font-size:14px;cursor:pointer;">';
        topMarkers.forEach(([key, val]) => { html += buildMarkerRow(key, val); });
        if (hasMore) {
            html += '<div style="text-align:center;margin-top:8px;font-size:12px;color:#FF6B4A;font-weight:700;">Tap to see all ' + markerCount + ' markers</div>';
        }
        html += '</div>';
    }
    if (conditions.length > 0) {
        html += '<div style="margin-top:6px;font-size:13px;color:#666;">Detected: ' + conditions.join(', ') + '</div>';
    }
    html += '<div style="margin-top:6px;font-size:12px;color:#999;">Report deleted. Only markers saved.</div>';

    const statusEl = document.getElementById('upload-status');
    statusEl.innerHTML = html;
    statusEl.className = 'upload-status success';

    if (hasMore) {
        document.getElementById('markers-preview').addEventListener('click', () => {
            let popupRows = '';
            foundMarkers.forEach(([key, val]) => { popupRows += buildMarkerRow(key, val); });
            const popup = document.createElement('div');
            popup.id = 'markers-popup';
            popup.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
            popup.innerHTML = '<div style="background:#fff;border-radius:16px;padding:20px;max-width:400px;width:100%;max-height:80vh;overflow-y:auto;position:relative;">' +
                '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">' +
                '<strong style="font-size:16px;">All ' + markerCount + ' markers</strong>' +
                '<button id="close-markers-popup" style="background:none;border:none;font-size:22px;cursor:pointer;color:#636E72;padding:4px 8px;">✕</button>' +
                '</div>' +
                '<div style="font-size:14px;">' + popupRows + '</div>' +
                '</div>';
            document.body.appendChild(popup);
            document.getElementById('close-markers-popup').addEventListener('click', () => { popup.remove(); });
            popup.addEventListener('click', (e) => { if (e.target === popup) popup.remove(); });
        });
    }

    conditions.forEach(condition => {
        const normalized = condition.toLowerCase().replace(/[\s-]+/g, '_');
        const chipEl = document.querySelector('[data-condition="' + normalized + '"]');
        if (chipEl && !chipEl.classList.contains('selected')) {
            chipEl.classList.add('selected');
            APP.selectedConditions.push(normalized);
        }
    });
    updateSelectionSummary();
}

// ============================================================
// Start Shopping
// ============================================================

document.getElementById('btn-start').addEventListener('click', async () => {
    const userId = getOrCreateUserId();
    try {
        const u = new SpeechSynthesisUtterance('');
        u.volume = 0;
        speechSynthesis.speak(u);
    } catch (e) {}
    try {
        await fetch('/api/profile/' + userId, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                conditions: APP.selectedConditions,
                dietary_preferences: APP.selectedConditions.filter(c => ['vegetarian', 'vegan', 'dairy_free'].includes(c)),
                allergies: APP.selectedConditions.filter(c => ['nut_allergy', 'celiac'].includes(c)),
            }),
        });
    } catch (err) {}
    document.getElementById('screen-onboard').classList.remove('active');
    document.getElementById('screen-coach').classList.add('active');
    await startCamera();
    connectWebSocket(userId);
    startContinuousListening();
    startSilenceMonitor();
    const greeting = buildPersonalizedGreeting();
    addMessage('elsie', greeting);
    speakText(greeting);
});

function buildPersonalizedGreeting() {
    const conditions = APP.selectedConditions;
    let base = "Hey there! I'm Elsie, your grocery buddy!";
    if (conditions.length === 0) {
        return base + " Just hold up any product and ask me about it!";
    }
    const focuses = [];
    if (conditions.includes('diabetes') || conditions.includes('pre_diabetes')) focuses.push("sugars and carbs");
    if (conditions.includes('high_cholesterol')) focuses.push("fats and cholesterol");
    if (conditions.includes('hypertension')) focuses.push("sodium levels");
    if (conditions.includes('kidney_disease')) focuses.push("phosphorus and potassium");
    if (conditions.includes('celiac')) focuses.push("gluten");
    if (conditions.includes('nut_allergy')) focuses.push("nut allergens");
    if (conditions.includes('vegetarian') || conditions.includes('vegan')) focuses.push("plant-based options");
    if (focuses.length > 0) {
        base += " I'll keep a special eye on " + focuses.join(", ") + " for you!";
    }
    return base + " Hold up any product and ask me about it!";
}

// ============================================================
// Camera
// ============================================================

async function startCamera() {
    const waitingEl = document.getElementById('camera-waiting');

    // Clean up any previous camera stream (prevents black screen on restart)
    if (APP.mediaStream) {
        APP.mediaStream.getTracks().forEach(t => t.stop());
        APP.mediaStream = null;
    }
    if (APP.videoEl) {
        APP.videoEl.srcObject = null;
    }

    try {
        let constraints = { video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false };
        try {
            APP.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch (e) {
            constraints = { video: true, audio: false };
            APP.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
        }
        APP.videoEl = document.getElementById('camera-feed');
        APP.videoEl.srcObject = APP.mediaStream;
        await new Promise((resolve) => {
            APP.videoEl.onloadedmetadata = () => { APP.videoEl.play().then(resolve).catch(resolve); };
            setTimeout(resolve, 3000);
        });
        APP.isCameraOn = true;
        waitingEl.classList.add('hidden');
        startVideoStreaming();
        document.getElementById('scan-indicator').classList.add('active');
    } catch (err) {
        console.error('Camera error:', err);
        waitingEl.querySelector('.waiting-text').textContent = 'Camera unavailable';
        addMessage('elsie', "No camera? Use the Type button to describe what you're looking at!");
    }
}

function startVideoStreaming() {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');
    APP.videoInterval = setInterval(() => {
        if (!APP.isCameraOn || !APP.ws || APP.ws.readyState !== WebSocket.OPEN) return;
        if (APP.videoEl.readyState < 2) return;
        ctx.drawImage(APP.videoEl, 0, 0, canvas.width, canvas.height);
        const base64 = canvas.toDataURL('image/jpeg', 0.6).split(',')[1];
        APP.ws.send(JSON.stringify({ type: 'video', data: base64 }));
    }, 3000);
}

function captureFrame() {
    if (!APP.videoEl || APP.videoEl.readyState < 2) return null;
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    canvas.getContext('2d').drawImage(APP.videoEl, 0, 0, 640, 480);
    return canvas.toDataURL('image/jpeg', 0.7).split(',')[1];
}

// ============================================================
// WebSocket: Gemini Live API
// ============================================================

function connectWebSocket(userId) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = protocol + '//' + window.location.host + '/ws/' + userId;
    const statusEl = document.getElementById('connection-status');
    statusEl.className = 'connection-status';
    statusEl.querySelector('.status-text').textContent = 'Connecting to Elsie...';
    APP.ws = new WebSocket(wsUrl);
    APP.ws.onopen = () => {
        statusEl.className = 'connection-status connected';
        statusEl.querySelector('.status-text').textContent = 'Elsie is listening';
    };
    APP.ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'text' && msg.data) {
                removeTypingIndicator();
                addMessage('elsie', msg.data);
                if (!APP.isSilentMode) speakText(msg.data);
                resetSilenceTimer();
            }
        } catch (e) {}
    };
    APP.ws.onclose = () => {
        statusEl.className = 'connection-status error';
        statusEl.querySelector('.status-text').textContent = 'Reconnecting...';
        setTimeout(() => connectWebSocket(userId), 5000);
    };
    APP.ws.onerror = () => { statusEl.className = 'connection-status error'; };
}

// ============================================================
// Ask Elsie (Reliable Product Evaluation)
// ============================================================

async function askElsie(question) {
    setStatus('Elsie is thinking...');
    showTypingIndicator();
    const frame = captureFrame();
    try {
        const resp = await fetch('/api/ask/' + APP.userId, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question: question, image: frame || '' }),
        });
        const data = await resp.json();
        removeTypingIndicator();
        if (data.response) {
            addMessage('elsie', data.response);
            if (!APP.isSilentMode) speakText(data.response);
        }
    } catch (err) {
        removeTypingIndicator();
        addMessage('elsie', "Sorry, I had trouble with that. Try again?");
    }
    setStatus('Elsie is listening');
    resetSilenceTimer();
}

// ============================================================
// Typing Indicator
// ============================================================

function showTypingIndicator() {
    removeTypingIndicator();
    const el = document.getElementById('response-text');
    const indicator = document.createElement('div');
    indicator.id = 'typing-indicator';
    indicator.className = 'typing-indicator';
    indicator.innerHTML = '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>';
    el.appendChild(indicator);
    document.getElementById('response-panel').scrollTop = document.getElementById('response-panel').scrollHeight;
}

function removeTypingIndicator() {
    const existing = document.getElementById('typing-indicator');
    if (existing) existing.remove();
}

// ============================================================
// Chat Transcript
// ============================================================

function addMessage(sender, text) {
    removeTypingIndicator();
    const el = document.getElementById('response-text');
    const bubble = document.createElement('div');
    if (sender === 'elsie') {
        bubble.style.cssText = 'background:#fff;padding:12px 14px;border-radius:16px;margin:8px 0;font-size:15px;box-shadow:0 1px 3px rgba(0,0,0,0.1);';
        bubble.innerHTML = '<div style="font-size:11px;color:#FF6B4A;font-weight:600;margin-bottom:4px;">🛒 Elsie</div>' + text;
    } else {
        bubble.style.cssText = 'background:#FF6B4A;color:white;padding:10px 14px;border-radius:16px;margin:8px 0;font-size:15px;text-align:right;';
        bubble.innerHTML = '<div style="font-size:11px;color:rgba(255,255,255,0.7);margin-bottom:3px;">🗣️ You</div>' + text;
    }
    el.appendChild(bubble);
    document.getElementById('response-panel').scrollTop = document.getElementById('response-panel').scrollHeight;
}

// ============================================================
// Text-to-Speech (checks isSilentMode before every speak)
// ============================================================

function speakText(text) {
    if (APP.isSilentMode) return;
    try {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.05;
        utterance.pitch = 1.05;
        utterance.volume = 1.0;
        const voices = speechSynthesis.getVoices();
        const preferred = voices.find(v => v.name.includes('Samantha')) ||
                          voices.find(v => v.name.includes('Karen')) ||
                          voices.find(v => v.lang.startsWith('en'));
        if (preferred) utterance.voice = preferred;
        setTimeout(() => {
            if (!APP.isSilentMode) {
                speechSynthesis.speak(utterance);
            }
        }, 100);
    } catch (e) {
        console.error('Speech error:', e);
    }
}

speechSynthesis.onvoiceschanged = () => {};

// ============================================================
// Continuous Speech Recognition
// ============================================================

function startContinuousListening() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    function createRecognizer() {
        const rec = new SpeechRecognition();
        rec.continuous = false;
        rec.interimResults = true;
        rec.lang = 'en-US';
        let finalTranscript = '';
        rec.onresult = (event) => {
            let interim = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                } else {
                    interim += event.results[i][0].transcript;
                }
            }
            if (interim || finalTranscript) {
                speechSynthesis.cancel();
            }
            if (interim) setStatus('🎤 ' + interim);
        };
        rec.onend = () => {
            if (finalTranscript.trim()) {
                const text = finalTranscript.trim();
                finalTranscript = '';
                addMessage('user', text);
                askElsie(text);
                resetSilenceTimer();
            }
            if (APP.isListening) {
                setTimeout(() => {
                    if (APP.isListening) {
                        try {
                            APP.recognition = createRecognizer();
                            APP.recognition.start();
                        } catch (e) {}
                    }
                }, 300);
            }
        };
        rec.onerror = (event) => {
            if (event.error !== 'no-speech' && event.error !== 'aborted') {
                console.error('Recognition error:', event.error);
            }
        };
        return rec;
    }
    try {
        APP.isListening = true;
        APP.recognition = createRecognizer();
        APP.recognition.start();
        document.getElementById('btn-mic').classList.add('recording');
        document.getElementById('btn-mic').querySelector('.btn-label').textContent = 'Mic On';
        setStatus('Elsie is listening');
    } catch (e) {}
}

function stopContinuousListening() {
    APP.isListening = false;
    if (APP.recognition) {
        try { APP.recognition.stop(); } catch (e) {}
        APP.recognition = null;
    }
    document.getElementById('btn-mic').classList.remove('recording');
    document.getElementById('btn-mic').querySelector('.btn-label').textContent = 'Mic Off';
}

// ============================================================
// Silence Monitor
// ============================================================

function startSilenceMonitor() {
    APP.silenceTimer = setInterval(() => {
        if (Date.now() - APP.lastInteraction > APP.SILENCE_TIMEOUT) {
            const nudge = "Still shopping? Which product would you like to know about next?";
            addMessage('elsie', nudge);
            if (!APP.isSilentMode) speakText(nudge);
            resetSilenceTimer();
        }
    }, 10000);
}

function resetSilenceTimer() {
    APP.lastInteraction = Date.now();
}

// ============================================================
// UI Helpers
// ============================================================

function setStatus(text) {
    document.getElementById('connection-status').querySelector('.status-text').textContent = text;
}

// ============================================================
// Control Buttons
// ============================================================

document.getElementById('btn-mic').addEventListener('click', () => {
    if (APP.isListening) {
        stopContinuousListening();
        setStatus('Mic off — tap to resume');
    } else {
        startContinuousListening();
        setStatus('Elsie is listening');
    }
});

document.getElementById('btn-camera').addEventListener('click', () => {
    APP.isCameraOn = !APP.isCameraOn;
    document.getElementById('btn-camera').classList.toggle('active', APP.isCameraOn);
    if (!APP.isCameraOn) {
        clearInterval(APP.videoInterval);
        document.getElementById('scan-indicator').classList.remove('active');
    } else {
        startVideoStreaming();
        document.getElementById('scan-indicator').classList.add('active');
    }
});

document.getElementById('btn-text').addEventListener('click', () => {
    const bar = document.getElementById('text-input-bar');
    if (bar.style.display === 'none') {
        bar.style.display = 'flex';
        document.getElementById('text-input').focus();
        document.getElementById('btn-text').classList.add('active');
    } else {
        bar.style.display = 'none';
        document.getElementById('btn-text').classList.remove('active');
    }
});

document.getElementById('btn-send-text').addEventListener('click', sendTextMessage);
document.getElementById('text-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendTextMessage();
});

function sendTextMessage() {
    const input = document.getElementById('text-input');
    const text = input.value.trim();
    if (!text) return;
    addMessage('user', text);
    input.value = '';
    askElsie(text);
}

document.getElementById('btn-silent').addEventListener('click', () => {
    APP.isSilentMode = !APP.isSilentMode;
    const btn = document.getElementById('btn-silent');
    btn.classList.toggle('active', APP.isSilentMode);
    btn.querySelector('.btn-icon').textContent = APP.isSilentMode ? '🔇' : '🔊';
    btn.querySelector('.btn-label').textContent = APP.isSilentMode ? 'Muted' : 'Sound';
    if (APP.isSilentMode) {
        speechSynthesis.cancel();
    } else {
        // Re-unlock speechSynthesis after cancel (iOS Safari bug)
        const u = new SpeechSynthesisUtterance('');
        u.volume = 0;
        speechSynthesis.speak(u);
    }
});

document.getElementById('btn-profile').addEventListener('click', () => {
    document.getElementById('screen-coach').classList.remove('active');
    document.getElementById('screen-onboard').classList.add('active');
    if (APP.ws) APP.ws.close();
    clearInterval(APP.videoInterval);
    clearInterval(APP.silenceTimer);
    speechSynthesis.cancel();
    stopContinuousListening();
});

// ============================================================
// Utilities
// ============================================================

function getOrCreateUserId() {
    if (APP.userId) return APP.userId;
    let userId = 'user_' + Math.random().toString(36).substr(2, 9);
    try {
        const stored = localStorage.getItem('elsie_user_id');
        if (stored) userId = stored;
        else localStorage.setItem('elsie_user_id', userId);
    } catch (e) {}
    APP.userId = userId;
    return userId;
}