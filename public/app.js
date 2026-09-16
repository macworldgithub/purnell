/**
 * Purnell Motors Voice Agent Application with Real-time CLI Normalization
 */

function normalizeAustralianPhone(input) {
  if (!input) return '';
  let clean = input.trim().replace(/[^\d+]/g, '');
  if (!clean) return '';
  if (clean.startsWith('+61')) return '+61' + clean.slice(3).replace(/\D/g, '');
  if (clean.startsWith('+')) return clean;
  const digits = clean.replace(/\D/g, '');
  if (digits.startsWith('61') && digits.length >= 10) return '+' + digits;
  if (digits.startsWith('0') && digits.length === 10) return '+61' + digits.slice(1);
  if (digits.length === 9 && ['4', '2', '3', '7', '8'].includes(digits[0])) return '+61' + digits;
  return digits.length >= 10 ? '+' + digits : digits;
}

class SimpleVoiceAgent {
  constructor() {
    this.isCallActive = false;
    this.isAgentSpeaking = false;
    this.isProcessingSpeech = false;
    this.ws = null;
    this.wsConnected = false;
    this.recognition = null;
    this.history = [];
    this.audioContext = null;
    this.activeAudioSources = [];
    this.nextAudioStartTime = 0;

    // Speech accumulation & debouncing state
    this.accumulatedTranscript = '';
    this.speechSilenceTimer = null;

    // DOM Elements
    this.playBtn = document.getElementById('playBtn');
    this.playBtnText = document.getElementById('playBtnText');
    this.playIcon = document.getElementById('playIcon');
    this.statusBadge = document.getElementById('statusBadge');
    this.statusText = document.getElementById('statusText');
    this.transcriptBox = document.getElementById('transcriptBox');
    this.placeholder = document.getElementById('placeholder');
    this.clearBtn = document.getElementById('clearBtn');
    this.cliInput = document.getElementById('cliInput');
    this.normalizedBadge = document.getElementById('normalizedBadge');

    this.init();
  }

  init() {
    this.setupEvents();
    this.initSpeechRecognition();
    this.initAudioContext();
    this.updateCliBadge();
  }

  updateCliBadge() {
    if (this.cliInput && this.normalizedBadge) {
      const normalized = normalizeAustralianPhone(this.cliInput.value);
      this.normalizedBadge.textContent = normalized || 'Invalid Number';
    }
  }

