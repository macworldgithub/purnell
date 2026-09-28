# Voice agent workflow and improvement guide

Reviewed: 2026-09-25

This document describes the voice flows currently present in this repository, likely causes of unwanted interruptions and lag, and how the GPT-Live-1 mode connects to the existing dealership backend. It is implementation context for future coding agents.

## Available voice modes

The web UI has a **Voice model** selector. Choose **Current pipeline** to use the existing Deepgram, OpenAI Chat Completions, and ElevenLabs flow. Choose **OpenAI GPT-Live-1** to use speech-to-speech over WebRTC. GPT-Live-1 generates the audio in that mode; the dealership backend still runs the existing OpenAI text agent and tools for business-data requests, without generating ElevenLabs audio.

The OpenAI API key stays on the server. The browser sends its WebRTC SDP offer to `POST /voice-agent/live/session`; the server creates a `gpt-live-1` session and returns the SDP answer. The browser microphone requests echo cancellation and noise suppression. On hang-up, it closes the peer connection and microphone tracks.

GPT-Live-1 uses client delegation. It answers ordinary conversational turns itself and asks the application to handle dealership and customer requests. The browser accumulates Live input transcript events, sends the request and conversation history to `POST /voice-agent/live/delegation`, and returns the backend result to Live with `session.commentary.append` so GPT-Live-1 speaks it. The backend path calls `processTextMessage` with audio generation disabled. It still applies existing customer lookup, prompt, and tool behavior.

## Current implementation

The browser demo uses browser speech recognition to turn microphone speech into text. The text travels over the NestJS WebSocket gateway to the voice-agent service. The backend uses Deepgram for live transcription/session events, OpenAI Chat Completions for the response, and ElevenLabs for generated speech audio.

| Responsibility | Current implementation | Source |
| --- | --- | --- |
| Browser interface and microphone recognition | Web Speech API `SpeechRecognition` in the demo | [public/app.js](../public/app.js) |
| WebSocket transport | NestJS gateway at `/voice` | [voice-agent.gateway.ts](../src/voice-agent/voice-agent.gateway.ts) |
| Session orchestration and interruption handling | Voice-agent service | [voice-agent.service.ts](../src/voice-agent/voice-agent.service.ts) |
| Server-side transcription connection | Deepgram live connection | [deepgram.service.ts](../src/deepgram/deepgram.service.ts) |
| Model and voice configuration | Voice-agent config | [voice-agent.config.ts](../src/config/voice-agent.config.ts) |
| LLM response generation | OpenAI Chat Completions; a Realtime session config helper is defined but is not used by this browser path | [openai.service.ts](../src/openai/openai.service.ts) |
| Speech generation | ElevenLabs streaming TTS | [elevenlabs.service.ts](../src/elevenlabs/elevenlabs.service.ts) |

There is no PSTN/SIP call integration visible in this repository. The current browser path primarily sends recognized text to the backend; do not assume the Deepgram connection is the browser microphone's only or authoritative transcription path.

## Current conversation workflow

1. The browser opens a WebSocket connection to `/voice` and starts browser speech recognition.
2. Interim recognition results arrive while the caller is still speaking.
3. If the UI considers the agent to be speaking, any non-empty interim text immediately stops the audio and sends a `stop_agent_speaking` event. This is the strongest code-level candidate for background/echo false interruptions.
4. After a 650 ms silence timer, the browser sends the finalized user text as `text_input`.
5. The gateway forwards the text to the voice-agent service.
6. The service requests a response from OpenAI and sends generated speech from ElevenLabs back as audio chunks.
7. The browser plays the chunks and updates speaking state.

~~~mermaid
sequenceDiagram
    participant Caller
    participant Browser as Browser demo (SpeechRecognition)
    participant WS as NestJS /voice gateway
    participant VA as Voice agent service
    participant LLM as OpenAI Chat Completions
    participant TTS as ElevenLabs
    Caller->>Browser: microphone speech
    Browser-->>Browser: interim and final recognized text
    alt interim text while agent audio is playing
        Browser->>Browser: stop audio immediately
        Browser->>WS: stop_agent_speaking
        WS->>VA: interrupt current response
    end
    Browser->>Browser: wait 650 ms after speech ends
    Browser->>WS: text_input
    WS->>VA: process user turn
    VA->>LLM: generate answer
    LLM-->>VA: answer text
    VA->>TTS: stream speech synthesis
    TTS-->>VA: audio chunks
    VA-->>WS: audio chunks
    WS-->>Browser: audio chunks
    Browser-->>Caller: play agent response
~~~

## GPT-Live-1 workflow

~~~mermaid
sequenceDiagram
    participant Caller
    participant Browser as Web UI (WebRTC)
    participant Server as NestJS API
    participant Live as OpenAI GPT-Live-1
    participant Agent as Existing OpenAI text agent and CRM tools
    Caller->>Browser: microphone audio
    Browser->>Server: POST SDP offer
    Server->>Live: create gpt-live-1 WebRTC session
    Live-->>Server: SDP answer
    Server-->>Browser: SDP answer
    Browser->>Live: negotiated audio and event channel
    Live-->>Browser: speech and transcript events
    Live-->>Browser: client delegation event
    Browser->>Server: transcript, history, CLI
    Server->>Agent: resolve customer context and run tools
    Agent-->>Server: text result
    Server-->>Browser: text result
    Browser->>Live: session.commentary.append
    Live-->>Caller: speak result in native Live voice
~~~

## Why background noise can interrupt the agent

