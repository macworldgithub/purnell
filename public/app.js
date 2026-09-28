function normalizeAustralianPhone(input) {
  if (!input) return '';
  const clean = input.trim().replace(/[^\d+]/g, '');
  if (clean.startsWith('+61')) return `+61${clean.slice(3).replace(/\D/g, '')}`;
  if (clean.startsWith('+')) return clean;

  const digits = clean.replace(/\D/g, '');
  if (digits.startsWith('61') && digits.length >= 10) return `+${digits}`;
  if (digits.startsWith('0') && digits.length === 10) return `+61${digits.slice(1)}`;
  if (digits.length === 9 && ['4', '2', '3', '7', '8'].includes(digits[0])) return `+61${digits}`;
  return digits.length >= 10 ? `+${digits}` : digits;
}

class LiveVoiceAgent {
  constructor() {
    this.isCallActive = false;
    this.history = [];
    this.peer = null;
    this.dataChannel = null;
    this.micStream = null;
    this.remoteAudio = null;
    this.pendingUserTranscript = '';
    this.lastUserTurn = '';
    this.assistantTranscript = '';
    this.callerWantsToEnd = false;
    this.closeTimeout = null;
    this.closeTimeout = null;

    this.playBtn = document.getElementById('playBtn');
    this.playBtnText = document.getElementById('playBtnText');
    this.playIcon = document.getElementById('playIcon');
    this.statusBadge = document.getElementById('statusBadge');
    this.statusText = document.getElementById('statusText');
    this.transcriptBox = document.getElementById('transcriptBox');
    this.cliInput = document.getElementById('cliInput');
    this.normalizedBadge = document.getElementById('normalizedBadge');

    document.getElementById('clearBtn').addEventListener('click', () => this.clearTranscript());
    this.playBtn.addEventListener('click', () => this.toggleCall());
    this.cliInput.addEventListener('input', () => this.updateCliBadge());
    this.updateCliBadge();
  }

  log(action, details = {}) {
    console.info(`[GPT-Live ${new Date().toISOString()}] ${action}`, details);
  }

  updateCliBadge() {
    this.normalizedBadge.textContent = normalizeAustralianPhone(this.cliInput.value) || 'Invalid Number';
  }

  toggleCall() {
    if (this.isCallActive) this.endCall();
    else this.startCall();
  }