  initAudioContext() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.audioContext = new AudioCtx();
    } catch (e) {
      console.warn('AudioContext not available:', e);
    }
  }

  resumeAudioContext() {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      return this.audioContext.resume();
    }
    return Promise.resolve();
  }

  setupEvents() {
    // Play / Stop button click
    this.playBtn.addEventListener('click', () => {
      this.toggleCall();
    });

    // Clear transcript log
    this.clearBtn.addEventListener('click', () => {
      this.clearTranscript();
    });

    // Real-time CLI normalization update
    if (this.cliInput) {
      this.cliInput.addEventListener('input', () => {
        this.updateCliBadge();
      });
    }
  }

  toggleCall() {
    if (this.isCallActive) {
      this.endCall();
    } else {
      this.startCall();
    }
  }

  async startCall() {
    this.isCallActive = true;
    this.isProcessingSpeech = false;
    this.accumulatedTranscript = '';
    await this.resumeAudioContext();

    // Update UI button state
    this.playBtn.classList.add('active');
    this.playBtnText.textContent = 'End Call';
    this.playIcon.innerHTML = '<rect x="6" y="6" width="12" height="12" rx="2"></rect>';
    this.statusBadge.className = 'status-badge active';
    this.statusText.textContent = 'Connecting...';

    if (this.placeholder) {
      this.placeholder.style.display = 'none';
    }

    // Connect voice pipeline
    this.connectPipeline();
  }

  endCall() {
    this.isCallActive = false;
    this.isProcessingSpeech = false;
    this.accumulatedTranscript = '';
    this.stopAudio();

    if (this.speechSilenceTimer) {
      clearTimeout(this.speechSilenceTimer);
      this.speechSilenceTimer = null;
    }

    if (this.recognition) {
      try { this.recognition.stop(); } catch (e) {}
    }

    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
      this.ws = null;
    }
    this.wsConnected = false;

    // Reset UI button state
    this.playBtn.classList.remove('active');
    this.playBtnText.textContent = 'Start Voice Agent';
    this.playIcon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"></polygon>';
    this.statusBadge.className = 'status-badge idle';
    this.statusText.textContent = 'Call ended';
  }

  // --- Voice Pipeline Connection (WebSocket with Clean Fallback) ---
  connectPipeline() {
    const rawCli = this.cliInput ? this.cliInput.value : '';
    const normalizedCli = normalizeAustralianPhone(rawCli);

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/voice?cli=${encodeURIComponent(normalizedCli)}`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.wsConnected = true;
        if (this.isCallActive) {
          this.statusText.textContent = 'Live Call Active';
          this.startSpeechRecognition();
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.event === 'session_ready') {
            this.statusText.textContent = 'Live Call Active';
          } else if (msg.event === 'ai_reply' && msg.data && msg.data.text) {
            this.statusText.textContent = 'Live Call Active';
            this.history.push({ role: 'assistant', content: msg.data.text });
            this.addTranscript('agent', msg.data.text);
            if (msg.data.audioBuffer) {
              this.playCompleteAudio(msg.data.audioBuffer);
            }
          } else if (msg.event === 'audio_chunk' && msg.data && msg.data.chunk) {
            this.playPcmChunk(msg.data.chunk);
          } else if (msg.event === 'stop_audio' || msg.event === 'clear_audio_buffer') {
            this.stopAudio();
          }
        } catch (e) {
          console.error('WebSocket message parsing error:', e);
        }
      };

      this.ws.onerror = () => {
        this.wsConnected = false;
        if (this.isCallActive) {
          this.initRestGreeting(normalizedCli);
        }
      };

      this.ws.onclose = () => {
        this.wsConnected = false;
      };
    } catch (e) {
      this.initRestGreeting(normalizedCli);
    }
  }

  // --- REST Initial Greeting Fallback (for non-WebSocket environments) ---
  async initRestGreeting(cli) {
    if (!this.isCallActive) return;
    this.statusText.textContent = 'Live Call Active';
    this.startSpeechRecognition();

    try {
      const response = await fetch('/voice-agent/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cli }),
      });

      const data = await response.json();
      if (this.isCallActive && data.success && data.greeting) {
        this.history.push({ role: 'assistant', content: data.greeting });
        this.addTranscript('agent', data.greeting);

        if (data.audioBuffer) {
          this.playCompleteAudio(data.audioBuffer);
        }
      }
    } catch (err) {
      console.error('Initial greeting request failed:', err);
    }
  }

  // --- Speech Recognition with Real-time Barge-In & Continuous Listening ---
  initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('SpeechRecognition not supported in this browser.');
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = 'en-AU';

    const finalizeAndSend = () => {
      const textToSend = (this.accumulatedTranscript || '').trim();
      this.accumulatedTranscript = '';
      if (this.speechSilenceTimer) {
        clearTimeout(this.speechSilenceTimer);
        this.speechSilenceTimer = null;
      }

      // Reset recognition buffer for the next turn cleanly
      try { this.recognition.stop(); } catch (e) {}

      if (textToSend.length > 0 && this.isCallActive && !this.isProcessingSpeech) {
        this.handleUserSpeech(textToSend);
      }
    };

    this.recognition.onresult = (event) => {
      // Reconstruct clean transcript from current speech recognition results
      let turnTranscript = '';
      for (let i = 0; i < event.results.length; ++i) {
        const item = event.results[i];
        if (item && item[0] && item[0].transcript) {
          turnTranscript += item[0].transcript + ' ';
        }
      }

      const cleanTurn = turnTranscript.trim();
      if (!cleanTurn) return;

      // INSTANT BARGE-IN: If agent is speaking and user speaks, cut off agent audio immediately
      if (this.isAgentSpeaking) {
        console.log('[Barge-In] User interrupted agent with speech:', cleanTurn);
        this.stopAudio();
        if (this.ws && this.wsConnected) {
          try {
            this.ws.send(JSON.stringify({ event: 'stop_agent_speaking', data: {} }));
          } catch (e) {}
        }
      }

      this.accumulatedTranscript = cleanTurn;

      // Reset debouncing silence timer
      if (this.speechSilenceTimer) {
        clearTimeout(this.speechSilenceTimer);
        this.speechSilenceTimer = null;
      }

      // Allow 1100ms pause after speaking before finalizing and dispatching turn
      if (this.accumulatedTranscript.length > 0 && this.isCallActive && !this.isProcessingSpeech) {
        this.speechSilenceTimer = setTimeout(() => {
          finalizeAndSend();
        }, 1100);
      }
    };

    this.recognition.onerror = (event) => {
      if (event.error !== 'no-speech') {
        console.warn('SpeechRecognition error:', event.error);
      }
      if (event.error === 'not-allowed') {
        this.statusText.textContent = 'Microphone blocked';
      }
    };

    this.recognition.onend = () => {
      // Keep listening continuously as long as call is active
      if (this.isCallActive) {
        try {
          this.recognition.start();
        } catch (e) {
          setTimeout(() => {
            if (this.isCallActive) {
              try { this.recognition.start(); } catch (err) {}
            }
          }, 200);
        }
      }
    };
  }

  startSpeechRecognition() {
    if (this.recognition) {
      try { this.recognition.start(); } catch (e) {}
    }
  }

  async handleUserSpeech(text) {
    if (this.isProcessingSpeech || !text || !text.trim()) return;
    this.isProcessingSpeech = true;
    this.stopAudio();

    const cleanText = text.trim();
    this.addTranscript('user', cleanText);
    this.history.push({ role: 'user', content: cleanText });

    const rawCli = this.cliInput ? this.cliInput.value : '';
    const normalizedCli = normalizeAustralianPhone(rawCli);

    if (this.isCallActive) {
      this.statusText.textContent = 'Thinking...';
    }

    try {
      if (this.ws && this.wsConnected) {
        this.ws.send(
          JSON.stringify({
            event: 'text_input',
            data: {
              text: cleanText,
              history: this.history,
              cli: normalizedCli,
            },
          }),
        );
      } else {
        const response = await fetch('/voice-agent/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: cleanText,
            history: this.history,
            cli: normalizedCli,
          }),
        });

        const data = await response.json();

        if (this.isCallActive) {
          this.statusText.textContent = 'Live Call Active';

          if (data && data.success && data.response) {
            this.history.push({ role: 'assistant', content: data.response });
            this.addTranscript('agent', data.response);

            if (data.audioBuffer) {
              this.playCompleteAudio(data.audioBuffer);
            }
          }
        }
      }
    } catch (err) {
      console.error('API Error:', err);
      if (this.isCallActive) {
        this.statusText.textContent = 'Live Call Active';
      }
    } finally {
      this.isProcessingSpeech = false;
    }
  }

  // --- Transcript Log Formatting & Auto-scroll ---
  addTranscript(role, text) {
    const entry = document.createElement('div');
    entry.className = `transcript-entry ${role}`;

    const roleName = role === 'agent' ? 'Voice Agent' : 'User';

    entry.innerHTML = `
      <span class="entry-role">${roleName}</span>
      <span class="entry-text">${this.escapeHtml(text)}</span>
    `;

    this.transcriptBox.appendChild(entry);
    this.scrollToBottom();
  }

  scrollToBottom() {
    requestAnimationFrame(() => {
      this.transcriptBox.scrollTop = this.transcriptBox.scrollHeight;
    });
  }

  clearTranscript() {
    this.transcriptBox.innerHTML = '';
    this.history = [];
    this.accumulatedTranscript = '';
  }

  // --- Audio Decoding & Queued Playback ---
  decodePcm(base64Data) {
    try {
      const binaryStr = atob(base64Data);
      const len = binaryStr.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      const sampleRate = 16000;
      const numSamples = Math.floor(bytes.length / 2);
      if (numSamples === 0) return null;

      const audioBuffer = this.audioContext.createBuffer(1, numSamples, sampleRate);
      const channelData = audioBuffer.getChannelData(0);
      const dataView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

      for (let i = 0; i < numSamples; i++) {
        const int16 = dataView.getInt16(i * 2, true);
        channelData[i] = int16 / 32768.0;
      }
      return audioBuffer;
    } catch (e) {
      console.warn('Audio decoding failed:', e);
      return null;
    }
  }

  // Schedules streaming chunks sequentially so they do not clip or cut each other off
  playPcmChunk(base64Data) {
    if (!this.isCallActive) return;
    this.resumeAudioContext();
    if (!this.audioContext) return;

    const audioBuffer = this.decodePcm(base64Data);
    if (!audioBuffer) return;

    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.audioContext.destination);

    const currentTime = this.audioContext.currentTime;
    if (this.nextAudioStartTime < currentTime) {
      this.nextAudioStartTime = currentTime;
    }

    source.start(this.nextAudioStartTime);
    this.nextAudioStartTime += audioBuffer.duration;
    this.activeAudioSources.push(source);
    this.isAgentSpeaking = true;

    source.onended = () => {
      const idx = this.activeAudioSources.indexOf(source);
      if (idx !== -1) {
        this.activeAudioSources.splice(idx, 1);
      }
      if (this.activeAudioSources.length === 0) {
        this.isAgentSpeaking = false;
      }
    };
  }

  // Play a full single response (e.g. from REST)
  playCompleteAudio(base64Data) {
    this.stopAudio();
    this.playPcmChunk(base64Data);
  }

  stopAudio() {
    this.isAgentSpeaking = false;
    for (const src of this.activeAudioSources) {
      try {
        src.stop();
      } catch (e) {}
    }
    this.activeAudioSources = [];
    this.nextAudioStartTime = 0;
  }

  escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

// Instantiate on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  window.voiceApp = new SimpleVoiceAgent();
});
