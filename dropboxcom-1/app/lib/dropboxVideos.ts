/**
 * Autoplay for Dropbox's inline product videos (site-specific).
 *
 * The capture contains 4 `<video autoplay playsinline loop muted>` elements
 * (hero + three feature planks), each with a single local `.webm` source.
 *
 * Two reasons they do not simply play on their own:
 *  1. React renders `muted` as an *attribute*, and Chrome decides autoplay
 *     eligibility from the media element's muted **property**. A video that is
 *     `muted=""` in markup but not muted as a property is blocked by the
 *     autoplay policy and silently shows a frozen first frame. Setting
 *     `muted`/`defaultMuted` as properties here is the actual fix.
 *  2. The first `play()` can still reject if it is attempted before the
 *     element has data, so it is retried once the media reports readiness.
 *
 * Rejections are swallowed: a blocked autoplay must never surface as an
 * unhandled promise rejection.
 */
import { $all, prefersReducedMotion, type Teardown } from './runtime';

export interface DropboxVideosOptions {
  selector?: string;
}

export function createDropboxVideos(options: DropboxVideosOptions = {}) {
  const { selector = 'video.dwg-media-video, video[autoplay]' } = options;

  return function initDropboxVideos(root: ParentNode = document): Teardown | void {
    const videos = $all<HTMLVideoElement>(selector, root);
    if (!videos.length) return;

    const cleanups: Teardown[] = [];
    const reduced = prefersReducedMotion();

    for (const video of videos) {
      // Properties, not attributes — see the note above.
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;

      if (reduced) {
        try {
          video.pause();
        } catch {
          /* nothing to pause yet */
        }
        continue;
      }

      const tryPlay = () => {
        try {
          const played = video.play() as Promise<void> | undefined;
          if (played && typeof played.catch === 'function') played.catch(() => {});
        } catch {
          /* autoplay blocked or media not ready; the retry below covers it */
        }
      };

      tryPlay();
      video.addEventListener('canplay', tryPlay);
      video.addEventListener('loadeddata', tryPlay);
      cleanups.push(() => {
        video.removeEventListener('canplay', tryPlay);
        video.removeEventListener('loadeddata', tryPlay);
      });
    }

    return () => {
      for (const c of cleanups) c();
    };
  };
}

export const initDropboxVideos = createDropboxVideos();
