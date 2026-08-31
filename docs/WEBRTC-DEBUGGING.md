# WebRTC troubleshooting

## Expected browser log flow

A healthy two-participant call should produce these logs in the meeting page console:

```text
[WebRTC] peer created
[WebRTC] offer sent
[WebRTC] answer sent
[WebRTC] answer applied
[WebRTC] ICE state
[WebRTC] connection state
[WebRTC] remote track received
```

## Remote tile stays blank

Check for `[WebRTC] remote track received`. If it is present, the media connection succeeded and the problem is in video-element attachment or browser playback. The meeting page stores remote `MediaStream` instances independently of the React DOM lifecycle and attaches them again when a participant video element mounts.

If the log never reaches `remote track received`, inspect offer/answer and ICE logs first.

## ICE failures

The API can return STUN/TURN configuration from `/meetings/ice-servers`. A production deployment should provide a TURN service so peers can connect when direct NAT traversal fails.

## Signaling

Firestore is used only for signaling. Each signal is targeted to a single Firebase UID. The client uses a deterministic offerer (the lexicographically smaller UID) to reduce offer glare.
