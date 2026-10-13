"use client";

import ReactGridLayout, {
  useContainerWidth,
  type Layout,
} from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import type { Widget } from "@/lib/analytics/config";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

const ROW_HEIGHT = 32;
const MARGIN: [number, number] = [16, 16];

/**
 * 12-column grid. In edit mode widgets can be dragged (by their grip) and
 * resized; otherwise the layout is static. Below 768 px widgets stack in a
 * single column in reading order. For printing, a static two-column grid
 * whose items never break across pages.
 */
export function DashboardGrid({
  widgets,
  editMode,
  printing = false,
  onLayoutChange,
  render,
}: {
  widgets: Widget[];
  editMode: boolean;
  printing?: boolean;
  onLayoutChange: (layout: Layout) => void;
  render: (widget: Widget) => ReactNode;
}) {
  // Measure first: rendering at the default width (1280) would flash a wide
  // layout and overflow small screens.
  const { width, containerRef, mounted } = useContainerWidth({
    measureBeforeMount: true,
  });
  const narrow = mounted && width < 768;

  if (printing) {
    const ordered = [...widgets].sort(
      (a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x,
    );
    return (
      <div ref={containerRef} className="grid grid-cols-2 gap-4">
        {ordered.map((w) => (
          <div
            key={w.id}
            className={cn(
              "fp-print-item",
              (w.kind === "heading" || w.layout.w >= 9) && "col-span-2",
            )}
            style={{
              height:
                w.kind === "heading"
                  ? undefined
                  : Math.min(
                      420,
                      Math.max(
                        200,
                        w.layout.h * (ROW_HEIGHT + MARGIN[1]) - MARGIN[1],
                      ),
                    ),
            }}
          >
            {render(w)}
          </div>
        ))}
      </div>
    );
  }

  if (narrow) {
    const ordered = [...widgets].sort(
      (a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x,
    );
    return (
      <div ref={containerRef} className="flex flex-col gap-4">
        {ordered.map((w) => (
          <div
            key={w.id}
            style={{
              minHeight:
                w.kind === "heading"
                  ? 48
                  : Math.max(
                      220,
                      w.layout.h * (ROW_HEIGHT + MARGIN[1]) - MARGIN[1],
                    ),
            }}
          >
            {render(w)}
          </div>
        ))}
      </div>
    );
  }

  const layout = widgets.map((w) => ({
    i: w.id,
    x: w.layout.x,
    y: w.layout.y,
    w: w.layout.w,
    h: w.layout.h,
    minW: w.kind === "heading" ? 12 : 3,
    minH: w.kind === "heading" ? 2 : 3,
    static: !editMode,
  }));

  return (
    <div ref={containerRef}>
      {mounted && (
        <ReactGridLayout
          layout={layout}
          width={width}
          gridConfig={{
            cols: 12,
            rowHeight: ROW_HEIGHT,
            margin: MARGIN,
            containerPadding: [0, 0],
          }}
          dragConfig={{ enabled: editMode, handle: ".widget-drag" }}
          resizeConfig={{ enabled: editMode }}
          onLayoutChange={onLayoutChange}
        >
          {widgets.map((w) => (
            <div key={w.id}>{render(w)}</div>
          ))}
        </ReactGridLayout>
      )}
    </div>
  );
}
