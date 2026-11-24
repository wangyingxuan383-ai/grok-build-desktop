import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  Columns2,
  Maximize2,
  Monitor,
  Moon,
  RotateCw,
  SlidersHorizontal,
  Smartphone,
  Sun,
  Tablet,
} from "lucide-react";
import { DARK_COLORS, LIGHT_COLORS } from "../theme";
import "../styles/t3-panels.css";

export type ViewportPresetId = "fill" | "mobile" | "foldable" | "tablet" | "freeform";
export type ViewportOrientation = "portrait" | "landscape";
export type ViewportAppearance = "system" | "light" | "dark";

export interface ViewportState {
  preset: ViewportPresetId;
  orientation: ViewportOrientation;
  appearance: ViewportAppearance;
  customWidth: number;
  customHeight: number;
}

export interface ViewportPresetSpec {
  id: Exclude<ViewportPresetId, "fill" | "freeform">;
  label: string;
  width: number;
  height: number;
}

export const DEVICE_VIEWPORT_PRESETS: readonly ViewportPresetSpec[] = [
  { id: "mobile", label: "手机", width: 390, height: 844 },
  { id: "foldable", label: "折叠屏", width: 673, height: 841 },
  { id: "tablet", label: "平板", width: 820, height: 1180 },
] as const;

const MIN_FREEFORM_WIDTH = 240;
const MAX_FREEFORM_WIDTH = 2560;
const MIN_FREEFORM_HEIGHT = 240;
const MAX_FREEFORM_HEIGHT = 2560;

export const DEFAULT_VIEWPORT_STATE: ViewportState = {
  preset: "fill",
  orientation: "portrait",
  appearance: "system",
  customWidth: 1024,
  customHeight: 720,
};

