/**
 * Simple Purnell Motors Voice Agent Application
 */

class SimpleVoiceAgent {
  constructor() {
    this.isCallActive = false;
    this.ws = null;
    this.recognition = null;
    this.history = [];
    this.audioContext = null;
    this.currentAudioSource = null;

    // DOM Elements
    this.playBtn = document.getElementById('playBtn');
    this.playBtnText = document.getElementById('playBtnText');
    this.playIcon = document.getElementById('playIcon');
    this.statusBadge = document.getElementById('statusBadge');
    this.statusText = document.getElementById('statusText');
    this.transcriptBox = document.getElementById('transcriptBox');
    this.placeholder = document.getElementById('placeholder');
    this.clearBtn = document.getElementById('clearBtn');

    this.init();
  }

  init() {
    this.setupEvents();
    this.initSpeechRecognition();
    this.initAudioContext();
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
      this.audioContext.resume();
    }
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
  }

  toggleCall() {
    if (this.isCallActive) {
      this.endCall();
    } else {
      this.startCall();
    }
  }

  startCall() {
    this.isCallActive = true;
    this.resumeAudioContext();

    // Update UI button state
    this.playBtn.classList.add('active');
    this.playBtnText.textContent = 'End Call';
    this.playIcon.innerHTML = '<rect x="6" y="6" width="12" height="12" rx="2"></rect>';
    this.statusBadge.className = 'status-badge active';
    this.statusText.textContent = 'Live Call Active';

    if (this.placeholder) {
      this.placeholder.style.display = 'none';
    }

    // Connect WebSocket voice pipeline to backend & start speech recognition
    this.connectWebSocket();
    this.startSpeechRecognition();
  }

  endCall() {
    this.isCallActive = false;
    this.stopAudio();

    if (this.recognition) {
      try { this.recognition.stop(); } catch (e) {}
    }

    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
    }

    // Reset UI button state
    this.playBtn.classList.remove('active');
    this.playBtnText.textContent = 'Start Voice Agent';
    this.playIcon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"></polygon>';
    this.statusBadge.className = 'status-badge idle';
    this.statusText.textContent = 'Call ended';
  }

  // --- WebSocket Connection ---
  connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/voice`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.event === 'session_ready') {
            // Session initialized
            console.log('Voice session ready:', msg.data);
          } else if (msg.event === 'ai_reply' && msg.data && msg.data.text) {
            this.addTranscript('agent', msg.data.text);
            if (msg.data.audioBuffer) {
              this.playPcmBase64(msg.data.audioBuffer);
            }
          } else if (msg.event === 'audio_chunk' && msg.data && msg.data.chunk) {
            this.playPcmBase64(msg.data.chunk);
          } else if (msg.event === 'stop_audio') {
            this.stopAudio();
          }
        } catch (e) {}
      };
    } catch (e) {
      console.warn('WebSocket connection failed; using REST fallback.');
    }
  }

  // --- Speech Recognition for User ---
  initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = true;
    this.recognition.interimResults = false;
    this.recognition.lang = 'en-AU';

    this.recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          const spokenText = event.results[i][0].transcript.trim();
          if (spokenText.length > 0) {
            this.handleUserSpeech(spokenText);
          }
        }
      }
    };

    this.recognition.onend = () => {
      if (this.isCallActive) {
        try { this.recognition.start(); } catch (e) {}
      }
    };
  }

  startSpeechRecognition() {
    if (this.recognition) {
      try { this.recognition.start(); } catch (e) {}
    }
  }

  async handleUserSpeech(text) {
    this.stopAudio(); // Barge-in interrupt
    this.addTranscript('user', text);
    this.history.push({ role: 'user', content: text });

    // Send to backend
    try {
      const response = await fetch('/voice-agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history: this.history,
        }),
      });

      const data = await response.json();

      if (data.success && data.response) {
        this.history.push({ role: 'assistant', content: data.response });
        this.addTranscript('agent', data.response);

        if (data.audioBuffer) {
          this.playPcmBase64(data.audioBuffer);
        } else {
          this.speakText(data.response);
        }
      }
    } catch (err) {
      console.error('API Error:', err);
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
  }

  // --- Audio Synthesis & Playback ---
  playPcmBase64(base64Data) {
    try {
      this.resumeAudioContext();
      if (!this.audioContext) return;

      this.stopAudio();

      const binaryStr = atob(base64Data);
      const len = binaryStr.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      const sampleRate = 16000;
      const numSamples = Math.floor(bytes.length / 2);
      const audioBuffer = this.audioContext.createBuffer(1, numSamples, sampleRate);
      const channelData = audioBuffer.getChannelData(0);

      const dataView = new DataView(bytes.buffer);
      for (let i = 0; i < numSamples; i++) {
        const int16 = dataView.getInt16(i * 2, true);
        channelData[i] = int16 / 32768.0;
      }

      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.audioContext.destination);

      this.currentAudioSource = source;
      source.start();
    } catch (e) {
      console.warn('Audio decoding failed:', e);
    }
  }

  speakText(text) {
    if (!('speechSynthesis' in window)) return;
    this.stopAudio();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-AU';
    window.speechSynthesis.speak(utterance);
  }

  stopAudio() {
    if (this.currentAudioSource) {
      try { this.currentAudioSource.stop(); } catch (e) {}
      this.currentAudioSource = null;
    }
    if ('speechSynthesis' in window && window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
    }
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
