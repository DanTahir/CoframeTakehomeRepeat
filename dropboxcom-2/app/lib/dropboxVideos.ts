/**
 * Autoplay for the 4 looping product videos (hero + find/organize/share).
 *
 * THE TRAP: a JSX `muted` attribute is NOT enough.
 * ------------------------------------------------
 * Browsers only permit unattended autoplay on a video that is *muted*, and
 * they read that from the DOM **property**, not the attribute React rendered.
 * Shipping `<video autoPlay muted>` alone therefore yields a silently paused
 * first frame — no console error, and the viewport audit's broken-image style
 * checks can't see it either. So `muted` / `defaultMuted` / `playsInline` are
 * assigned as properties here, then `.play()` is called explicitly.
 *
 * The retry on `canplay`/`loadeddata` covers the case where the element is not
 * yet decodable when the effect first runs (these are multi-MB `.webm` files).
 *
 * Scoped to `video[autoplay]` on purpose: a video the original page did not
 * autoplay must stay paused.
 */
import { $all, type Teardown } from './runtime';

export function initDropboxVideos(root: ParentNode = document): Teardown | void {
  const videos = $all<HTMLVideoElement>('video[autoplay]', root);
  if (!videos.length) return;

  const cleanups: Array<() => void> = [];

  for (const video of videos) {
    // Properties, not attributes — see the header note.
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;

    const attemptPlay = () => {
      try {
        const played = video.play() as Promise<void> | undefined;
        // Autoplay rejection is expected and harmless; swallow it rather than
        // letting an unhandled rejection surface as a console error.
        if (played && typeof played.catch === 'function') played.catch(() => {});
      } catch {
        /* jsdom and locked-down policies both throw synchronously here */
      }
    };

    attemptPlay();
    video.addEventListener('canplay', attemptPlay);
    video.addEventListener('loadeddata', attemptPlay);

    cleanups.push(() => {
      video.removeEventListener('canplay', attemptPlay);
      video.removeEventListener('loadeddata', attemptPlay);
    });
  }

  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}
