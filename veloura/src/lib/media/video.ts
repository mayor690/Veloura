"use client";

export type VideoProbe = { durationMs: number; width: number; height: number };

/** Read duration and dimensions from the file's metadata, in the browser. */
export function probeVideo(file: Blob): Promise<VideoProbe> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    const url = URL.createObjectURL(file);
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      fn();
    };
    const fail = () => finish(() => reject(new Error("We couldn't read this video. Try an MP4.")));
    const timer = setTimeout(fail, 10_000);

    const ok = () => {
      const d = v.duration;
      if (!Number.isFinite(d) || !v.videoWidth || !v.videoHeight) return fail();
      finish(() => resolve({ durationMs: Math.floor(d * 1000), width: v.videoWidth, height: v.videoHeight }));
    };

    v.preload = "metadata";
    v.muted = true;
    v.onerror = fail;
    v.onloadedmetadata = () => {
      if (v.duration === Infinity) {
        // MediaRecorder WebM files report Infinity until the browser is forced to scan to the end.
        v.onseeked = ok;
        v.ontimeupdate = ok;
        v.currentTime = 1e101;
      } else ok();
    };
    v.src = url;
  });
}
