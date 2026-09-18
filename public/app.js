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
    this.history = [];
    this.audioContext = null;
    this.activeAudioSources = [];
    this.nextAudioStartTime = 0;
    this.pcmLeftoverBytes = null;

    // Microphone capture state (zero-chime silent capture)
    this.micStream = null;
    this.micSource = null;
    this.micProcessor = null;

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
    this.stopAudio();
    this.stopMicrophone();

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

  // --- Voice Pipeline Connection (WebSocket with Direct Audio Streaming) ---
  connectPipeline() {
    const rawCli = this.cliInput ? this.cliInput.value : '';
    const normalizedCli = normalizeAustralianPhone(rawCli);

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/voice?cli=${encodeURIComponent(normalizedCli)}`;

    try {
      this.ws = new WebSocket(wsUrl);
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = async () => {
        this.wsConnected = true;
        if (this.isCallActive) {
          this.statusText.textContent = 'Live Call Active';
          await this.startMicrophone();
        }
      };

      this.ws.onmessage = (event) => {
        try {
          if (typeof event.data === 'string') {
            const msg = JSON.parse(event.data);
            if (msg.event === 'session_ready') {
              this.statusText.textContent = 'Live Call Active';
            } else if (msg.event === 'transcript' && msg.data) {
              if (msg.data.transcript && msg.data.transcript.trim()) {
                if (this.isCallActive) {
                  this.statusText.textContent = msg.data.isFinal ? 'Thinking...' : 'Listening...';
                }
              }
            } else if (msg.event === 'ai_reply' && msg.data && msg.data.text) {
              this.statusText.textContent = 'Live Call Active';
              if (msg.data.timings) {
                console.log('[VoiceAgent Client] Turn Timings:', msg.data.timings);
              }
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
    await this.startMicrophone();

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

  // --- Silent High-Performance Microphone Audio Stream (Zero Browser Chimes) ---
  async startMicrophone() {
    try {
      this.stopMicrophone();

      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      const audioCtx = this.audioContext || new (window.AudioContext || window.webkitAudioContext)();
      this.audioContext = audioCtx;
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }

      this.micSource = audioCtx.createMediaStreamSource(this.micStream);
      const bufferSize = 4096;
      this.micProcessor = audioCtx.createScriptProcessor(bufferSize, 1, 1);

      this.micProcessor.onaudioprocess = (e) => {
        if (!this.isCallActive) return;

        const inputData = e.inputBuffer.getChannelData(0);
        const inputSampleRate = e.inputBuffer.sampleRate;

        // Instant Barge-In detection via RMS energy threshold
        if (this.isAgentSpeaking) {
          const rms = this.calculateRms(inputData);
          if (rms > 0.035) {
            console.log('[Barge-In] User speech detected, muting agent audio immediately');
            this.stopAudio();
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
              try {
                this.ws.send(JSON.stringify({ event: 'stop_agent_speaking', data: {} }));
              } catch (err) {}
            }
          }
        }

        // Resample and convert to 16kHz 16-bit PCM for Deepgram
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          const pcm16 = this.downsampleTo16k(inputData, inputSampleRate);
          if (pcm16 && pcm16.buffer && pcm16.byteLength > 0) {
            this.ws.send(pcm16.buffer);
          }
        }
      };

      this.micSource.connect(this.micProcessor);
      this.micProcessor.connect(audioCtx.destination);
    } catch (err) {
      console.warn('Microphone access failed:', err);
      if (this.statusText) {
        this.statusText.textContent = 'Microphone blocked';
      }
    }
  }

  stopMicrophone() {
    if (this.micProcessor) {
      try { this.micProcessor.disconnect(); } catch (e) {}
      this.micProcessor = null;
    }
    if (this.micSource) {
      try { this.micSource.disconnect(); } catch (e) {}
      this.micSource = null;
    }
    if (this.micStream) {
      try {
        this.micStream.getTracks().forEach((track) => track.stop());
      } catch (e) {}
      this.micStream = null;
    }
  }

  downsampleTo16k(inputData, sampleRate) {
    if (sampleRate === 16000) {
      const pcm16 = new Int16Array(inputData.length);
      for (let i = 0; i < inputData.length; i++) {
        const s = Math.max(-1, Math.min(1, inputData[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      return pcm16;
    }

    const ratio = sampleRate / 16000;
    const newLength = Math.round(inputData.length / ratio);
    const pcm16 = new Int16Array(newLength);
    for (let i = 0; i < newLength; i++) {
      const idx = Math.round(i * ratio);
      const s = Math.max(-1, Math.min(1, inputData[idx] || 0));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return pcm16;
  }

  calculateRms(buffer) {
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
      sum += buffer[i] * buffer[i];
    }
    return Math.sqrt(sum / buffer.length);
  }

  // --- Transcript Log Formatting & Auto-scroll ---
  addTranscript(role, text) {
    // Neither agent nor user transcripts are visible on the frontend
    return;
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
      const rawBytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        rawBytes[i] = binaryStr.charCodeAt(i);
      }

      let bytes = rawBytes;
      if (this.pcmLeftoverBytes && this.pcmLeftoverBytes.length > 0) {
        const merged = new Uint8Array(this.pcmLeftoverBytes.length + rawBytes.length);
        merged.set(this.pcmLeftoverBytes, 0);
        merged.set(rawBytes, this.pcmLeftoverBytes.length);
        bytes = merged;
        this.pcmLeftoverBytes = null;
      }

      // Ensure 16-bit PCM word alignment (2 bytes per sample) to prevent high/low byte inversion
      if (bytes.length % 2 !== 0) {
        this.pcmLeftoverBytes = bytes.slice(bytes.length - 1);
        bytes = bytes.subarray(0, bytes.length - 1);
      }

      const sampleRate = 16000;
      const numSamples = bytes.length / 2;
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

    // Smooth micro-fade gain to prevent speaker clicks/pops
    const gainNode = this.audioContext.createGain();
    source.connect(gainNode);
    gainNode.connect(this.audioContext.destination);

    const currentTime = this.audioContext.currentTime;
    // Add a small 15ms buffer when starting/falling behind to prevent buffer underrun pops
    if (this.nextAudioStartTime < currentTime) {
      this.nextAudioStartTime = currentTime + 0.015;
    }

    // Quick 6ms smooth linear fade-in to eliminate DC offset pop
    gainNode.gain.setValueAtTime(0.001, this.nextAudioStartTime);
    gainNode.gain.linearRampToValueAtTime(1.0, this.nextAudioStartTime + 0.006);

    source.start(this.nextAudioStartTime);
    this.nextAudioStartTime += audioBuffer.duration;
    this.activeAudioSources.push({ source, gainNode });
    this.isAgentSpeaking = true;

    source.onended = () => {
      const idx = this.activeAudioSources.findIndex((item) => item.source === source);
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
    this.pcmLeftoverBytes = null;
    const now = this.audioContext ? this.audioContext.currentTime : 0;
    for (const item of this.activeAudioSources) {
      try {
        if (item.gainNode && this.audioContext) {
          item.gainNode.gain.setValueAtTime(item.gainNode.gain.value, now);
          item.gainNode.gain.linearRampToValueAtTime(0.001, now + 0.005);
        }
        item.source.stop(now + 0.006);
        setTimeout(() => {
          try { item.source.disconnect(); } catch (e) {}
        }, 10);
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
