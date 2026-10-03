"use client";
import { useEffect, useRef, type ReactNode } from "react";

export default function ConfirmDialog({ title, onCancel, busy, children }: { title: string; onCancel: () => void; busy: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog className="confirm-dialog" ref={ref} aria-labelledby="confirm-title" onCancel={(event) => { event.preventDefault(); if (!busy) onCancel(); }}><h2 id="confirm-title">{title}</h2>{children}</dialog>;
}
