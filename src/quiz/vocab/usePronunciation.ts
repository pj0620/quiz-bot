import {
  useCallback,
  useEffect,
  useRef,
  useState } from 'react';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import * as Speech from 'expo-speech';

import { resolvePronunciationUrl } from './pronunciation';

/**
 * Says a word out loud: the recording where one exists, the device's own
 * voice where none does.
 *
 * The split with `pronunciation.ts` is deliberate — everything importable
 * under jest lives there, and everything that touches a native module lives
 * here. The fallback order is the point of the design: a resolved URL plays
 * Google's recording; no URL, or a player that fails to start, falls through
 * to `expo-speech`, which works offline and knows every word. The button
 * always does SOMETHING, which is what lets it be shown unconditionally
 * instead of appearing only once a network round-trip has vouched for the
 * word.
 *
 * One hook instance owns one player, so this belongs INSIDE a small button
 * component: `useAudioPlayerStatus` re-renders its caller on every status
 * tick while a clip plays, which is fine for an icon and would be a drum beat
 * through a whole screen.
 */

/**
 * Set once, lazily, before the first playback. `playsInSilentMode` is the
 * load-bearing option: a pronunciation button that stays mute because the
 * ring switch is down reads as broken, not as respectful — the tap IS the
 * request to hear it. The interruption mode stays the default `mixWithOthers`,
 * which is documented for exactly this: short clips over whatever else is
 * playing.
 */
let audioModeApplied = false;
async function applyAudioModeOnce(): Promise<void> {
  if (audioModeApplied) return;
  audioModeApplied = true;
  try {
    await setAudioModeAsync({ playsInSilentMode: true });
  } catch {
    // Try again next play; playback itself may still work meanwhile.
    audioModeApplied = false;
  }
}

export type Pronunciation = {
  /** Play the word. Restarts if already playing; never throws. */
  pronounce: () => Promise<void>;
  /** True from tap until the sound has started — or finished, for speech. */
  active: boolean;
};

export function usePronunciation(word: string | undefined): Pronunciation {
  // No source up front: the URL is only known once a tap has resolved it.
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);

  const [resolving, setResolving] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  /** What the player currently holds, so a replay seeks instead of re-fetching. */
  const loadedUrl = useRef<string | null>(null);

  /*
    Guards the state updates that outlive a press: resolution and speech both
    finish on their own schedule, and the button may have left the screen by
    then (Next is tapped mid-clip). The player itself needs no such care —
    `useAudioPlayer` releases it on unmount.
  */
  const alive = useRef(true);
  /** Which utterance the speech callbacks belong to — see `speak`. */
  const utterance = useRef(0);
  const speakingRef = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      // Only silence the voice this hook started: speech is a global channel.
      if (speakingRef.current) void Speech.stop();
    };
  }, []);

  const setSpeakingState = useCallback((value: boolean) => {
    speakingRef.current = value;
    if (alive.current) setSpeaking(value);
  }, []);

  const speak = useCallback(
    (text: string) => {
      /*
        A tap during speech restarts rather than queues — expo-speech would
        otherwise say the word twice back to back. The counter keeps the
        stopped utterance's own callbacks from switching the light off after
        the new utterance has turned it on.
      */
      const id = (utterance.current += 1);
      const finish = () => {
        if (utterance.current === id) setSpeakingState(false);
      };
      void Speech.stop();
      setSpeakingState(true);
      Speech.speak(text, {
        language: 'en-US',
        onDone: finish,
        onStopped: finish,
        onError: finish,
      });
    },
    [setSpeakingState],
  );

  const pronounce = useCallback(async () => {
    if (!word || resolving) return;

    setResolving(true);
    try {
      const url = await resolvePronunciationUrl(word);
      if (!alive.current) return;

      if (url) {
        await applyAudioModeOnce();
        try {
          if (loadedUrl.current === url) {
            // Same clip again: rewind rather than re-download it.
            await player.seekTo(0);
          } else {
            player.replace(url);
            loadedUrl.current = url;
          }
          player.play();
          return;
        } catch {
          /*
            The player refused the handoff. Loading is asynchronous, so this
            only catches immediate refusals — a clip that fails later simply
            plays nothing, which the probe in `pronunciation.ts` exists to
            make rare. Falling through to the voice beats a dead tap.
          */
          loadedUrl.current = null;
        }
      }

      speak(word);
    } finally {
      if (alive.current) setResolving(false);
    }
  }, [word, resolving, player, speak]);

  return { pronounce, active: resolving || speaking || status.playing };
}