function clampDim(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function parseStoredViewportState(raw: string | null): ViewportState {
  if (!raw) return DEFAULT_VIEWPORT_STATE;
  try {
    const parsed = JSON.parse(raw) as Partial<ViewportState>;
    const preset: ViewportPresetId =
      parsed.preset === "mobile" ||
      parsed.preset === "foldable" ||
      parsed.preset === "tablet" ||
      parsed.preset === "freeform" ||
      parsed.preset === "fill"
        ? parsed.preset
        : "fill";
    const orientation: ViewportOrientation = parsed.orientation === "landscape" ? "landscape" : "portrait";
    const appearance: ViewportAppearance =
      parsed.appearance === "light" || parsed.appearance === "dark" ? parsed.appearance : "system";
    return {
      preset,
      orientation,
      appearance,
      customWidth: clampDim(Number(parsed.customWidth), MIN_FREEFORM_WIDTH, MAX_FREEFORM_WIDTH, 1024),
      customHeight: clampDim(Number(parsed.customHeight), MIN_FREEFORM_HEIGHT, MAX_FREEFORM_HEIGHT, 720),
    };
  } catch {
    return DEFAULT_VIEWPORT_STATE;
  }
}

export function useViewportPresetState(storageKey?: string): [ViewportState, (updater: ViewportState | ((prev: ViewportState) => ViewportState)) => void] {
  const [state, setState] = useState<ViewportState>(() => {
    if (!storageKey) return DEFAULT_VIEWPORT_STATE;
    try {
      return parseStoredViewportState(localStorage.getItem(storageKey));
    } catch {
      return DEFAULT_VIEWPORT_STATE;
    }
  });

  const update = useCallback(
    (updater: ViewportState | ((prev: ViewportState) => ViewportState)) => {
      setState((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        if (storageKey) {
          try {
            localStorage.setItem(storageKey, JSON.stringify(next));
          } catch {
            // ignore
          }
        }
        return next;
      });
    },
    [storageKey],
  );

  return [state, update];
}

export function useResolvedViewportAppearance(appearance: ViewportAppearance): "light" | "dark" {
  const readHost = (): "light" | "dark" =>
    typeof document !== "undefined" && document.documentElement.dataset.themeResolved === "light"
      ? "light"
      : "dark";

  const [hostAppearance, setHostAppearance] = useState<"light" | "dark">(readHost);

  useEffect(() => {
    const sync = (): void => setHostAppearance(readHost());
    document.documentElement.addEventListener("grok-theme-change", sync);
    return () => document.documentElement.removeEventListener("grok-theme-change", sync);
  }, []);

  return appearance === "system" ? hostAppearance : appearance;
}

export function resolveViewportDimensions(state: ViewportState): { width: number; height: number } | null {
  if (state.preset === "fill") return null;
  if (state.preset === "freeform") {
    return { width: state.customWidth, height: state.customHeight };
  }
  const spec = DEVICE_VIEWPORT_PRESETS.find((item) => item.id === state.preset) ?? DEVICE_VIEWPORT_PRESETS[0]!;
  return state.orientation === "landscape"
    ? { width: spec.height, height: spec.width }
    : { width: spec.width, height: spec.height };
}

export interface ViewportPresetBarProps {
  state: ViewportState;
  onChange(updater: ViewportState | ((prev: ViewportState) => ViewportState)): void;
  compact?: boolean;
}

export function ViewportPresetBar({
  state,
  onChange,
  compact = false,
}: ViewportPresetBarProps): React.JSX.Element {
  const dims = resolveViewportDimensions(state);

  const selectPreset = (preset: ViewportPresetId): void => {
    onChange((prev) => {
      if (preset === "freeform" && prev.preset !== "freeform" && prev.preset !== "fill") {
        const currentDims = resolveViewportDimensions(prev);
        if (currentDims) {
          return {
            ...prev,
            preset,
            orientation: "portrait",
            customWidth: currentDims.width,
            customHeight: currentDims.height,
          };
        }
      }
      return { ...prev, preset };
    });
  };

  const flipOrientation = (): void => {
    onChange((prev) => {
      if (prev.preset === "fill") return prev;
      if (prev.preset === "freeform") {
        return {
          ...prev,
          orientation: prev.orientation === "portrait" ? "landscape" : "portrait",
          customWidth: prev.customHeight,
          customHeight: prev.customWidth,
        };
      }
      return {
        ...prev,
        orientation: prev.orientation === "portrait" ? "landscape" : "portrait",
      };
    });
  };

  return (
    <div className={`viewport-preset-bar${compact ? " is-compact" : ""}`} role="toolbar" aria-label="视口尺寸与外观模拟">
      <div className="viewport-preset-group" role="group" aria-label="设备尺寸预设">
        <button
          type="button"
          className={state.preset === "fill" ? "active" : ""}
          aria-pressed={state.preset === "fill"}
          title="自适应铺满容器"
          onClick={() => selectPreset("fill")}
        >
          <Maximize2 size={12} />
          <span>充满</span>
        </button>
        <button
          type="button"
          className={state.preset === "mobile" ? "active" : ""}
          aria-pressed={state.preset === "mobile"}
          title="手机视口 (390 × 844)"
          onClick={() => selectPreset("mobile")}
        >
          <Smartphone size={12} />
          <span>手机</span>
        </button>
        <button
          type="button"
          className={state.preset === "foldable" ? "active" : ""}
          aria-pressed={state.preset === "foldable"}
          title="折叠屏展开视口 (673 × 841)"
          onClick={() => selectPreset("foldable")}
        >
          <Columns2 size={12} />
          <span>折叠屏</span>
        </button>
        <button
          type="button"
          className={state.preset === "tablet" ? "active" : ""}
          aria-pressed={state.preset === "tablet"}
          title="平板视口 (820 × 1180)"
          onClick={() => selectPreset("tablet")}
        >
          <Tablet size={12} />
          <span>平板</span>
        </button>
        <button
          type="button"
          className={state.preset === "freeform" ? "active" : ""}
          aria-pressed={state.preset === "freeform"}
          title="自由尺寸（支持输入宽高或拖拽边缘调整）"
          onClick={() => selectPreset("freeform")}
        >
          <SlidersHorizontal size={12} />
          <span>自由</span>
        </button>
      </div>

      {state.preset !== "fill" && (
        <div className="viewport-dimensions-controls">
          {state.preset === "freeform" ? (
            <div className="viewport-freeform-inputs" aria-label="自由视口宽高">
              <input
                type="number"
                aria-label="视口宽度 (px)"
                min={MIN_FREEFORM_WIDTH}
                max={MAX_FREEFORM_WIDTH}
                value={state.customWidth}
                onChange={(e) =>
                  onChange((prev) => ({
                    ...prev,
                    customWidth: clampDim(Number(e.target.value), MIN_FREEFORM_WIDTH, MAX_FREEFORM_WIDTH, prev.customWidth),
                  }))
                }
              />
              <span>×</span>
              <input
                type="number"
                aria-label="视口高度 (px)"
                min={MIN_FREEFORM_HEIGHT}
                max={MAX_FREEFORM_HEIGHT}
                value={state.customHeight}
                onChange={(e) =>
                  onChange((prev) => ({
                    ...prev,
                    customHeight: clampDim(Number(e.target.value), MIN_FREEFORM_HEIGHT, MAX_FREEFORM_HEIGHT, prev.customHeight),
                  }))
                }
              />
              <small>px</small>
            </div>
          ) : (
            dims && (
              <span className="viewport-dim-readout" title="当前逻辑像素尺寸">
                {dims.width} × {dims.height}
              </span>
            )
          )}

          <button
            type="button"
            className="viewport-flip-btn"
            onClick={flipOrientation}
            title={`切换横竖屏（当前：${state.orientation === "portrait" ? "竖屏" : "横屏"}）`}
            aria-label="切换横竖屏方向"
          >
            <RotateCw size={12} />
            <span>{state.orientation === "portrait" ? "竖屏" : "横屏"}</span>
          </button>
        </div>
      )}

      <div className="viewport-appearance-group" role="group" aria-label="独立外观模拟">
        <button
          type="button"
          className={state.appearance === "system" ? "active" : ""}
          aria-pressed={state.appearance === "system"}
          title="跟随应用当前外观"
          onClick={() => onChange((prev) => ({ ...prev, appearance: "system" }))}
        >
          <Monitor size={12} />
          {!compact && <span>跟随</span>}
        </button>
        <button
          type="button"
          className={state.appearance === "light" ? "active" : ""}
          aria-pressed={state.appearance === "light"}
          title="独立模拟浅色外观 (Light)"
          onClick={() => onChange((prev) => ({ ...prev, appearance: "light" }))}
        >
          <Sun size={12} />
          {!compact && <span>浅色</span>}
        </button>
        <button
          type="button"
          className={state.appearance === "dark" ? "active" : ""}
          aria-pressed={state.appearance === "dark"}
          title="独立模拟深色外观 (Dark)"
          onClick={() => onChange((prev) => ({ ...prev, appearance: "dark" }))}
        >
          <Moon size={12} />
          {!compact && <span>深色</span>}
        </button>
      </div>
    </div>
  );
}

export interface ViewportFrameProps {
  state: ViewportState;
  onChange?(updater: ViewportState | ((prev: ViewportState) => ViewportState)): void;
  className?: string;
  children: ReactNode;
}

export function ViewportFrame({
  state,
  onChange,
  className = "",
  children,
}: ViewportFrameProps): React.JSX.Element {
  const resolvedAppearance = useResolvedViewportAppearance(state.appearance);
  const dims = resolveViewportDimensions(state);
  const isFill = dims === null;

  const frameStyle = useMemo<CSSProperties>(() => {
    const palette = resolvedAppearance === "light" ? LIGHT_COLORS : DARK_COLORS;
    const base: Record<string, string | number> = {
      colorScheme: resolvedAppearance,
    };
    if (!isFill && dims) {
      base.width = `${dims.width}px`;
      base.height = `${dims.height}px`;
    }
    if (state.appearance !== "system") {
      base["--color-window"] = palette.background;
      base["--color-frame"] = palette.surface;
      base["--color-card"] = palette.surface;
      base["--color-fg"] = palette.text;
      base["--color-fg-subtle"] = palette.muted;
      base["--color-border"] = palette.border;
      base["--color-accent"] = palette.accent;
      base["--bg"] = palette.background;
      base["--main"] = palette.surface;
      base["--panel"] = palette.surface;
      base["--text"] = palette.text;
      base["--text-secondary"] = palette.muted;
      base["--muted"] = palette.muted;
      base["--border"] = palette.border;
    }
    return base as CSSProperties;
  }, [dims, isFill, resolvedAppearance, state.appearance]);

  const dragCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
      dragCleanupRef.current = null;
    };
  }, []);

  const startFreeformDrag = (
    axis: "x" | "y" | "both",
    event: React.PointerEvent<HTMLDivElement>,
  ): void => {
    if (!onChange || !dims) return;
    event.preventDefault();
    event.stopPropagation();
    dragCleanupRef.current?.();
    const startX = event.clientX;
    const startY = event.clientY;
    const startW = dims.width;
    const startH = dims.height;

    const onMove = (moveEvent: PointerEvent): void => {
      const nextW =
        axis === "y"
          ? startW
          : clampDim(startW + (moveEvent.clientX - startX) * 2, MIN_FREEFORM_WIDTH, MAX_FREEFORM_WIDTH, startW);
      const nextH =
        axis === "x"
          ? startH
          : clampDim(startH + (moveEvent.clientY - startY), MIN_FREEFORM_HEIGHT, MAX_FREEFORM_HEIGHT, startH);
      onChange((prev) => ({
        ...prev,
        preset: "freeform",
        orientation: "portrait",
        customWidth: nextW,
        customHeight: nextH,
      }));
    };

    const cleanup = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (dragCleanupRef.current === cleanup) dragCleanupRef.current = null;
    };

    const onUp = (): void => {
      cleanup();
    };

    dragCleanupRef.current = cleanup;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      className={`viewport-stage ${isFill ? "is-fill" : "is-framed"} ${className}`.trim()}
      data-simulated-appearance={resolvedAppearance}
    >
      <div
        className={`viewport-device-frame appearance-${resolvedAppearance}${isFill ? " fill-frame" : ""}`}
        style={frameStyle}
      >
        <div className="viewport-device-content">{children}</div>

        {!isFill && onChange && (
          <>
            <div
              className="viewport-resize-handle handle-right"
              role="separator"
              aria-label="拖拽调整视口宽度"
              onPointerDown={(e) => startFreeformDrag("x", e)}
            />
            <div
              className="viewport-resize-handle handle-bottom"
              role="separator"
              aria-label="拖拽调整视口高度"
              onPointerDown={(e) => startFreeformDrag("y", e)}
            />
            <div
              className="viewport-resize-handle handle-corner"
              role="separator"
              aria-label="拖拽自由调整视口宽高"
              onPointerDown={(e) => startFreeformDrag("both", e)}
            />
          </>
        )}
      </div>
    </div>
  );
}
