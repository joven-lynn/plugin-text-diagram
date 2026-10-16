/**
 * text-diagram lightbox
 * 前台点击文本绘图块弹出放大预览：滚轮/双指缩放、拖拽平移。
 * 无依赖，由 JSInjector 注入，仅在前台文章页加载。
 */
(function () {
  "use strict";

  var MIN_SCALE = 0.5;
  var MAX_SCALE = 8;
  var WHEEL_FACTOR = 1.15;
  var CLICK_THRESHOLD = 5; // 判定"点击遮罩"的最大位移（px）

  var overlay = null;
  var stage = null;
  var content = null;

  var aspect = 1; // 当前图形纵横比（w/h）
  var fitW = 0; // fit 基准尺寸（scale = 1 时的布局尺寸）
  var fitH = 0;
  var scale = 1;
  var tx = 0;
  var ty = 0;
  var rafId = 0;

  var pointers = new Map();
  var lastX = 0;
  var lastY = 0;
  var pinchDist = 0;
  var moved = false;
  var movedTotal = 0;

  var docOverflowPrev = null;
  var onKeydown = null;
  var onResize = null;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  // 缩放作用于布局尺寸（width/height）而非 transform: scale：
  // transform 缩放会按 fit 基准尺寸光栅化后位图拉伸，初始显示尺寸越小
  // （低分屏 / 手机）放大越模糊；布局缩放让 SVG 与矢量 img 始终按
  // 目标尺寸重绘，清晰度与初始尺寸和设备像素比无关
  function apply() {
    content.style.width = fitW * scale + "px";
    content.style.height = fitH * scale + "px";
    content.style.transform =
      "translate(calc(-50% + " + tx + "px), calc(-50% + " + ty + "px))";
  }

  // 合并同一帧内的连续缩放/拖拽，避免布局重排抖动
  function scheduleApply() {
    if (rafId) return;
    rafId = requestAnimationFrame(function () {
      rafId = 0;
      apply();
    });
  }

  // 以屏幕坐标 (px, py) 为锚点缩放到 nextScale，锚点下的内容保持不动
  function zoomAt(px, py, nextScale) {
    nextScale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
    if (nextScale === scale) return;
    var rect = stage.getBoundingClientRect();
    var cx = rect.left + rect.width / 2;
    var cy = rect.top + rect.height / 2;
    var contentX = (px - cx - tx) / scale;
    var contentY = (py - cy - ty) / scale;
    scale = nextScale;
    tx = px - cx - contentX * scale;
    ty = py - cy - contentY * scale;
    scheduleApply();
  }

  // 按视口与图形纵横比计算 fit 尺寸，并复位变换（fit = 1x）
  function fit() {
    // stage 尺寸异常时（如弹窗尚未完成布局）退回视口尺寸，避免算出 0×0
    var stageW = stage.clientWidth || window.innerWidth;
    var stageH = stage.clientHeight || window.innerHeight;
    var availW = stageW * 0.92;
    var availH = stageH * 0.86;
    var ratio = aspect > 0 ? aspect : 1;
    if (ratio >= availW / availH) {
      fitW = availW;
      fitH = availW / ratio;
    } else {
      fitH = availH;
      fitW = availH * ratio;
    }
    scale = 1;
    tx = 0;
    ty = 0;
    apply();
  }

  function svgAspect(svg) {
    var viewBox = svg.viewBox && svg.viewBox.baseVal;
    if (viewBox && viewBox.width > 0 && viewBox.height > 0) {
      return viewBox.width / viewBox.height;
    }
    var rect = svg.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return rect.width / rect.height;
    }
    return 1;
  }

  function open(sourceEl) {
    ensureDom();
    var isSvg = sourceEl.tagName.toLowerCase() === "svg";
    var clone = sourceEl.cloneNode(true);

    content.innerHTML = "";
    if (isSvg) {
      aspect = svgAspect(sourceEl);
    } else if (sourceEl.naturalWidth > 0 && sourceEl.naturalHeight > 0) {
      aspect = sourceEl.naturalWidth / sourceEl.naturalHeight;
    } else {
      // img 尚未加载完成（缓存失效等），加载完成后重新 fit
      aspect = 0;
      clone.addEventListener(
        "load",
        function () {
          if (!overlay.classList.contains("td-lb-open")) return;
          aspect =
            clone.naturalWidth > 0 && clone.naturalHeight > 0
              ? clone.naturalWidth / clone.naturalHeight
              : 1;
          fit();
        },
        { once: true }
      );
    }
    content.appendChild(clone);

    // 必须先显示弹窗再 fit：display:none 阶段 stage 尺寸为 0，fit 会算出 0×0
    docOverflowPrev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    overlay.classList.add("td-lb-open");
    fit();

    onKeydown = function (event) {
      if (event.key === "Escape") close();
    };
    onResize = function () {
      fit();
    };
    document.addEventListener("keydown", onKeydown);
    window.addEventListener("resize", onResize);
  }

  function close() {
    if (!overlay || !overlay.classList.contains("td-lb-open")) return;
    overlay.classList.remove("td-lb-open");
    document.documentElement.style.overflow = docOverflowPrev;
    document.removeEventListener("keydown", onKeydown);
    window.removeEventListener("resize", onResize);
    onKeydown = null;
    onResize = null;
    pointers.clear();
    pinchDist = 0;
    moved = false;
    window.setTimeout(function () {
      if (!overlay.classList.contains("td-lb-open")) content.innerHTML = "";
    }, 0);
  }

  function ensureDom() {
    if (overlay) return;

    overlay = document.createElement("div");
    overlay.className = "td-lb-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "文本绘图放大预览");

    stage = document.createElement("div");
    stage.className = "td-lb-stage";

    content = document.createElement("div");
    content.className = "td-lb-content";

    stage.appendChild(content);

    var closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "td-lb-btn td-lb-close";
    closeButton.setAttribute("aria-label", "关闭");
    closeButton.textContent = "×";
    closeButton.addEventListener("click", close);

    var toolbar = document.createElement("div");
    toolbar.className = "td-lb-toolbar";

    var resetButton = document.createElement("button");
    resetButton.type = "button";
    resetButton.className = "td-lb-btn td-lb-reset";
    resetButton.textContent = "重置";
    resetButton.addEventListener("click", function () {
      fit();
    });

    var toolbarClose = document.createElement("button");
    toolbarClose.type = "button";
    toolbarClose.className = "td-lb-btn td-lb-toolbar-close";
    toolbarClose.textContent = "关闭";
    toolbarClose.addEventListener("click", close);

    toolbar.appendChild(resetButton);
    toolbar.appendChild(toolbarClose);

    overlay.appendChild(stage);
    overlay.appendChild(closeButton);
    overlay.appendChild(toolbar);
    document.body.appendChild(overlay);

    stage.addEventListener("pointerdown", onPointerDown);
    stage.addEventListener("pointermove", onPointerMove);
    stage.addEventListener("pointerup", onPointerUp);
    stage.addEventListener("pointercancel", onPointerUp);
    stage.addEventListener("wheel", onWheel, { passive: false });
    stage.addEventListener("click", onStageClick);
    stage.addEventListener("dblclick", function (event) {
      event.preventDefault();
      fit();
    });
  }

  function onPointerDown(event) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (!overlay.classList.contains("td-lb-open")) return;
    stage.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 1) {
      lastX = event.clientX;
      lastY = event.clientY;
      moved = false;
      movedTotal = 0;
    } else if (pointers.size === 2) {
      updatePinch();
    }
  }

  function onPointerMove(event) {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 1) {
      var dx = event.clientX - lastX;
      var dy = event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
      movedTotal += Math.abs(dx) + Math.abs(dy);
      if (movedTotal > CLICK_THRESHOLD) moved = true;
      tx += dx;
      ty += dy;
      scheduleApply();
    } else if (pointers.size >= 2) {
      var points = Array.from(pointers.values());
      var dist = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      var midX = (points[0].x + points[1].x) / 2;
      var midY = (points[0].y + points[1].y) / 2;
      if (pinchDist > 0 && dist > 0) {
        zoomAt(midX, midY, scale * (dist / pinchDist));
      }
      pinchDist = dist;
      moved = true;
    }
  }

  function onPointerUp(event) {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinchDist = 0;
    if (pointers.size === 1) {
      // 从双指回到单指时重置拖动基准，避免跳变
      var remaining = Array.from(pointers.values())[0];
      lastX = remaining.x;
      lastY = remaining.y;
    }
  }

  function updatePinch() {
    var points = Array.from(pointers.values());
    if (points.length < 2) return;
    pinchDist = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
  }

  function onWheel(event) {
    event.preventDefault();
    var factor = event.deltaY < 0 ? WHEEL_FACTOR : 1 / WHEEL_FACTOR;
    zoomAt(event.clientX, event.clientY, scale * factor);
  }

  function onStageClick(event) {
    if (moved) {
      moved = false;
      return;
    }
    // 仅点击遮罩空白处关闭，点击图形本身不关闭
    if (event.target === stage) close();
  }

  // 事件委托：点击任意 text-diagram 绘图块即打开预览，不依赖 mermaid 渲染时序
  document.addEventListener("click", function (event) {
    if (overlay && overlay.classList.contains("td-lb-open")) return;
    var block = event.target.closest("text-diagram[data-type]");
    if (!block) return;
    var svg = block.querySelector("svg");
    var img = block.querySelector("img");
    var source = svg || img;
    if (!source) return;
    open(source);
  });
})();
