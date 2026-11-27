"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IMAGE_ACCEPT, MAX_UPLOAD_BYTES, VIDEO_ACCEPT, recordingNameFor, uploadedShotPath } from "@/lib/draft-uploads";

/** An image as PNG, the one format the evidence pipeline reads (screenshots/*.png). */
async function toPng(file: File): Promise<Blob> {
  if (file.type === "image/png") return file;
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  if (!blob) throw new Error("convert");
  return blob;
}

/**
 * The draft owner's "Add files": images join the screenshots, a video becomes
 * the recording (replacing one already there). Bytes go straight to storage
 * through signed URLs, then the page refreshes to show them.
 */
export default function AttachmentUpload({ briefId }: { briefId: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(list: FileList | File[]) {
    const all = [...list];
    const images = all.filter((f) => IMAGE_ACCEPT.includes(f.type));
    const videos = all.filter((f) => recordingNameFor(f.type));
    if (!images.length && !videos.length) return setError("Images or videos only");
    // One recording per ticket: the last video picked wins.
    const video = videos.at(-1);
    if (video && video.size > MAX_UPLOAD_BYTES) return setError("Video over 50 MB");

    setBusy(true);
    setError(null);
    try {
      const now = Date.now();
      const files: Array<{ path: string; blob: Blob; type: string }> = [];
      for (const [i, img] of images.entries()) {
        const blob = await toPng(img);
        if (blob.size > MAX_UPLOAD_BYTES) throw new Error("Image over 50 MB");
        files.push({ path: uploadedShotPath(i + 1, now), blob, type: "image/png" });
      }
      const recName = video ? recordingNameFor(video.type)! : null;
      if (video && recName) files.push({ path: recName, blob: video, type: video.type });

      const res = await fetch(`/api/briefs/${briefId}/attachments`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paths: files.map((f) => f.path) }),
      });
      const { uploads } = (await res.json().catch(() => ({}))) as { uploads?: Record<string, string> };
      if (!res.ok || !uploads) throw new Error("Upload failed");

      await Promise.all(
        files.map(async (f) => {
          const put = await fetch(uploads[f.path], {
            method: "PUT",
            headers: { "Content-Type": f.type, "x-upsert": "true" },
            body: f.blob,
          });
          if (!put.ok) throw new Error("Upload failed");
        }),
      );

      if (recName) {
        const done = await fetch(`/api/briefs/${briefId}/attachments`, {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ recording: recName }),
        });
        if (!done.ok) throw new Error("Upload failed");
      }
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      setError(/over 50 MB/.test(msg) ? msg : "Upload failed");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <span className="ml-auto inline-flex items-center gap-2">
      {error && <span className="text-xs font-normal text-[#c62828]">{error}</span>}
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept={[...IMAGE_ACCEPT, ...VIDEO_ACCEPT].join(",")}
        onChange={(e) => e.target.files && upload(e.target.files)}
        data-testid="attachment-input"
      />
      <button type="button" className="btn h-[28px]" disabled={busy} onClick={() => input.current?.click()}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
        {busy ? "Uploading…" : "Add files"}
      </button>
    </span>
  );
}
