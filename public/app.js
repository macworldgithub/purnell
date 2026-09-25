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
    this.pcmLeftoverBytes = null;
    this.voiceModel = document.getElementById('voiceModel');
    this.livePeer = null;
    this.liveDataChannel = null;
    this.liveMicStream = null;
    this.liveAudioElement = null;
    this.livePendingTranscript = '';
    this.liveLastUserTurn = '';
    this.liveAssistantTranscript = '';
    this.liveGreetingEventId = null;
    this.liveCallerWantsToEnd = false;
    this.liveCloseTimeout = null;

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

  logLiveDebug(action, details = {}) {
    console.info(`[GPT-Live ${new Date().toISOString()}] ${action}`, details);
  }

  async startCall() {
    this.isCallActive = true;
    this.isProcessingSpeech = false;
    this.accumulatedTranscript = '';
    this.history = [];
    this.livePendingTranscript = '';
    this.liveLastUserTurn = '';
    this.liveAssistantTranscript = '';
    this.liveCallerWantsToEnd = false;
    if (this.voiceModel) this.voiceModel.disabled = true;
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

    // Connect the selected voice mode.
    if (this.voiceModel && this.voiceModel.value === 'gpt-live-1') {
      this.connectLiveModel();
    } else {
      this.connectPipeline();
    }
  }


  endCall(sessionAlreadyClosed = false) {
    this.logLiveDebug('Call end requested', {
      sessionAlreadyClosed,
      isCallActive: this.isCallActive,
      dataChannelState: this.liveDataChannel?.readyState || 'unavailable',
      reason: this.liveCallerWantsToEnd ? 'caller requested goodbye' : 'UI or lifecycle',
    });
    if (
      !sessionAlreadyClosed &&
      this.isCallActive &&
      this.liveDataChannel &&
      this.liveDataChannel.readyState === 'open'
    ) {
      this.isCallActive = false;
      if (this.liveMicStream) {
        this.liveMicStream.getAudioTracks().forEach((track) => { track.enabled = false; });
      }
      this.statusText.textContent = 'Ending call...';
      this.playBtnText.textContent = 'Ending Call';
      this.playBtn.disabled = true;
      const closeEventId = `live_close_${Date.now()}`;
      this.logLiveDebug('Sending session.close; waiting for session.closed', { eventId: closeEventId });
      this.sendLiveEvent({ type: 'session.close', event_id: closeEventId });
      this.liveCloseTimeout = setTimeout(() => {
        this.logLiveDebug('Timed out waiting for session.closed; forcing local cleanup');
        this.endCall(true);
      }, 5000);
      return;
    }

    if (this.liveCloseTimeout) {
      clearTimeout(this.liveCloseTimeout);
      this.liveCloseTimeout = null;
    }
    this.isCallActive = false;
    this.isProcessingSpeech = false;
    if (this.voiceModel) this.voiceModel.disabled = false;
    this.playBtn.disabled = false;
    this.accumulatedTranscript = '';
    this.stopAudio();

    if (this.speechSilenceTimer) {
      clearTimeout(this.speechSilenceTimer);
      this.speechSilenceTimer = null;
    }

    if (this.recognition) {
      try { this.recognition.stop(); } catch (e) { }
    }

    if (this.ws) {
      try { this.ws.close(); } catch (e) { }
      this.ws = null;
    }
    this.wsConnected = false;

    if (this.liveDataChannel) {
      try {
        this.liveDataChannel.close();
      } catch (error) {
        this.logLiveDebug('Data channel cleanup failed', { message: error.message || String(error) });
      }
      this.liveDataChannel = null;
    }
    if (this.livePeer) {
      try {
        this.livePeer.close();
      } catch (error) {
        this.logLiveDebug('Peer connection cleanup failed', { message: error.message || String(error) });
      }
      this.livePeer = null;
    }
    if (this.liveMicStream) {
      this.liveMicStream.getTracks().forEach((track) => track.stop());
      this.liveMicStream = null;
    }
    if (this.liveAudioElement) {
      this.liveAudioElement.pause();
      this.liveAudioElement.srcObject = null;
      this.liveAudioElement.remove();
      this.liveAudioElement = null;
    }

    // Reset UI button state
    this.playBtn.classList.remove('active');
    this.playBtnText.textContent = 'Start Voice Agent';
    this.playIcon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"></polygon>';
    this.statusBadge.className = 'status-badge idle';
    this.statusText.textContent = 'Call ended';
  }

  async connectLiveModel() {
    try {
      this.statusText.textContent = 'Requesting microphone...';
      this.liveMicStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (!this.isCallActive) {
        this.liveMicStream.getTracks().forEach((track) => track.stop());
        this.liveMicStream = null;
        return;
      }

      const peer = new RTCPeerConnection();
      this.livePeer = peer;
      this.liveAudioElement = document.createElement('audio');
      this.liveAudioElement.autoplay = true;
      this.liveAudioElement.playsInline = true;
      this.liveAudioElement.style.display = 'none';
      document.body.appendChild(this.liveAudioElement);
      peer.ontrack = (event) => {
        this.liveAudioElement.srcObject = event.streams[0];
        this.liveAudioElement.play().catch((error) => {
          console.warn('Live audio playback could not start automatically:', error);
        });
      };
      this.liveMicStream.getAudioTracks().forEach((track) => {
        peer.addTrack(track, this.liveMicStream);
      });

      const channel = peer.createDataChannel('oai-events');
      this.liveDataChannel = channel;
      channel.onopen = () => this.logLiveDebug('Data channel open');
      channel.onclose = () => this.logLiveDebug('Data channel closed');
      channel.onmessage = (event) => this.handleLiveEvent(event.data);
      channel.onerror = (event) => {
        this.logLiveDebug('Data channel error', { message: event.message || 'see console event' });
        console.error('GPT-Live data channel error:', event);
      };
      peer.onconnectionstatechange = () => this.logLiveDebug('WebRTC connection state', { state: peer.connectionState });

      this.statusText.textContent = 'Connecting to GPT-Live-1...';
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await this.waitForIceGathering(peer);
      const sdp = peer.localDescription && peer.localDescription.sdp;
      if (!sdp) throw new Error('The browser did not create a WebRTC offer.');

      const response = await fetch('/voice-agent/live/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sdp,
          cli: normalizeAustralianPhone(this.cliInput ? this.cliInput.value : ''),
        }),
      });
      const result = await response.json();
      this.logLiveDebug('Live session creation response', { httpStatus: response.status, success: Boolean(result.success) });
      if (!response.ok || !result.success || !result.transport?.sdp) {
        throw new Error(result.message || 'Could not create a GPT-Live-1 session.');
      }
      await peer.setRemoteDescription({ type: 'answer', sdp: result.transport.sdp });
    } catch (error) {
      this.logLiveDebug('Live connection failed', { message: error.message || String(error) });
      console.error('GPT-Live connection failed:', error);
      if (this.isCallActive) {
        this.endCall();
        this.statusText.textContent = error.message || 'GPT-Live connection failed';
      }
    }
  }

  waitForIceGathering(peer) {
    if (peer.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        peer.removeEventListener('icegatheringstatechange', onStateChange);
        reject(new Error('Timed out while preparing the browser voice connection.'));
      }, 10000);
      const onStateChange = () => {
        if (peer.iceGatheringState !== 'complete') return;
        clearTimeout(timeout);
        peer.removeEventListener('icegatheringstatechange', onStateChange);
        resolve();
      };
      peer.addEventListener('icegatheringstatechange', onStateChange);
      onStateChange();
    });
  }

  handleLiveEvent(rawEvent) {
    let event;
    try {
      event = JSON.parse(rawEvent);
    } catch (error) {
      console.warn('Could not parse GPT-Live event:', error);
      return;
    }

    if (typeof event.type !== 'string' || !event.type.endsWith('.delta')) {
      this.logLiveDebug('Received Live event', {
        type: event.type,
        eventId: event.event_id,
        clientEventId: event.client_event_id,
        delegationId: event.delegation?.id,
        delegationTarget: event.delegation?.target,
        errorCode: event.error?.code,
        errorMessage: event.error?.message,
      });
    }

    if (event.type === 'session.started') {
      this.statusText.textContent = 'GPT-Live-1 call active';
      this.liveGreetingEventId = `live_greeting_${Date.now()}`;
      this.sendLiveEvent({
        type: 'session.instructions.append',
        event_id: this.liveGreetingEventId,
        delegation_id: null,
        content: 'Immediately start speaking. Say the opening greeting from your session instructions now, without waiting for the caller to speak. Then pause and listen.',
      });
    } else if (
      event.type === 'session.instructions.appended' &&
      event.client_event_id === this.liveGreetingEventId
    ) {
      this.logLiveDebug('Greeting instruction accepted', { clientEventId: event.client_event_id });
    } else if (event.type === 'session.input_transcript.delta') {
      if (!this.livePendingTranscript) this.flushLiveAssistantTranscript();
      this.livePendingTranscript += event.delta || '';
    } else if (event.type === 'session.input_transcript.done') {
      const finalTranscript = (event.transcript || this.livePendingTranscript).trim();
      if (finalTranscript) {
        this.livePendingTranscript = finalTranscript;
        this.flushLiveUserTranscript();
        this.liveCallerWantsToEnd = /\b(bye|goodbye|farewell|hang\s*up|end (?:the )?call|that(?:'s| is) all|nothing else|i(?:'m| am) done)\b/i.test(finalTranscript);
        this.logLiveDebug('Caller end intent evaluated', {
          detected: this.liveCallerWantsToEnd,
          transcriptCharacters: finalTranscript.length,
        });
      }
    } else if (event.type === 'session.output_transcript.delta') {
      this.flushLiveUserTranscript();
      this.liveAssistantTranscript += event.delta || '';
    } else if (event.type === 'session.output_audio.done') {
      this.logLiveDebug('Assistant audio finished', { callerRequestedEnd: this.liveCallerWantsToEnd });
      if (this.liveCallerWantsToEnd) this.endCall();
    } else if (event.type === 'session.delegation.created') {
      if (event.delegation && event.delegation.target === 'client') {
        this.handleLiveDelegation(event.delegation.id);
      }
    } else if (event.type === 'session.error' || event.type === 'error') {
      console.error('GPT-Live session error:', event.error || event);
      this.statusText.textContent = event.error?.message || 'GPT-Live session error';
    } else if (event.type === 'session.closed') {
      this.logLiveDebug('Live session closed', { reason: event.reason, usage: event.usage });
      this.endCall(true);
    }
  }

  sendLiveEvent(event) {
    if (this.liveDataChannel && this.liveDataChannel.readyState === 'open') {
      this.logLiveDebug('Sending Live event', { type: event.type, eventId: event.event_id, delegationId: event.delegation_id });
      this.liveDataChannel.send(JSON.stringify(event));
    } else {
      this.logLiveDebug('Cannot send Live event: data channel is not open', {
        type: event.type,
        dataChannelState: this.liveDataChannel?.readyState || 'unavailable',
      });
    }
  }

  flushLiveAssistantTranscript() {
    const text = this.liveAssistantTranscript.trim();
    if (text) {
      this.logLiveDebug('Assistant transcript turn complete', { characters: text.length });
      this.history.push({ role: 'assistant', content: text });
      this.addTranscript('agent', text);
      this.liveAssistantTranscript = '';
    }
  }

  flushLiveUserTranscript() {
    const text = this.livePendingTranscript.trim();
    if (!text) return;
    this.logLiveDebug('Caller transcript turn complete', { characters: text.length });
    this.history.push({ role: 'user', content: text });
    this.liveLastUserTurn = text;
    this.livePendingTranscript = '';
    this.addTranscript('user', text);
  }

  async handleLiveDelegation(delegationId) {
    // Let any transcript deltas for the triggering utterance reach the browser first.
    await new Promise((resolve) => setTimeout(resolve, 150));
    if (!this.isCallActive || !delegationId) return;

    const message = (this.livePendingTranscript || this.liveLastUserTurn).trim();
    if (!message) {
      this.logLiveDebug('Delegation skipped: no caller transcript available', { delegationId });
      console.warn('GPT-Live requested backend work without a transcript.');
      return;
    }
    if (this.livePendingTranscript.trim()) {
      this.flushLiveUserTranscript();
    }
    this.statusText.textContent = 'Checking dealership information...';
    this.logLiveDebug('Delegation request started', { delegationId, transcriptCharacters: message.length });

    const cli = normalizeAustralianPhone(this.cliInput ? this.cliInput.value : '');
    try {
      const response = await fetch('/voice-agent/live/delegation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history: this.history, cli }),
      });
      const result = await response.json();
      if (!response.ok || !result.success || !result.response) {
        throw new Error(result.message || 'The dealership assistant could not complete that request.');
      }
      this.logLiveDebug('Delegation request completed', {
        delegationId,
        httpStatus: response.status,
        responseCharacters: result.response.length,
        timings: result.timings,
      });
      this.sendLiveEvent({
        type: 'session.commentary.append',
        event_id: `backend_result_${Date.now()}`,
        delegation_id: delegationId,
        content: result.response,
      });
      this.statusText.textContent = 'GPT-Live-1 call active';
    } catch (error) {
      this.logLiveDebug('Delegation request failed', { delegationId, message: error.message || String(error) });
      console.error('GPT-Live backend delegation failed:', error);
      this.sendLiveEvent({
        type: 'session.commentary.append',
        event_id: `backend_error_${Date.now()}`,
        delegation_id: delegationId,
        content: 'I could not check that information just now. Please try again or ask me to take a message.',
      });
      this.statusText.textContent = 'GPT-Live-1 call active';
    }
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

    let finalTranscript = '';

    const finalizeAndSend = () => {
      const textToSend = (this.accumulatedTranscript || finalTranscript || '').trim();
      this.accumulatedTranscript = '';
      finalTranscript = '';
      if (this.speechSilenceTimer) {
        clearTimeout(this.speechSilenceTimer);
        this.speechSilenceTimer = null;
      }

      // Do NOT abort/restart recognition to prevent the browser's built-in start/stop chime sound
      if (textToSend.length > 0 && this.isCallActive && !this.isProcessingSpeech) {
        this.handleUserSpeech(textToSend);
      }
    };

    this.recognition.onresult = (event) => {
      let interimTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const item = event.results[i];
        if (item && item[0]) {
          const text = item[0].transcript || '';
          if (item.isFinal) {
            finalTranscript += text + ' ';
          } else {
            interimTranscript += text;
          }
        }
      }

      const cleanTurn = (finalTranscript + ' ' + interimTranscript).trim().replace(/\s+/g, ' ');
      if (!cleanTurn) return;

      // INSTANT BARGE-IN: If agent is speaking and user speaks, cut off agent audio immediately
      if (this.isAgentSpeaking) {
        console.log('[Barge-In] User interrupted agent with speech:', cleanTurn);
        this.stopAudio();
        if (this.ws && this.wsConnected) {
          try {
            this.ws.send(JSON.stringify({ event: 'stop_agent_speaking', data: {} }));
          } catch (e) { }
        }
      }

      this.accumulatedTranscript = cleanTurn;

      // Reset debouncing silence timer
      if (this.speechSilenceTimer) {
        clearTimeout(this.speechSilenceTimer);
        this.speechSilenceTimer = null;
      }

      // Allow 650ms pause after speaking before finalizing and dispatching turn (reduced from 1100ms)
      if (this.accumulatedTranscript.length > 0 && this.isCallActive && !this.isProcessingSpeech) {
        this.speechSilenceTimer = setTimeout(() => {
          finalizeAndSend();
        }, 650);
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
              try { this.recognition.start(); } catch (err) { }
            }
          }, 200);
        }
      }
    };
  }

  startSpeechRecognition() {
    if (this.recognition) {
      try { this.recognition.start(); } catch (e) { }
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
    source.connect(this.audioContext.destination);

    const currentTime = this.audioContext.currentTime;
    // Buffer ahead by 20ms if falling behind to ensure gapless streaming playback
    if (this.nextAudioStartTime < currentTime) {
      this.nextAudioStartTime = currentTime + 0.02;
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
    this.pcmLeftoverBytes = null;
    for (const src of this.activeAudioSources) {
      try {
        src.stop();
        src.disconnect();
      } catch (e) { }
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
