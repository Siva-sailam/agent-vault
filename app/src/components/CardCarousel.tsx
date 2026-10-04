import { useRef, useState, type PointerEvent, type ReactNode } from 'react';

const PEEK_PX = 16;
const PEEK_SCALE_STEP = 0.045;
const DRAG_THRESHOLD_PX = 55;

/**
 * One horizontal stack of full-height cards — the phone's only navigation.
 * Circular: swiping/pressing right past the last card wraps to the first,
 * and back past the first wraps to the last. Real pointer-drag (mouse +
 * touch, via the Pointer Events API) plus arrow buttons and dots for
 * anyone not on a touchscreen.
 */
export function CardCarousel({ pages }: { pages: ReactNode[] }) {
  const n = pages.length;
  const [index, setIndex] = useState(0);
  const [dragX, setDragX] = useState(0);
  const dragging = useRef(false);
  const startX = useRef(0);

  const go = (next: number) => setIndex(((next % n) + n) % n);

  // Shortest signed distance around the circle, so the wraparound
  // neighbor peeks from the correct side instead of flying across.
  function circularOffset(i: number) {
    let offset = i - index;
    if (offset > n / 2) offset -= n;
    if (offset < -n / 2) offset += n;
    return offset;
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    // Presses on controls (buttons, links, inputs) are clicks, not swipes.
    if ((e.target as HTMLElement).closest('button, a, input, select, textarea, label')) return;
    dragging.current = true;
    startX.current = e.clientX;
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    const dx = e.clientX - startX.current;
    // Capture the pointer only once it is clearly a drag, so plain clicks
    // still reach the element that was pressed.
    if (Math.abs(dx) > 6 && !e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    setDragX(dx);
  }
  function endDrag() {
    if (!dragging.current) return;
    dragging.current = false;
    if (dragX <= -DRAG_THRESHOLD_PX) go(index + 1);
    else if (dragX >= DRAG_THRESHOLD_PX) go(index - 1);
    setDragX(0);
  }

  return (
    <div
      className="carousel"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div className="carousel-stack">
        {pages.map((page, i) => {
          const offset = circularOffset(i);
          if (Math.abs(offset) > 2) return null;
          const isActive = offset === 0;
          const translateX = isActive ? dragX : offset * PEEK_PX;
          const translateY = Math.abs(offset) * 10;
          const scale = 1 - Math.min(Math.abs(offset), 2) * PEEK_SCALE_STEP;
          return (
            <div
              key={i}
              className={`carousel-card${dragging.current && isActive ? ' dragging' : ''}`}
              style={{
                transform: `translate(${translateX}px, ${translateY}px) scale(${scale})`,
                zIndex: 10 - Math.abs(offset),
                opacity: Math.abs(offset) === 2 ? 0.6 : 1,
                pointerEvents: isActive ? 'auto' : 'none',
              }}
            >
              <div className="carousel-card-inner">{page}</div>
            </div>
          );
        })}
      </div>

      <div className="carousel-nav">
        <button className="carousel-arrow" onClick={() => go(index - 1)} aria-label="Previous">
          ‹
        </button>
        <div className="carousel-dots">
          {pages.map((_, i) => (
            <span key={i} className={`dot${i === index ? ' active' : ''}`} onClick={() => go(i)} />
          ))}
        </div>
        <button className="carousel-arrow" onClick={() => go(index + 1)} aria-label="Next">
          ›
        </button>
      </div>
    </div>
  );
}
