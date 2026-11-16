// Generates a rich synthesized acoustic/lofi melodic track as a WAV Blob
export function generateSampleSongTrack(
  theme: 'lofi' | 'pop' | 'ballad' = 'pop',
  durationSec: number = 30
): Promise<{ blob: Blob; url: string }> {
  return new Promise((resolve) => {
    const sampleRate = 44100;
    const numChannels = 2;
    const numFrames = sampleRate * durationSec;

    const offlineCtx = new OfflineAudioContext(numChannels, numFrames, sampleRate);

    // Chords progression (e.g. C - Am - F - G or Am - F - C - G)
    const chords = theme === 'lofi' 
      ? [
          [261.63, 329.63, 392.00, 493.88], // Cmaj7
          [220.00, 261.63, 329.63, 392.00], // Am7
          [174.61, 220.00, 261.63, 329.63], // Fmaj7
          [196.00, 246.94, 293.66, 349.23], // G7
        ]
      : theme === 'ballad'
      ? [
          [196.00, 246.94, 293.66], // G
          [164.81, 207.65, 246.94], // Em
          [220.00, 261.63, 329.63], // C
          [146.83, 220.00, 293.66], // D
        ]
      : [
          [220.00, 261.63, 329.63], // Am
          [174.61, 220.00, 261.63], // F
          [261.63, 329.63, 392.00], // C
          [196.00, 246.94, 293.66], // G
        ];

    const chordDuration = 3.5;
    const totalBars = Math.ceil(durationSec / chordDuration);

    // Bass / Pad / Arpeggio oscillators
    for (let bar = 0; bar < totalBars; bar++) {
      const chord = chords[bar % chords.length];
      const startTime = bar * chordDuration;
      if (startTime >= durationSec) break;

      // Warm Pad
      chord.forEach((freq, idx) => {
        const osc = offlineCtx.createOscillator();
        const gain = offlineCtx.createGain();
        osc.type = idx % 2 === 0 ? 'sine' : 'triangle';
        osc.frequency.setValueAtTime(freq, startTime);

        gain.gain.setValueAtTime(0.001, startTime);
        gain.gain.linearRampToValueAtTime(0.12, startTime + 0.5);
        gain.gain.linearRampToValueAtTime(0.09, startTime + chordDuration - 0.4);
        gain.gain.linearRampToValueAtTime(0.001, startTime + chordDuration);

        osc.connect(gain);
        gain.connect(offlineCtx.destination);
        osc.start(startTime);
        osc.stop(startTime + chordDuration);
      });

      // Sub Bass
      const bassOsc = offlineCtx.createOscillator();
      const bassGain = offlineCtx.createGain();
      bassOsc.type = 'sine';
      bassOsc.frequency.setValueAtTime(chord[0] / 2, startTime);

      bassGain.gain.setValueAtTime(0.001, startTime);
      bassGain.gain.linearRampToValueAtTime(0.22, startTime + 0.1);
      bassGain.gain.exponentialRampToValueAtTime(0.01, startTime + chordDuration - 0.2);

      bassOsc.connect(bassGain);
      bassGain.connect(offlineCtx.destination);
      bassOsc.start(startTime);
      bassOsc.stop(startTime + chordDuration);

      // Soft rhythmic clicks / percussion
      for (let beat = 0; beat < 4; beat++) {
        const beatTime = startTime + beat * (chordDuration / 4);
        if (beatTime >= durationSec) break;

        // Kick / Soft pulse on 0 and 2
        if (beat === 0 || beat === 2) {
          const kickOsc = offlineCtx.createOscillator();
          const kickGain = offlineCtx.createGain();
          kickOsc.frequency.setValueAtTime(110, beatTime);
          kickOsc.frequency.exponentialRampToValueAtTime(35, beatTime + 0.15);
          kickGain.gain.setValueAtTime(0.3, beatTime);
          kickGain.gain.exponentialRampToValueAtTime(0.001, beatTime + 0.18);
          kickOsc.connect(kickGain);
          kickGain.connect(offlineCtx.destination);
          kickOsc.start(beatTime);
          kickOsc.stop(beatTime + 0.2);
        }

        // Snare / Rimshot on 1 and 3
        if (beat === 1 || beat === 3) {
          const snareOsc = offlineCtx.createOscillator();
          const snareGain = offlineCtx.createGain();
          snareOsc.type = 'triangle';
          snareOsc.frequency.setValueAtTime(220, beatTime);
          snareGain.gain.setValueAtTime(0.12, beatTime);
          snareGain.gain.exponentialRampToValueAtTime(0.001, beatTime + 0.12);
          snareOsc.connect(snareGain);
          snareGain.connect(offlineCtx.destination);
          snareOsc.start(beatTime);
          snareOsc.stop(beatTime + 0.15);
        }
      }
    }

    offlineCtx.startRendering().then((renderedBuffer) => {
      const wavBytes = audioBufferToWav(renderedBuffer);
      const blob = new Blob([wavBytes], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      resolve({ blob, url });
    });
  });
}

function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;

  let result: Float32Array;
  if (numChannels === 2) {
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    result = new Float32Array(left.length + right.length);
    for (let i = 0; i < left.length; i++) {
      result[i * 2] = left[i];
      result[i * 2 + 1] = right[i];
    }
  } else {
    result = buffer.getChannelData(0);
  }

  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = result.length * bytesPerSample;
  const bufferSize = 44 + dataSize;

  const arrayBuffer = new ArrayBuffer(bufferSize);
  const view = new DataView(arrayBuffer);

  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  /* RIFF identifier */
  writeString(0, 'RIFF');
  /* RIFF chunk length */
  view.setUint32(4, 36 + dataSize, true);
  /* RIFF type */
  writeString(8, 'WAVE');
  /* format chunk identifier */
  writeString(12, 'fmt ');
  /* format chunk length */
  view.setUint32(16, 16, true);
  /* sample format (raw) */
  view.setUint16(20, format, true);
  /* channel count */
  view.setUint16(22, numChannels, true);
  /* sample rate */
  view.setUint32(24, sampleRate, true);
  /* byte rate (sample rate * block align) */
  view.setUint32(28, byteRate, true);
  /* block align (channel count * bytes per sample) */
  view.setUint16(32, blockAlign, true);
  /* bits per sample */
  view.setUint16(34, bitDepth, true);
  /* data chunk identifier */
  writeString(36, 'data');
  /* data chunk length */
  view.setUint32(40, dataSize, true);

  // Write PCM samples
  let offset = 44;
  for (let i = 0; i < result.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, result[i]));
    s = s < 0 ? s * 0x8000 : s * 0x7fff;
    view.setInt16(offset, s, true);
  }

  return arrayBuffer;
}
