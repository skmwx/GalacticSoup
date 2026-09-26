import type { AudioCueData } from '@protocol';

/**
 * Plays authored cues (Functional Specification 19.7; Technical Specification
 * 4.2, 12.3-12.4).
 *
 * Audio belongs to the main thread and is triggered by semantic notifications,
 * never by simulation timing. A cue is a short sequence of tones synthesised
 * with the Web Audio API, so the build carries no audio files and nothing is
 * fetched. Where the browser offers no audio context the player is silent and
 * says so; nothing else depends on it.
 *
 * Browsers start audio suspended until the player interacts with the page.
 * The player resumes the context on each play; a cue asked for before the
 * first interaction is simply not heard, and the visible notification still
 * carries the message.
 *
 * @implements FUNC-19.7, TECH-4.2, TECH-12.3, TECH-12.4
 */

export interface CuePlayer {
  /** Whether this browser can play cues at all. */
  readonly available: boolean;
  /** Plays a cue at a volume from 0 through 1. */
  play(cue: AudioCueData, volume: number): void;
}

type AudioContextConstructor = new () => AudioContext;

export function createCuePlayer(): CuePlayer {
  const Context = audioContextConstructor();
  if (Context === null) {
    return { available: false, play: () => undefined };
  }
  let context: AudioContext | null = null;
  return {
    available: true,
    play(cue, volume) {
      if (volume <= 0) return;
      try {
        context ??= new Context();
        if (context.state === 'suspended') void context.resume().catch(() => undefined);
        schedule(context, cue, volume);
      } catch {
        // A refused or broken audio device must never break the interface.
      }
    },
  };
}

/** A player that records what it was asked to play, for tests and diagnostics. */
export function createRecordingCuePlayer(): CuePlayer & { readonly played: { cueId: string; volume: number }[] } {
  const played: { cueId: string; volume: number }[] = [];
  return {
    available: true,
    played,
    play(cue, volume) {
      played.push({ cueId: cue.id, volume });
    },
  };
}

function schedule(context: AudioContext, cue: AudioCueData, volume: number): void {
  let start = context.currentTime + 0.01;
  for (const note of cue.notes) {
    const duration = note.durationMs / 1000;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = cue.waveform;
    oscillator.frequency.setValueAtTime(note.frequencyHz, start);
    // A short attack and release keep the tones from clicking.
    const peak = Math.max(0.0001, note.gain * volume);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + Math.min(0.01, duration / 4));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
    start += duration + 0.02;
  }
}

function audioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === 'undefined') return null;
  const candidate = window as unknown as {
    AudioContext?: AudioContextConstructor;
    webkitAudioContext?: AudioContextConstructor;
  };
  return candidate.AudioContext ?? candidate.webkitAudioContext ?? null;
}
