"use client";

import ReactGridLayout, {
  useContainerWidth,
  type Layout,
} from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import type { Widget } from "@/lib/analytics/config";
import type { ReactNode } from "react";

const ROW_HEIGHT = 32;
const MARGIN: [number, number] = [16, 16];

/**
 * 12-column grid. In edit mode widgets can be dragged (by their grip) and
 * resized; otherwise the layout is static. Below 768 px widgets stack in a
 * single column in reading order.
 */
export function DashboardGrid({
  widgets,
  editMode,
  onLayoutChange,
  render,
}: {
  widgets: Widget[];
  editMode: boolean;
  onLayoutChange: (layout: Layout) => void;
  render: (widget: Widget) => ReactNode;
}) {
  const { width, containerRef, mounted } = useContainerWidth();
  const narrow = mounted && width < 768;

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
