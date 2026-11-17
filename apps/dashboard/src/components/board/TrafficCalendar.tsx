import { calendarWeeks, countByDay, shadeOf, shadeThresholds, type DayCount } from "@runyard/core";
import gsap from "gsap";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useCalendar } from "../../lib/calendar.ts";
import { useTheme } from "../../lib/theme.ts";

/** The viewer's own day for a moment, as `YYYY-MM-DD`. */
function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Whether the page is dark right now: the viewer's choice, or the system's. */
function useDark(): boolean {
  const theme = useTheme();
  const system = useSyncExternalStore(
    (onChange) => {
      const m = window.matchMedia("(prefers-color-scheme: dark)");
      m.addEventListener("change", onChange);
      return () => m.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  return theme === "dark" || (theme === "system" && system);
}

// Empty, then four shades of signal yellow, on the board's black.
const PALETTE = {
  light: ["#1d1f24", "#4d4215", "#86700f", "#c9a114", "#ffcd1f"],
  dark: ["#20232a", "#55491a", "#8f7812", "#d1a817", "#ffd23a"],
};

const VS = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";
/*
 * One rounded square per day, drawn from a weeks × 7 data texture: red = shade (0–4), green = a
 * day with 5%+ failures (a small red corner), blue = today (an outline). `sweep` reveals the weeks
 * left to right; `hv` brightens the hovered day.
 */
const FS = `precision highp float;
uniform sampler2D d;uniform vec2 r;uniform float cols;uniform float pitch;uniform float dpr;uniform float sweep;uniform vec2 hv;
uniform vec3 c0;uniform vec3 c1;uniform vec3 c2;uniform vec3 c3;uniform vec3 c4;
float box(vec2 p,vec2 b,float rr){vec2 q=abs(p)-b+rr;return length(max(q,0.))+min(max(q.x,q.y),0.)-rr;}
void main(){
  vec2 px=vec2(gl_FragCoord.x,r.y-gl_FragCoord.y)/dpr;
  float col=floor(px.x/pitch), row=floor(px.y/pitch);
  if(col>=cols||row>6.){gl_FragColor=vec4(0.);return;}
  vec4 t=texture2D(d,vec2((col+.5)/cols,(row+.5)/7.));
  if(t.a<.5){gl_FragColor=vec4(0.);return;}
  vec2 inC=px-vec2(col,row)*pitch-pitch*.5;
  float gap=max(2.,pitch*.16);
  float hw=pitch*.5-gap*.5;
  float rv=clamp(sweep-col-row*.12,0.,1.); rv=1.-pow(1.-rv,3.);
  float hs=hw*(.55+.45*rv);
  float dd=box(inC,vec2(hs),max(1.5,pitch*.12));
  float aa=1./dpr;
  float inside=1.-smoothstep(-aa,aa,dd);
  float lv=floor(t.r*4.+.5);
  vec3 c=lv<.5?c0:lv<1.5?c1:lv<2.5?c2:lv<3.5?c3:c4;
  float hov=(1.-step(.5,abs(col-hv.x)))*(1.-step(.5,abs(row-hv.y)));
  c=mix(c,vec3(1.),hov*.35);
  float tri=step(.5,t.g)*step(hs*1.3,inC.x-inC.y);
  c=mix(c,vec3(.95,.38,.31),tri*inside);
  float ring=step(.5,t.b)*(1.-smoothstep(aa*.5,aa*1.6,abs(dd+1.)));
  vec3 o=mix(c*inside,vec3(.96,.95,.92),ring);
  float a=max(inside,ring)*rv;
  gl_FragColor=vec4(o*a,a);
}`;

const WEEKDAYS = ["", "Mon", "", "Wed", "", "Fri", ""];
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

/**
 * The Board's traffic: jobs per day for the last 26 weeks (13 on phones), like a contribution
 * graph, drawn with WebGL and revealed once with GSAP. Hovering or tapping a day reads it out.
 */
export function TrafficCalendar({ phone = false }: { phone?: boolean }) {
  // As many weeks as fit the panel, up to the 53 Runyard keeps; one request covers them all.
  const [fit, setFit] = useState({ weeks: phone ? 13 : 26, pitch: phone ? 22 : 24 });
  const { weeks, pitch } = fit;
  const { data } = useCalendar(53);
  const dark = useDark();
  const now = data?.now ?? Date.now();
  const today = new Date(now);
  const grid = useMemo(
    () =>
      calendarWeeks(
        { year: today.getFullYear(), month: today.getMonth() + 1, day: today.getDate() },
        weeks,
      ),
    // A new day re-lays the grid; the time within a day doesn't.
    [localDay(now), weeks],
  );
  const days = useMemo(() => countByDay(data?.hours ?? [], localDay), [data]);
  const cells = grid.flat().filter((k): k is string => k !== null);
  const counts = cells.map((k) => days.get(k)?.jobs ?? 0);
  const thresholds = shadeThresholds(counts);
  const total = counts.reduce((a, b) => a + b, 0);
  const failed = cells.reduce((a, k) => a + (days.get(k)?.failed ?? 0), 0);
  const todayKey = localDay(now);
  const before = data?.earliest != null && localDay(data.earliest) > (cells[0] ?? "");

  const body = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const draw = useRef<(hover?: [number, number]) => void>(() => {});
  const cols = grid.length;

  // The panel's width picks how many weeks show and how big their squares are, so the grid spans it.
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const measure = () => {
      // The weekday labels and the gap beside them take 38px.
      const room = el.clientWidth - 38;
      const ideal = phone ? 20 : 25;
      const weeks = Math.max(13, Math.min(phone ? 26 : 53, Math.floor(room / ideal)));
      const pitch = Math.max(12, Math.min(30, Math.floor(room / weeks)));
      setFit((f) => (f.weeks === weeks && f.pitch === pitch ? f : { weeks, pitch }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [phone]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !data) return;
    let gl: WebGLRenderingContext | null = null;
    try {
      gl = c.getContext("webgl", { antialias: false, premultipliedAlpha: true, alpha: true });
    } catch {
      gl = null;
    }
    if (!gl) return;
    const g = gl;
    const shader = (type: number, src: string) => {
      const s = g.createShader(type)!;
      g.shaderSource(s, src);
      g.compileShader(s);
      return g.getShaderParameter(s, g.COMPILE_STATUS) ? s : null;
    };
    const vs = shader(g.VERTEX_SHADER, VS);
    const fs = shader(g.FRAGMENT_SHADER, FS);
    if (!vs || !fs) return;
    const prog = g.createProgram()!;
    g.attachShader(prog, vs);
    g.attachShader(prog, fs);
    g.linkProgram(prog);
    g.useProgram(prog);
    const buf = g.createBuffer();
    g.bindBuffer(g.ARRAY_BUFFER, buf);
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), g.STATIC_DRAW);
    const loc = g.getAttribLocation(prog, "p");
    g.enableVertexAttribArray(loc);
    g.vertexAttribPointer(loc, 2, g.FLOAT, false, 0, 0);

    const texels = new Uint8Array(cols * 7 * 4);
    grid.forEach((week, col) =>
      week.forEach((key, row) => {
        if (!key) return;
        const d = days.get(key);
        const o = (row * cols + col) * 4;
        texels[o] = Math.round((shadeOf(d?.jobs ?? 0, thresholds) / 4) * 255);
        texels[o + 1] = d && d.jobs && d.failed / d.jobs >= 0.05 ? 255 : 0;
        texels[o + 2] = key === todayKey ? 255 : 0;
        texels[o + 3] = 255;
      }),
    );
    const tex = g.createTexture();
    g.bindTexture(g.TEXTURE_2D, tex);
    g.pixelStorei(g.UNPACK_ALIGNMENT, 1);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, cols, 7, 0, g.RGBA, g.UNSIGNED_BYTE, texels);
    for (const f of [g.TEXTURE_MIN_FILTER, g.TEXTURE_MAG_FILTER])
      g.texParameteri(g.TEXTURE_2D, f, g.NEAREST);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    const u = (n: string) => g.getUniformLocation(prog, n);
    const palette = (dark ? PALETTE.dark : PALETTE.light).map(hex);

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const state = { sweep: reduced ? cols + 4 : 0 };
    let hover: [number, number] = [-1, -1];
    const render = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(cols * pitch * dpr);
      const h = Math.round(7 * pitch * dpr);
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
      g.viewport(0, 0, w, h);
      g.clearColor(0, 0, 0, 0);
      g.clear(g.COLOR_BUFFER_BIT);
      g.uniform1i(u("d"), 0);
      g.uniform2f(u("r"), w, h);
      g.uniform1f(u("cols"), cols);
      g.uniform1f(u("pitch"), pitch);
      g.uniform1f(u("dpr"), dpr);
      g.uniform1f(u("sweep"), state.sweep);
      g.uniform2f(u("hv"), hover[0], hover[1]);
      palette.forEach((p, i) => g.uniform3f(u(`c${i}`), p[0]!, p[1]!, p[2]!));
      g.drawArrays(g.TRIANGLES, 0, 3);
    };
    draw.current = (h) => {
      hover = h ?? [-1, -1];
      render();
    };
    render();
    const tween = reduced
      ? null
      : gsap.to(state, {
          sweep: cols + 4,
          duration: 1.6,
          ease: "power1.inOut",
          delay: 0.2,
          onUpdate: render,
        });
    return () => {
      tween?.kill();
      draw.current = () => {};
      g.deleteTexture(tex);
      g.deleteBuffer(buf);
      g.deleteProgram(prog);
    };
    // Redrawn when the data, the size or the theme changes.
  }, [data, pitch, dark, grid]);

  // Releases the GPU context when the calendar leaves the page.
  useEffect(() => {
    const c = canvas.current;
    return () => c?.getContext("webgl")?.getExtension("WEBGL_lose_context")?.loseContext();
  }, []);

  const read = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const col = Math.floor(((e.clientX - rect.left) / rect.width) * cols);
    const row = Math.floor(((e.clientY - rect.top) / rect.height) * 7);
    const key = grid[col]?.[row];
    if (!key) return leave();
    const d: DayCount = days.get(key) ?? { jobs: 0, failed: 0, cancelled: 0 };
    const date = new Date(`${key}T12:00:00`).toLocaleDateString([], {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    setTip({
      x: Math.min(Math.max((col + 0.5) * pitch, 90), cols * pitch - 90),
      y: row * pitch,
      text: `${date} · ${d.jobs} ${d.jobs === 1 ? "job" : "jobs"}${d.failed ? `, ${d.failed} failed` : ""}`,
    });
    draw.current([col, row]);
  };
  const leave = () => {
    setTip(null);
    draw.current();
  };

  // Month names above the week where each month starts, skipping ones that would crowd.
  const months: { col: number; label: string }[] = [];
  let lastMonth = "";
  let lastCol = -9;
  grid.forEach((week, col) => {
    const first = week.find((k) => k) ?? "";
    const month = first.slice(0, 7);
    if (month && month !== lastMonth) {
      if (col - lastCol >= 3) {
        months.push({
          col,
          label: new Date(`${first}T12:00:00`).toLocaleDateString([], { month: "short" }),
        });
        lastCol = col;
      }
      lastMonth = month;
    }
  });

  return (
    <section
      aria-labelledby="traffic-title"
      className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-tt-board-edge bg-tt-board px-5 pt-4 pb-4 text-tt-flap"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2
          id="traffic-title"
          className="text-[13px] font-extrabold tracking-[.08em] text-tt-signal uppercase"
        >
          Traffic · last {weeks} weeks
        </h2>
        <span className="text-[12px] text-[#9aa0a9]">
          {!data
            ? "Loading…"
            : total
              ? `${total.toLocaleString()} ${total === 1 ? "job" : "jobs"} · ${((failed / total) * 100).toFixed(1)}% failed`
              : "No jobs yet"}
        </span>
      </header>
      <div ref={body} className="my-auto flex gap-2 pt-3">
        <div
          className="grid w-[30px] shrink-0 pt-[18px] text-[10.5px] text-[#8b9099]"
          style={{ gridTemplateRows: `repeat(7, ${pitch}px)` }}
          aria-hidden
        >
          {WEEKDAYS.map((d, i) => (
            <span key={i} className="flex items-center">
              {d}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="relative h-[18px] text-[10.5px] text-[#8b9099]" aria-hidden>
            {months.map((m) => (
              <span key={m.col} className="absolute top-0" style={{ left: m.col * pitch }}>
                {m.label}
              </span>
            ))}
          </div>
          <canvas
            ref={canvas}
            role="img"
            aria-label={`Jobs per day for the last ${weeks} weeks: ${total} in all, ${failed} failed.`}
            className="block touch-none"
            style={{ width: cols * pitch, height: 7 * pitch }}
            onPointerMove={read}
            onPointerDown={read}
            onPointerLeave={leave}
          />
          {tip && (
            <span
              className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md bg-tt-flap px-2 py-1 font-board text-[11.5px] font-bold whitespace-nowrap text-tt-on-signal shadow"
              style={{ left: tip.x, top: 18 + tip.y - 4 }}
            >
              {tip.text}
            </span>
          )}
        </div>
      </div>
      <footer className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-[#9aa0a9]">
        <span>
          {before
            ? `Runyard has kept this log since ${new Date(data!.earliest!).toLocaleDateString([], { month: "short", day: "numeric" })}.`
            : total
              ? "A red corner marks a day with 5% or more failed."
              : "Jobs appear here once runners take work."}
        </span>
        <span className="flex items-center gap-1" aria-hidden>
          Less
          {(dark ? PALETTE.dark : PALETTE.light).map((c) => (
            <i key={c} className="size-[11px] rounded-[2px]" style={{ background: c }} />
          ))}
          More
        </span>
      </footer>
    </section>
  );
}
