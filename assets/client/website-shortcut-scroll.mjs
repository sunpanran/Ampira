export function createWebsiteShortcutOverflow({ rail, list }) {
  let frame = 0;

  list.addEventListener("scroll", scheduleSync, { passive: true });
  list.addEventListener("keydown", handleKeydown);
  window.addEventListener("resize", scheduleSync, { passive: true });

  return { scheduleSync };

  function scheduleSync() {
    if (frame) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      const hasOverflow = !rail.hidden && list.scrollWidth > list.clientWidth + 1;
      const isEnd = !hasOverflow || list.scrollLeft + list.clientWidth >= list.scrollWidth - 1;
      rail.classList.toggle("has-scroll-overflow", hasOverflow);
      rail.classList.toggle("is-scroll-end", isEnd);
    });
  }

  function handleKeydown(event) {
    if (list.scrollWidth <= list.clientWidth + 1) return;
    const distance = Math.max(72, Math.round(list.clientWidth * .45));
    const targets = {
      ArrowLeft: list.scrollLeft - distance,
      ArrowRight: list.scrollLeft + distance,
      Home: 0,
      End: list.scrollWidth - list.clientWidth,
    };
    if (!Object.hasOwn(targets, event.key)) return;
    event.preventDefault();
    list.scrollTo({ left: targets[event.key], behavior: "smooth" });
  }
}

export function autoScrollDragContainer(container, event, axis) {
  const rect = container.getBoundingClientRect();
  const edge = 36;
  if (axis === "horizontal" && container.scrollWidth > container.clientWidth) {
    if (event.clientX <= rect.left + edge) container.scrollLeft -= 16;
    else if (event.clientX >= rect.right - edge) container.scrollLeft += 16;
    return;
  }
  if (axis === "vertical" && container.scrollHeight > container.clientHeight) {
    if (event.clientY <= rect.top + edge) container.scrollTop -= 16;
    else if (event.clientY >= rect.bottom - edge) container.scrollTop += 16;
  }
}