The browser's barge-in policy is aggressive: any non-empty interim recognized text while agent playback is active stops playback immediately. It does not appear to require a minimum duration, confidence score, or confirmation that the audio came from the caller rather than the speaker/room. Browser speech recognition can misrecognize background sounds or the agent's own audio as speech.

The backend also has interruption callbacks in its Deepgram session. Review both paths together: a browser-side stop event can interrupt before backend thresholds matter, and Deepgram callbacks can independently trigger barge-in. The configured OpenAI VAD threshold is not used by this text-input browser flow. The Deepgram endpointing configuration should also be checked against the actual connection options being passed.

Relevant locations:
- `public/app.js`: recognition result handler and interruption decision; 650 ms silence timer; outbound text input; audio stop behavior.
- `src/voice-agent/voice-agent.gateway.ts`: `/voice` events and forwarding.
- `src/voice-agent/voice-agent.service.ts`: Deepgram callbacks, barge-in cancellation, response generation and audio lifecycle.
- `src/deepgram/deepgram.service.ts`: transcript and speech-start event callbacks and live connection options.
- `src/config/voice-agent.config.ts`: OpenAI VAD threshold and Deepgram endpointing settings.

## Recommended diagnosis and fixes

Add structured timestamps for each turn: microphone/result event, final transcript, WebSocket send/receive, LLM request/first token, TTS request/first audio chunk, and browser first playback. Record interruption reason and source (browser interim result, Deepgram speech-start, explicit user action), plus transcript confidence/duration where available. Avoid logging raw audio or sensitive conversation content by default.

Tune barge-in as a stateful decision rather than a single interim-result check:
- Do not interrupt on every interim recognition result. Require sustained speech or a final/confirmed transcript, and apply a short debounce.
- While agent audio plays, use echo cancellation/noise suppression where supported; compare headphones as a diagnostic.
- Add a short post-playback guard and suppress recognition matching recent agent output, while preserving an explicit user stop control.
- Make the interrupt policy configurable so sensitivity can be tested without code edits.
- Verify whether browser recognition and Deepgram are both acting as speech detectors. Choose a clear source of truth for each mode to avoid duplicate or contradictory turn detection.
- Test with quiet background, steady noise, competing speech, and agent-speaker echo. Compare false interruption rate and genuine barge-in response time.

For lag, measure each pipeline segment independently before tuning. The browser's 650 ms silence wait is a fixed part of perceived turn latency. Stream model output into TTS at safe phrase boundaries and start playback on the first audio chunk. Check network round trips, provider region, buffering, and whether generation is serialized. Keep interruption/cancellation responsive when a new confirmed user turn arrives.

## GPT-Live-1 implementation details

GPT-Live-1 is a selectable mode, separate from the current modular pipeline. Live uses OpenAI's speech-to-speech model for audio input/output and has its own session lifecycle, WebRTC transport, turn detection, and interruption behavior.

Implementation files:
- `public/index.html` and `public/app.js`: voice mode selector, WebRTC setup, Live data channel events, transcript accumulation, delegated request/result, and resource cleanup.
- `src/openai/openai.service.ts`: server-side `gpt-live-1` WebRTC session configuration; the chosen native voice is `quartz`.
- `src/voice-agent/voice-agent.controller.ts`: session-creation and text-delegation HTTP routes.
- `src/voice-agent/voice-agent.service.ts`: optional audio generation flag; current pipeline keeps ElevenLabs enabled, Live delegation disables it.

This repository currently shows a browser demo rather than a PSTN call stack. If calls eventually arrive over telephone, assess the documented SIP/provider path separately.

## GPT-Live-1 with ElevenLabs

ElevenLabs is not used in GPT-Live-1 mode yet. A future hybrid could use Live transcript output with ElevenLabs speech, but it would add a streaming boundary, alignment/cancellation work, and possible latency. Confirm API support and event semantics before implementation; do not assume a supported setting turns off Live audio while preserving the same interaction behavior.

When implementing ElevenLabs in Live mode later, keep it as a separate option and measure latency end to end. Prototype transcript-to-TTS first and confirm output text arrives incrementally and reliably enough for natural speech.

## Suggested implementation order

1. Test both modes with ordinary questions and the same background-noise/echo setup.
2. Check that a GPT-Live-1 dealership question reaches the server delegation endpoint and gets a spoken result.
3. Compare interruption behavior and time-to-first-audio between modes.
4. Add ElevenLabs to Live mode later only if the voice requirement justifies the extra path.

## Official references

OpenAI:
- [Introducing GPT-Live-1 in the API](https://openai.com/index/introducing-gpt-live-1-in-the-api/)
- [GPT-Live-1 model reference](https://developers.openai.com/api/docs/models/gpt-live-1)
- [Live API guide](https://developers.openai.com/api/docs/guides/live)
- [WebRTC browser connection guide](https://developers.openai.com/api/docs/guides/voice-webrtc)
- [Live conversations](https://developers.openai.com/api/docs/guides/live-conversations)
- [Delegate tasks from Live sessions](https://developers.openai.com/api/docs/guides/live-delegation)
- [Live API migration guide](https://developers.openai.com/api/docs/guides/live-migration)
- [Voice with SIP](https://developers.openai.com/api/docs/guides/voice-sip)
- [Server controls for Live sessions](https://developers.openai.com/api/docs/guides/voice-server-controls?api=live)

ElevenLabs:
- [Realtime TTS over WebSockets](https://elevenlabs.io/docs/eleven-api/guides/how-to/websockets/realtime-tts)
- [Latency optimization](https://elevenlabs.io/docs/eleven-api/guides/how-to/best-practices/latency-optimization)

Re-check provider documentation before implementation because model names, transport details, event schemas, and pricing can change.
