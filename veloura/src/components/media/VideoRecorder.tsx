"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Circle, RefreshCw, Square, X } from "lucide-react";
import { MAX_VIDEO_MS } from "@/lib/media/limits";

type Props = {
  onRecorded: (file: File, info: { durationMs: number; width: number; height: number }) => void;
  onClose: () => void;
};

const CANDIDATES = [
  "video/mp4;codecs=avc1,mp4a.40.2",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

export function VideoRecorder({ onRecorded, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const stopStream = () => { streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; };

  const openCamera = useCallback(async () => {
    stopStream();
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Recording isn't supported in this browser. Upload a video instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 720 }, height: { ideal: 1280 } },
        audio: true,
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch {
      setError("We couldn't access your camera or microphone. Check your browser permissions.");
    }
  }, [facing]);

  useEffect(() => { void openCamera(); return stopStream; }, [openCamera]);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => {
      const ms = performance.now() - startedAt.current;
      setElapsed(ms);
      if (ms >= MAX_VIDEO_MS - 250) recRef.current?.stop(); // stop just under the 45 s limit
    }, 100);
    return () => clearInterval(t);
  }, [recording]);

  const start = () => {
    const stream = streamRef.current;
    if (!stream) return;
    const mimeType = CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m));
    const rec = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 2_500_000 });
    chunks.current = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
    rec.onstop = () => {
      const durationMs = Math.min(MAX_VIDEO_MS, Math.floor(performance.now() - startedAt.current));
      const type = (rec.mimeType || mimeType || "video/webm").split(";")[0];
      const s = stream.getVideoTracks()[0]?.getSettings();
      const file = new File(chunks.current, `recording.${type.includes("mp4") ? "mp4" : "webm"}`, { type });
      setRecording(false);
      stopStream();
      onRecorded(file, { durationMs, width: s?.width ?? 720, height: s?.height ?? 1280 });
    };
    recRef.current = rec;
    startedAt.current = performance.now();
    rec.start(1000);
    setRecording(true);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/90 p-4">
      <div className="w-full max-w-sm">
        <div className="relative overflow-hidden rounded-2xl bg-black">
          <video ref={videoRef} autoPlay muted playsInline className="aspect-[9/16] w-full object-cover" />
          <button onClick={() => { stopStream(); onClose(); }} aria-label="Close" className="absolute right-3 top-3 rounded-full bg-black/60 p-2"><X size={18} /></button>
          {recording && (
            <div className="absolute left-3 top-3 rounded-full bg-rose px-3 py-1 text-xs font-semibold">
              {(elapsed / 1000).toFixed(0)}s / {MAX_VIDEO_MS / 1000}s
            </div>
          )}
        </div>
        {error ? (
          <p className="mt-4 text-center text-sm text-rose">{error}</p>
        ) : (
          <div className="mt-4 flex items-center justify-center gap-6">
            <button disabled={recording} onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))}
                    aria-label="Flip camera" className="rounded-full border border-line p-3 disabled:opacity-30"><RefreshCw size={20} /></button>
            {recording ? (
              <button onClick={() => recRef.current?.stop()} aria-label="Stop recording" className="grid size-16 place-items-center rounded-full bg-rose"><Square size={22} fill="white" /></button>
            ) : (
              <button onClick={start} aria-label="Start recording" className="grid size-16 place-items-center rounded-full bg-accent-gradient"><Circle size={26} /></button>
            )}
            <span className="w-11" />
          </div>
        )}
        <p className="mt-3 text-center text-xs text-muted">Up to 45 seconds. Hold your phone upright for 9:16.</p>
      </div>
    </div>
  );
}
