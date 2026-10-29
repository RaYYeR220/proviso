"use client";

import { useEffect, useRef } from "react";

// 5x7 glyphs for the characters an address can contain.
const F: Record<string, string[]> = {
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  a: ["00000", "00000", "01110", "00001", "01111", "10001", "01111"],
  b: ["10000", "10000", "10110", "11001", "10001", "10001", "11110"],
  c: ["00000", "00000", "01110", "10000", "10000", "10001", "01110"],
  d: ["00001", "00001", "01101", "10011", "10001", "10001", "01111"],
  e: ["00000", "00000", "01110", "10001", "11111", "10000", "01110"],
  f: ["00110", "01001", "01000", "11100", "01000", "01000", "01000"],
  x: ["00000", "00000", "10001", "01010", "00100", "01010", "10001"],
};
const HEX = "0123456789abcdef";

/** An address drawn as a dot-matrix display; characters that change scramble before they settle. */
export function DotAddress({ address, label }: { address: string; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const state = useRef({ cur: "0x" + "0".repeat(40), tgt: "0x" + "0".repeat(40), flip: [] as number[] });

  useEffect(() => {
    const s = state.current;
    s.tgt = address.toLowerCase();
    const now = performance.now();
    s.flip = [...s.tgt].map((c, i) => (c !== s.cur[i] ? now + 120 + Math.random() * 900 : 0));
  }, [address]);

  useEffect(() => {
    const cv = ref.current!;
    const cx = cv.getContext("2d")!;
    let raf = 0;
    let size = 0;
    let perRow = 14;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

    const layout = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const w = cv.parentElement!.clientWidth;
      perRow = w < 640 ? 7 : 14;
      const rows = Math.ceil(42 / perRow);
      size = Math.floor(w / (perRow * 6 - 1));
      const h = rows * 7 * size + (rows - 1) * 2 * size;
      cv.style.width = `${w}px`;
      cv.style.height = `${h}px`;
      cv.width = w * dpr;
      cv.height = h * dpr;
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (now: number) => {
      const s = state.current;
      cx.clearRect(0, 0, cv.width, cv.height);
      const r = size * 0.36;
      for (let i = 0; i < 42; i++) {
        const ox = (i % perRow) * 6 * size;
        const oy = Math.floor(i / perRow) * 9 * size;
        let ch = s.cur[i] ?? "0";
        let hot = false;
        if (s.flip[i]) {
          if (now < s.flip[i]!) {
            ch = HEX[Math.floor(Math.random() * 16)]!;
            hot = true;
          } else s.flip[i] = 0;
        }
        if (!s.flip[i] && !hot) ch = s.tgt[i] ?? ch;
        const g = F[ch] ?? F["0"]!;
        for (let y = 0; y < 7; y++)
          for (let x = 0; x < 5; x++) {
            const on = g[y]![x] === "1";
            cx.beginPath();
            if (on) {
              cx.fillStyle = hot ? "#ffb547" : i < 2 ? "#a3a19c" : "#edebe6";
              cx.arc(ox + x * size + size / 2, oy + y * size + size / 2, r, 0, 7);
            } else {
              cx.fillStyle = "rgba(237,235,230,.07)";
              cx.arc(ox + x * size + size / 2, oy + y * size + size / 2, size * 0.11, 0, 7);
            }
            cx.fill();
          }
      }
      if (s.flip.every((f) => !f)) s.cur = s.tgt;
      if (!reduce) raf = requestAnimationFrame(draw);
    };

    layout();
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(layout);
    ro.observe(cv.parentElement!);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <div style={{ width: "100%" }}>
      <canvas ref={ref} role="img" aria-label={`${label}: ${address}`} style={{ display: "block" }} />
    </div>
  );
}