  async startCall() {
    this.isCallActive = true;
    this.history = [];
    this.pendingUserTranscript = '';
    this.lastUserTurn = '';
    this.assistantTranscript = '';
    this.callerWantsToEnd = false;
    this.playBtn.classList.add('active');
    this.playBtnText.textContent = 'End Call';
    this.playIcon.innerHTML = '<rect x="6" y="6" width="12" height="12" rx="2"></rect>';
    this.statusBadge.className = 'status-badge active';
    this.statusText.textContent = 'Connecting...';
    document.getElementById('placeholder')?.remove();

    try {
      this.log('Requesting microphone');
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (!this.isCallActive) return this.stopMicrophone();

      const peer = new RTCPeerConnection();
      this.peer = peer;
      this.remoteAudio = document.createElement('audio');
      this.remoteAudio.autoplay = true;
      this.remoteAudio.playsInline = true;
      this.remoteAudio.style.display = 'none';
      document.body.appendChild(this.remoteAudio);
      peer.ontrack = ({ streams }) => {
        this.remoteAudio.srcObject = streams[0];
        this.remoteAudio.play().catch((error) => this.log('Audio playback failed', { message: error.message }));
      };
      peer.onconnectionstatechange = () => this.log('WebRTC state', { state: peer.connectionState });
      this.micStream.getAudioTracks().forEach((track) => peer.addTrack(track, this.micStream));

      this.dataChannel = peer.createDataChannel('oai-events');
      this.dataChannel.onopen = () => this.log('Data channel open');
      this.dataChannel.onclose = () => this.log('Data channel closed');
      this.dataChannel.onerror = (event) => this.log('Data channel error', { message: event.message });
      this.dataChannel.onmessage = ({ data }) => this.handleLiveEvent(data);

      this.statusText.textContent = 'Connecting to GPT-Live-1...';
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await this.waitForIceGathering(peer);
      if (!peer.localDescription?.sdp) throw new Error('The browser did not create a WebRTC offer.');

      const response = await fetch('/voice-agent/live/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sdp: peer.localDescription.sdp,
          cli: normalizeAustralianPhone(this.cliInput.value),
        }),
      });
      const result = await response.json();
      this.log('Session creation response', { httpStatus: response.status, success: Boolean(result.success) });
      if (!response.ok || !result.success || !result.transport?.sdp) {
        throw new Error(result.message || 'Could not create the GPT-Live-1 session.');
      }
      await peer.setRemoteDescription({ type: 'answer', sdp: result.transport.sdp });
    } catch (error) {
      this.log('Connection failed', { message: error.message || String(error) });
      if (this.isCallActive) {
        this.endCall();
        this.statusText.textContent = error.message || 'GPT-Live connection failed';
      }
    }
  }

  waitForIceGathering(peer) {
    if (peer.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
      let resolved = false;
      let candidateDebounceTimer = null;

      const finish = () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(maxTimeout);
        if (candidateDebounceTimer) clearTimeout(candidateDebounceTimer);
        peer.removeEventListener('icegatheringstatechange', onStateChange);
        peer.removeEventListener('icecandidate', onCandidate);
        resolve();
      };

      // Safety timeout: proceed within 500ms max so connection setup is not blocked
      const maxTimeout = setTimeout(finish, 500);

      const onStateChange = () => {
        if (peer.iceGatheringState === 'complete') finish();
      };

      const onCandidate = (event) => {
        // Once local candidates begin arriving, wait a brief 150ms buffer to bundle any sibling candidates, then proceed
        if (event.candidate && !candidateDebounceTimer) {
          candidateDebounceTimer = setTimeout(finish, 150);
        }
      };

      peer.addEventListener('icegatheringstatechange', onStateChange);
      peer.addEventListener('icecandidate', onCandidate);
    });
  }

  handleLiveEvent(rawEvent) {
    let event;
    try {
      event = JSON.parse(rawEvent);
    } catch (error) {
      this.log('Could not parse Live event', { message: error.message });
      return;
    }
    if (typeof event.type !== 'string' || !event.type.endsWith('.delta')) {
      this.log('Received Live event', {
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
      this.sendLiveEvent({
        type: 'session.instructions.append',
        event_id: `live_greeting_${Date.now()}`,
        delegation_id: null,
        content: 'Immediately start speaking. Say the opening greeting from your session instructions now, without waiting for the caller to speak. Then pause and listen.',
      });
    } else if (event.type === 'session.instructions.appended') {
      this.log('Session instruction accepted', { clientEventId: event.client_event_id });
    } else if (event.type === 'session.input_transcript.delta') {
      if (!this.pendingUserTranscript) this.flushAssistantTranscript();
      this.pendingUserTranscript += event.delta || '';
    } else if (event.type === 'session.input_transcript.done') {
      const transcript = (event.transcript || this.pendingUserTranscript).trim();
      if (transcript) {
        this.pendingUserTranscript = transcript;
        this.flushUserTranscript();
        this.callerWantsToEnd = /\b(bye|goodbye|farewell|hang\s*up|end (?:the )?call|that(?:'s| is) all|nothing else|i(?:'m| am) done)\b/i.test(transcript);
        this.log('Caller end intent evaluated', { detected: this.callerWantsToEnd, transcriptCharacters: transcript.length });
      }
    } else if (event.type === 'session.output_transcript.delta') {
      this.flushUserTranscript();
      this.assistantTranscript += event.delta || '';
    } else if (event.type === 'session.output_transcript.done') {
      this.assistantTranscript = event.transcript || this.assistantTranscript;
      this.flushAssistantTranscript();
    } else if (event.type === 'session.output_audio.done') {
      this.log('Assistant audio finished', { callerRequestedEnd: this.callerWantsToEnd });
      if (this.callerWantsToEnd) this.endCall();
    } else if (event.type === 'session.delegation.created') {
      if (event.delegation?.target === 'client') this.handleDelegation(event.delegation.id);
    } else if (event.type === 'session.error' || event.type === 'error') {
      this.log('Live session error', { error: event.error });
      this.statusText.textContent = event.error?.message || 'GPT-Live session error';
    } else if (event.type === 'session.closed') {
      this.log('Live session closed', { reason: event.reason, usage: event.usage });
      this.finishCall();
    }
  }

  sendLiveEvent(event) {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      this.log('Could not send Live event: data channel is not open', { type: event.type, state: this.dataChannel?.readyState });
      return;
    }
    this.log('Sending Live event', { type: event.type, eventId: event.event_id, delegationId: event.delegation_id });
    this.dataChannel.send(JSON.stringify(event));
  }

  flushAssistantTranscript() {
    const text = this.assistantTranscript.trim();
    if (!text) return;
    this.history.push({ role: 'assistant', content: text });
    this.addTranscript('agent', text);
    this.assistantTranscript = '';
  }

  flushUserTranscript() {
    const text = this.pendingUserTranscript.trim();
    if (!text) return;
    this.history.push({ role: 'user', content: text });
    this.lastUserTurn = text;
    this.pendingUserTranscript = '';
    this.addTranscript('user', text);
  }

  async handleDelegation(delegationId) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    if (!this.isCallActive || !delegationId) return;

    const message = (this.pendingUserTranscript || this.lastUserTurn).trim();
    if (!message) {
      this.log('Delegation skipped because caller transcript is empty', { delegationId });
      return;
    }
    this.flushUserTranscript();
    this.statusText.textContent = 'Checking dealership information...';
    this.log('Delegation started', { delegationId, transcriptCharacters: message.length });

    try {
      const response = await fetch('/voice-agent/live/delegation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          history: this.history,
          cli: normalizeAustralianPhone(this.cliInput.value),
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success || !result.response) {
        throw new Error(result.message || 'The dealership assistant could not complete that request.');
      }
      this.log('Delegation completed', {
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
      this.log('Delegation failed', { delegationId, message: error.message || String(error) });
      this.sendLiveEvent({
        type: 'session.commentary.append',
        event_id: `backend_error_${Date.now()}`,
        delegation_id: delegationId,
        content: 'I could not check that information just now. Please try again or ask me to take a message.',
      });
      this.statusText.textContent = 'GPT-Live-1 call active';
    }
  }

  endCall() {
    this.log('Call end requested', {
      callerRequestedEnd: this.callerWantsToEnd,
      dataChannelState: this.dataChannel?.readyState || 'unavailable',
    });
    if (this.dataChannel?.readyState === 'open' && this.isCallActive) {
      this.isCallActive = false;
      this.micStream?.getAudioTracks().forEach((track) => { track.enabled = false; });
      this.statusText.textContent = 'Ending call...';
      this.playBtnText.textContent = 'Ending Call';
      this.playBtn.disabled = true;
      this.sendLiveEvent({ type: 'session.close', event_id: `live_close_${Date.now()}` });
      this.closeTimeout = setTimeout(() => {
        this.log('Timed out waiting for session.closed; cleaning up locally');
        this.finishCall();
      }, 5000);
      return;
    }
    this.finishCall();
  }

  finishCall() {
    clearTimeout(this.closeTimeout);
    this.closeTimeout = null;
    this.isCallActive = false;
    this.dataChannel?.close();
    this.dataChannel = null;
    this.peer?.close();
    this.peer = null;
    this.stopMicrophone();
    this.remoteAudio?.pause();
    this.remoteAudio?.remove();
    this.remoteAudio = null;
    this.playBtn.disabled = false;
    this.playBtn.classList.remove('active');
    this.playBtnText.textContent = 'Start Voice Agent';
    this.playIcon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"></polygon>';
    this.statusBadge.className = 'status-badge idle';
    this.statusText.textContent = 'Call ended';
  }

  stopMicrophone() {
    this.micStream?.getTracks().forEach((track) => track.stop());
    this.micStream = null;
  }

  addTranscript(role, text) {
    const entry = document.createElement('div');
    entry.className = `transcript-entry ${role}`;
    const label = document.createElement('span');
    label.className = 'entry-role';
    label.textContent = role === 'agent' ? 'Purnell Assistant' : 'Caller';
    const body = document.createElement('span');
    body.textContent = text;
    entry.append(label, body);
    this.transcriptBox.appendChild(entry);
    this.transcriptBox.scrollTop = this.transcriptBox.scrollHeight;
  }

  clearTranscript() {
    this.transcriptBox.replaceChildren();
    this.history = [];
    this.pendingUserTranscript = '';
    this.lastUserTurn = '';
    this.assistantTranscript = '';
  }
}

document.addEventListener('DOMContentLoaded', () => new LiveVoiceAgent());
