/*
 * 内置最小播放器（`<script>` 里的 IIFE，无任何外部依赖）。
 *
 * 参考（只读）：ref/OpenMAIC/lib/standalone-player/App.tsx:1-422、
 *   lib/standalone-player/navigation.ts、lib/standalone-player/scenes/*、
 *   lib/standalone-player/read-data.ts
 *
 * 上游的播放器是一个 React 产物（`public/vendor/standalone-player/player.min.js`），
 * 由页面包编译与提供 —— 那是另一条产线。导出层如果只认那一个产物，`html()` 在没有
 * 它的环境里就只能产出"打不开的文档"，这违反"必须是可被 srcdoc 渲染的完整文档"。
 * 所以这里放一份等价的最小子集：幻灯片（文本/形状/图片/图表/表格/公式/视频）、
 * 互动页 iframe、测验作答、PBL 简报、上一页/下一页与键盘导航。
 *
 * 它读的数据结构与上游完全一致（`#openmaic-classroom` 里的 ClassroomManifest、
 * `#openmaic-player-config` 里的配置、`#openmaic-media` 里的播放媒体表），因此
 * 页面包换上真正的播放器产物时，这个文件整个被替换即可，导出层无需改动。
 */
(function () {
  var manifestEl = document.getElementById('openmaic-classroom');
  if (!manifestEl) return;
  var manifest;
  try {
    manifest = JSON.parse(manifestEl.textContent || '{}');
  } catch (error) {
    return;
  }
  var configEl = document.getElementById('openmaic-player-config');
  var config = { strings: {} };
  try {
    config = configEl ? JSON.parse(configEl.textContent || '{}') : config;
  } catch (error) {
    /* 配置坏了就用空文案 */
  }
  var strings = config.strings || {};
  var scenes = manifest.scenes || [];
  var root = document.getElementById('openmaic-player');
  if (!root) return;

  var mediaTable = {};
  var mediaEl = document.getElementById('openmaic-media');
  if (mediaEl) {
    try {
      mediaTable = JSON.parse(mediaEl.textContent || '{}');
    } catch (error) {
      mediaTable = {};
    }
  }
  var blobCache = {};

  function mediaUrl(key) {
    if (!key) return '';
    var entry = mediaTable[key];
    if (!entry) return '';
    if (entry.src) return entry.src;
    if (!entry.embedded) return '';
    if (blobCache[key]) return blobCache[key];
    var block = document.getElementById(entry.embedded);
    if (!block) return '';
    try {
      var binary = atob((block.textContent || '').replace(/\s+/g, ''));
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      var url = URL.createObjectURL(new Blob([bytes], { type: entry.mimeType || 'application/octet-stream' }));
      blobCache[key] = url;
      return url;
    } catch (error) {
      return '';
    }
  }

  function el(tag, className) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  function text(value) {
    return document.createTextNode(value == null ? '' : String(value));
  }

  // ── 幻灯片 ────────────────────────────────────────────────────────────────
  function renderElement(element) {
    var node = null;
    if (element.type === 'text') {
      node = el('div', 'omc-el omc-text');
      node.innerHTML = element.content || '';
      node.style.fontFamily = element.defaultFontName || 'inherit';
      if (element.defaultColor) node.style.color = element.defaultColor;
      if (element.fill) node.style.background = element.fill;
    } else if (element.type === 'image') {
      node = el('div', 'omc-el');
      var img = el('img');
      img.src = element.src || '';
      img.alt = '';
      if (element.clip && element.clip.shape === 'ellipse') img.style.borderRadius = '50%';
      node.appendChild(img);
    } else if (element.type === 'shape') {
      node = el('div', 'omc-el');
      node.innerHTML = shapeSvg(element);
    } else if (element.type === 'line') {
      node = el('div', 'omc-el');
      node.innerHTML = lineSvg(element);
    } else if (element.type === 'chart') {
      node = el('div', 'omc-el');
      node.innerHTML = chartSvg(element);
    } else if (element.type === 'table') {
      node = el('div', 'omc-el omc-text');
      node.innerHTML = tableHtml(element);
    } else if (element.type === 'latex') {
      node = el('div', 'omc-el omc-text');
      if (element.html) node.innerHTML = element.html;
      else node.appendChild(text(element.latex || ''));
      node.style.display = 'flex';
      node.style.alignItems = 'center';
      node.style.justifyContent = 'center';
    } else if (element.type === 'video') {
      node = el('div', 'omc-el');
      var video = el('video', 'omc-media');
      video.controls = true;
      video.playsInline = true;
      var src = element.mediaRef ? mediaUrl(element.mediaRef) : element.src || '';
      if (src) video.src = src;
      if (element.poster) video.poster = element.poster;
      node.appendChild(video);
    } else {
      return null;
    }
    node.style.left = element.left + 'px';
    node.style.top = element.top + 'px';
    node.style.width = element.width + 'px';
    node.style.height = element.height + 'px';
    if (element.rotate) node.style.transform = 'rotate(' + element.rotate + 'deg)';
    if (element.opacity != null) node.style.opacity = String(element.opacity);
    return node;
  }

  function escapeAttr(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function shapeSvg(element) {
    var viewBox = element.viewBox || [element.width, element.height];
    var fill = element.fill || 'none';
    var stroke = element.outline && element.outline.color ? element.outline.color : 'none';
    var strokeWidth = element.outline && element.outline.width ? element.outline.width : 0;
    var svg =
      '<svg class="omc-svg" viewBox="0 0 ' + viewBox[0] + ' ' + viewBox[1] + '" preserveAspectRatio="none">' +
      '<path d="' + escapeAttr(element.path) + '" fill="' + escapeAttr(fill) + '" stroke="' + escapeAttr(stroke) +
      '" stroke-width="' + strokeWidth + '"/></svg>';
    return svg;
  }

  function lineSvg(element) {
    var start = element.start || [0, 0];
    var end = element.end || [100, 100];
    var d = 'M' + start[0] + ' ' + start[1] + ' L' + end[0] + ' ' + end[1];
    if (element.broken) d = 'M' + start.join(' ') + ' L' + element.broken.join(' ') + ' L' + end.join(' ');
    else if (element.curve) d = 'M' + start.join(' ') + ' Q' + element.curve.join(' ') + ' ' + end.join(' ');
    else if (element.cubic) {
      d = 'M' + start.join(' ') + ' C' + element.cubic[0].join(' ') + ' ' + element.cubic[1].join(' ') + ' ' + end.join(' ');
    }
    var color = element.color || '#000';
    var width = element.width || 2;
    return (
      '<svg class="omc-svg" viewBox="0 0 ' + element.width + ' ' + element.height +
      '" preserveAspectRatio="none"><path d="' + escapeAttr(d) + '" fill="none" stroke="' +
      escapeAttr(color) + '" stroke-width="' + width + '" vector-effect="non-scaling-stroke"/></svg>'
    );
  }

  function chartSvg(element) {
    var data = element.data || { labels: [], series: [] };
    var series = data.series || [];
    var labels = data.labels || [];
    var colors = element.themeColors || ['#2563eb'];
    var width = element.width || 360;
    var height = element.height || 200;
    var pad = 28;
    var max = 1;
    series.forEach(function (values) {
      values.forEach(function (value) {
        if (value > max) max = value;
      });
    });
    var parts = ['<svg class="omc-svg" viewBox="0 0 ' + width + ' ' + height + '">'];
    if (element.chartType === 'pie' || element.chartType === 'ring') {
      var total = 0;
      (series[0] || []).forEach(function (value) {
        total += Math.abs(value);
      });
      var angle = -Math.PI / 2;
      var cx = width / 2;
      var cy = height / 2;
      var r = Math.min(width, height) / 2 - 6;
      (series[0] || []).forEach(function (value, index) {
        var sweep = total ? (Math.abs(value) / total) * Math.PI * 2 : 0;
        var x1 = cx + r * Math.cos(angle);
        var y1 = cy + r * Math.sin(angle);
        var x2 = cx + r * Math.cos(angle + sweep);
        var y2 = cy + r * Math.sin(angle + sweep);
        parts.push(
          '<path d="M' + cx + ' ' + cy + ' L' + x1 + ' ' + y1 + ' A' + r + ' ' + r + ' 0 ' +
            (sweep > Math.PI ? 1 : 0) + ' 1 ' + x2 + ' ' + y2 + ' Z" fill="' +
            escapeAttr(colors[index % colors.length]) + '"/>',
        );
        angle += sweep;
      });
    } else if (element.chartType === 'line' || element.chartType === 'area') {
      var stepX = labels.length > 1 ? (width - pad * 2) / (labels.length - 1) : 0;
      series.forEach(function (values, sIndex) {
        var points = values
          .map(function (value, index) {
            var x = pad + stepX * index;
            var y = height - pad - ((value / max) * (height - pad * 2));
            return x + ',' + y;
          })
          .join(' ');
        if (element.chartType === 'area') {
          parts.push(
            '<polygon points="' + pad + ',' + (height - pad) + ' ' + points + ' ' +
              (pad + stepX * (values.length - 1)) + ',' + (height - pad) + '" fill="' +
              escapeAttr(colors[sIndex % colors.length]) + '" opacity="0.3"/>',
          );
        }
        parts.push(
          '<polyline points="' + points + '" fill="none" stroke="' +
            escapeAttr(colors[sIndex % colors.length]) + '" stroke-width="2"/>',
        );
      });
    } else {
      var count = labels.length || 1;
      var slot = (width - pad * 2) / count;
      var barWidth = Math.max(4, (slot * 0.6) / Math.max(1, series.length));
      series.forEach(function (values, sIndex) {
        values.forEach(function (value, index) {
          var barHeight = (value / max) * (height - pad * 2);
          var x = pad + slot * index + sIndex * barWidth + 2;
          parts.push(
            '<rect x="' + x + '" y="' + (height - pad - barHeight) + '" width="' + barWidth +
              '" height="' + barHeight + '" fill="' + escapeAttr(colors[sIndex % colors.length]) + '"/>',
          );
        });
      });
    }
    labels.forEach(function (label, index) {
      var x = pad + ((width - pad * 2) / Math.max(1, labels.length)) * (index + 0.5);
      parts.push(
        '<text x="' + x + '" y="' + (height - 8) + '" font-size="11" text-anchor="middle" fill="#475569">' +
          escapeAttr(label) + '</text>',
      );
    });
    parts.push('</svg>');
    return parts.join('');
  }

  function tableHtml(element) {
    var rows = element.data || [];
    var colWidths = element.colWidths || [];
    var html = ['<table style="width:100%;table-layout:fixed">'];
    rows.forEach(function (row) {
      html.push('<tr>');
      row.forEach(function (cell, index) {
        var style = 'width:' + (colWidths[index] ? colWidths[index] * 100 + '%' : 'auto') + ';';
        if (cell.style && cell.style.backcolor) style += 'background:' + cell.style.backcolor + ';';
        if (cell.style && cell.style.color) style += 'color:' + cell.style.color + ';';
        html.push(
          '<td colspan="' + (cell.colspan || 1) + '" rowspan="' + (cell.rowspan || 1) + '" style="' + style + '">' +
            (cell.text || '') + '</td>',
        );
      });
      html.push('</tr>');
    });
    html.push('</table>');
    return html.join('');
  }

  function renderSlide(slide) {
    var wrap = el('div', 'omc-frame');
    var ratio = slide.viewportRatio || 0.5625;
    var size = slide.viewportSize || 1000;
    var canvas = el('div', 'omc-canvas');
    canvas.style.width = size + 'px';
    canvas.style.height = size * ratio + 'px';
    var background = slide.background;
    if (background && background.type === 'solid' && background.color) {
      canvas.style.background = background.color;
    } else if (background && background.type === 'gradient' && background.gradient) {
      var stops = (background.gradient.colors || []).map(function (stop) {
        return stop.color;
      });
      canvas.style.background = 'linear-gradient(135deg,' + stops.join(',') + ')';
    } else if (background && background.type === 'image' && background.image) {
      canvas.style.backgroundImage = 'url("' + background.image.src + '")';
      canvas.style.backgroundSize = 'cover';
    }
    (slide.elements || []).forEach(function (element) {
      var node = renderElement(element);
      if (node) canvas.appendChild(node);
    });
    wrap.appendChild(canvas);
    return { frame: wrap, canvas: canvas, size: size, ratio: ratio };
  }

  // ── 非幻灯片场景 ─────────────────────────────────────────────────────────
  function renderQuiz(scene) {
    var panel = el('div', 'omc-panel');
    var title = el('h2');
    title.textContent = scene.title || strings.quizLabel || 'Quiz';
    panel.appendChild(title);
    var questions = (scene.content && scene.content.questions) || [];
    var results = [];
    var submit = el('button', 'omc-button');
    submit.textContent = strings.quizSubmit || 'Submit';
    submit.disabled = true;

    var recompute = function () {
      submit.disabled = !results.some(function (result) {
        return result.answered;
      });
    };

    questions.forEach(function (question, index) {
      var block = el('div', 'omc-question');
      var stem = el('p');
      stem.textContent = (index + 1) + '. ' + (question.question || '');
      block.appendChild(stem);

      var result = { answered: false, correct: false, question: question };
      results.push(result);

      if (question.type === 'short_answer' || !question.options) {
        var input = el('textarea');
        input.placeholder = strings.quizAnswerPlaceholder || '';
        input.style.width = '100%';
        input.style.minHeight = '4rem';
        input.addEventListener('input', function () {
          result.answered = input.value.trim().length > 0;
          recompute();
        });
        block.appendChild(input);
      } else {
        var multiple = question.type === 'multiple';
        var picked = [];
        question.options.forEach(function (option) {
          var label = el('label', 'omc-option');
          var radio = el('input');
          radio.type = multiple ? 'checkbox' : 'radio';
          radio.name = 'q' + index;
          radio.value = option.value;
          radio.addEventListener('change', function () {
            if (multiple) {
              picked = Array.prototype.slice
                .call(block.querySelectorAll('input:checked'))
                .map(function (node) {
                  return node.value;
                });
            } else {
              picked = option.value ? [option.value] : [];
            }
            result.answered = picked.length > 0;
            recompute();
          });
          label.appendChild(radio);
          label.appendChild(text(option.label || option.value || ''));
          block.appendChild(label);
        });
        result.picked = function () {
          return picked;
        };
      }
      panel.appendChild(block);
    });

    var actions = el('div', 'omc-actions');
    actions.appendChild(submit);
    var output = el('div', 'omc-result');
    panel.appendChild(actions);
    panel.appendChild(output);

    submit.addEventListener('click', function () {
      var correct = 0;
      var gradable = 0;
      results.forEach(function (result) {
        var answer = result.question.answer || [];
        if (!result.question.hasAnswer || answer.length === 0) return;
        gradable += 1;
        var picked = result.picked ? result.picked() : [];
        var ok =
          answer.length === picked.length &&
          answer.every(function (value) {
            return picked.indexOf(value) !== -1;
          });
        result.correct = ok;
        if (ok) correct += 1;
      });
      output.dataset.correct = String(gradable > 0 && correct === gradable);
      output.textContent =
        (strings.quizScore || 'Score') + ': ' + correct + ' / ' + gradable;
      submit.textContent = strings.quizRetry || 'Try again';
      submit.disabled = true;
    });

    return panel;
  }

  function renderPbl(scene) {
    var panel = el('div', 'omc-panel');
    var project = (scene.content && scene.content.projectV2) || {};
    var title = el('h2');
    title.textContent = scene.title || project.title || strings.pblScenario || 'Project';
    panel.appendChild(title);

    var addBlock = function (heading, value) {
      if (!value) return;
      var h = el('h3');
      h.textContent = heading;
      panel.appendChild(h);
      var p = el('p');
      p.textContent = value;
      panel.appendChild(p);
    };

    var scenario = project.scenario || {};
    addBlock(strings.pblLearningObjective || 'Learning objective', project.learningObjective);
    addBlock(strings.pblScenario || 'Scenario', scenario.setting);
    addBlock(strings.pblGoal || 'Goal', scenario.goal);
    addBlock(strings.pblYourRole || 'Your role', scenario.learnerRole);
    if ((scenario.characters || []).length) {
      addBlock(
        strings.pblCharacters || 'Characters',
        scenario.characters
          .map(function (character) {
            return character.name ? character.name + (character.persona ? ': ' + character.persona : '') : '';
          })
          .filter(Boolean)
          .join('\n'),
      );
    }
    if ((project.milestones || []).length) {
      var h = el('h3');
      h.textContent = strings.pblMilestones || 'Milestones';
      panel.appendChild(h);
      var list = el('ol');
      project.milestones
        .slice()
        .sort(function (a, b) {
          return (Number(a.order) || 0) - (Number(b.order) || 0);
        })
        .forEach(function (milestone) {
          var item = el('li');
          item.textContent = milestone.title || '';
          list.appendChild(item);
        });
      panel.appendChild(list);
    }
    addBlock(strings.pblOnlineOnly || '', '');
    return panel;
  }

  function renderInteractive(scene) {
    var frame = el('iframe', 'omc-iframe');
    frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups');
    frame.setAttribute('title', scene.title || strings.interactiveTitle || '');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    if (scene.content && scene.content.html) frame.srcdoc = scene.content.html;
    return frame;
  }

  function renderUnavailable(message) {
    var panel = el('div', 'omc-panel');
    var p = el('p');
    p.textContent = message || strings.unsupportedScene || '';
    panel.appendChild(p);
    return panel;
  }

  // ── 外壳与导航 ───────────────────────────────────────────────────────────
  var shell = el('div', 'omc-player');
  var stage = el('div', 'omc-stage');
  var bar = el('div', 'omc-bar');
  var prev = el('button');
  var next = el('button');
  var dots = el('div', 'omc-dots');
  var caption = el('div', 'omc-caption');
  var captionText = el('span');
  caption.appendChild(captionText);

  prev.textContent = strings.previous || 'Previous';
  next.textContent = strings.next || 'Next';
  bar.appendChild(prev);
  bar.appendChild(dots);
  bar.appendChild(next);
  stage.appendChild(caption);
  shell.appendChild(stage);
  shell.appendChild(bar);
  root.appendChild(shell);

  if (scenes.length === 0) {
    stage.appendChild(renderUnavailable(strings.emptyClassroom || 'This classroom has no scenes.'));
    prev.disabled = true;
    next.disabled = true;
    return;
  }

  var current = 0;
  var slideView = null;

  function resize() {
    if (!slideView) return;
    var rect = stage.getBoundingClientRect();
    var scale = Math.min(rect.width / slideView.size, rect.height / (slideView.size * slideView.ratio));
    if (!isFinite(scale) || scale <= 0) scale = 1;
    slideView.frame.style.width = slideView.size * scale + 'px';
    slideView.frame.style.height = slideView.size * slideView.ratio * scale + 'px';
    slideView.canvas.style.transform = 'scale(' + scale + ')';
  }

  function show(index) {
    if (index < 0 || index >= scenes.length) return;
    current = index;
    slideView = null;
    stage.textContent = '';
    stage.appendChild(caption);
    var scene = scenes[index];
    var content = scene.content || {};
    var node;
    if (content.type === 'slide') {
      slideView = renderSlide(content.canvas || {});
      node = slideView.frame;
    } else if (content.type === 'quiz') {
      node = renderQuiz(scene);
    } else if (content.type === 'pbl') {
      node = renderPbl(scene);
    } else if (content.type === 'interactive') {
      node = content.html ? renderInteractive(scene) : renderUnavailable(strings.unsupportedScene);
    } else {
      node = renderUnavailable(strings.unsupportedScene);
    }
    stage.insertBefore(node, caption);

    var speech = (scene.actions || []).filter(function (action) {
      return action.type === 'speech';
    });
    captionText.textContent = speech.length ? speech[0].text : '';
    caption.style.display = speech.length ? '' : 'none';

    prev.disabled = index === 0;
    next.disabled = index === scenes.length - 1;
    Array.prototype.forEach.call(dots.children, function (dot, dotIndex) {
      dot.setAttribute('aria-current', String(dotIndex === index));
    });
    resize();
  }

  scenes.forEach(function (scene, index) {
    var dot = el('button', 'omc-dot');
    dot.type = 'button';
    dot.title = scene.title || String(index + 1);
    dot.setAttribute('aria-label', dot.title);
    dot.addEventListener('click', function () {
      show(index);
    });
    dots.appendChild(dot);
  });

  prev.addEventListener('click', function () {
    show(current - 1);
  });
  next.addEventListener('click', function () {
    show(current + 1);
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'ArrowLeft') show(current - 1);
    if (event.key === 'ArrowRight') show(current + 1);
  });
  window.addEventListener('resize', resize);

  show(0);
  document.documentElement.setAttribute('data-player', 'ready');
})();
