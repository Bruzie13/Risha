/* FETCH ambient backdrop — a GPU-rendered aurora that sits behind the whole
   app. It is deliberately quiet: colour comes from the live theme tokens, the
   motion is slow, and the centre of the screen (where text lives) is kept calm
   so nothing competes with the data.

   No libraries. Raw WebGL, one fullscreen triangle, one fragment shader.
   Degrades to a static CSS gradient when WebGL, reduced motion, or a
   low-power device says no. */
(function () {
    'use strict';

    var root = document.documentElement;

    // ── Capability + preference gates ──────────────────────────────────────
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Settings → Appearance can switch the backdrop off. We still set the
    // renderer up (hidden and idle) so it can be switched back on live.
    var enabled = localStorage.getItem('ambientBackdrop') !== 'off';

    // ── Colour plumbing ────────────────────────────────────────────────────
    // Theme tokens can be `color-mix(...)`, so resolve them through the
    // browser instead of parsing them ourselves.
    var probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;width:0;height:0;opacity:0;pointer-events:none';
    var probeReady = false;

    function resolve(varName, fallback) {
        if (!probeReady) { (document.body || root).appendChild(probe); probeReady = true; }
        probe.style.backgroundColor = '';
        probe.style.backgroundColor = 'var(' + varName + ')';
        var css = getComputedStyle(probe).backgroundColor;
        if (!css) return fallback;
        var m = css.match(/-?[\d.]+(?:e-?\d+)?/g);
        if (!m || m.length < 3) return fallback;
        // A `color-mix()` token computes to `color(srgb 0.95 0.96 0.98)` in
        // Chrome and to `rgb(244, 246, 251)` elsewhere — the channel scale
        // differs, so switch on the function name rather than the values.
        var unit = css.indexOf('color(') === 0 ? 1 : 255;
        var out = [+m[0] / unit, +m[1] / unit, +m[2] / unit];
        // fully transparent means the variable did not resolve at all
        var alpha = m.length > 3 ? +m[3] : 1;
        if (!alpha || out.some(isNaN)) return fallback;
        return out;
    }

    function readPalette() {
        var dark = root.classList.contains('dark-mode');
        return {
            bg: resolve('--bg-body', dark ? [0.055, 0.075, 0.125] : [0.957, 0.965, 0.98]),
            c1: resolve('--primary', [0.933, 0.416, 0.373]),
            c2: resolve('--secondary', [0.31, 0.659, 0.871]),
            c3: resolve('--accent', [0.91, 0.576, 0.047]),
            c4: resolve('--purple', [0.545, 0.435, 0.816]),
            // Dark rooms take more colour before it reads as noise.
            intensity: dark ? 0.60 : 0.42,
            dark: dark ? 1 : 0
        };
    }

    // ── Shaders ────────────────────────────────────────────────────────────
    var VERT = [
        'attribute vec2 a_pos;',
        'void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }'
    ].join('\n');

    var FRAG = [
        'precision highp float;',
        'uniform vec2  u_res;',
        'uniform float u_time;',
        'uniform vec2  u_mouse;',
        'uniform vec3  u_bg;',
        'uniform vec3  u_c1;',
        'uniform vec3  u_c2;',
        'uniform vec3  u_c3;',
        'uniform vec3  u_c4;',
        'uniform float u_intensity;',
        'uniform float u_dark;',

        // value noise — cheap, smooth, and plenty for a soft gradient field
        'float hash(vec2 p){',
        '  p = fract(p * vec2(123.34, 456.21));',
        '  p += dot(p, p + 45.32);',
        '  return fract(p.x * p.y);',
        '}',
        'float noise(vec2 p){',
        '  vec2 i = floor(p), f = fract(p);',
        '  vec2 u = f * f * (3.0 - 2.0 * f);',
        '  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),',
        '             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);',
        '}',
        'const mat2 ROT = mat2(0.80, 0.60, -0.60, 0.80);',
        'float fbm(vec2 p){',
        '  float v = 0.0, a = 0.5;',
        '  for (int i = 0; i < 5; i++){',
        '    v += a * noise(p);',
        '    p = ROT * p * 2.02;',
        '    a *= 0.5;',
        '  }',
        '  return v;',
        '}',

        'void main(){',
        '  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;',
        '  float t = u_time * 0.045;',

        // two rounds of domain warping give the field its liquid, layered look
        '  vec2 p = uv * 1.45;',
        '  vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - t * 0.8));',
        '  vec2 r = vec2(fbm(p + 2.6 * q + vec2(1.7, 9.2) + t * 0.7),',
        '                fbm(p + 2.6 * q + vec2(8.3, 2.8) - t * 0.6));',
        '  float f = fbm(p + 2.4 * r);',

        // blend the theme accents through the warped field
        '  vec3 col = mix(u_c1, u_c2, clamp(r.x * 1.6, 0.0, 1.0));',
        '  col = mix(col, u_c3, clamp(length(q) * 0.85, 0.0, 1.0));',
        '  col = mix(col, u_c4, clamp(r.y * 0.9 - 0.1, 0.0, 1.0));',

        // keep the middle of the screen calm — the UI reads there
        '  float d = length(uv * vec2(1.0, 1.25));',
        '  float edge = smoothstep(0.15, 1.05, d);',
        '  float field = smoothstep(0.25, 0.95, f) * mix(0.30, 1.0, edge);',

        // a soft light that trails the cursor, so the surface feels physical
        '  vec2 md = uv - u_mouse;',
        '  float spot = exp(-dot(md, md) * 4.5) * 0.16;',

        '  float amt = clamp(field * u_intensity + spot, 0.0, 1.0);',
        '  vec3 outc = mix(u_bg, col, amt);',

        // gentle vignette adds depth without dimming the working area
        '  outc *= mix(1.0, mix(1.04, 0.90, u_dark), smoothstep(0.35, 1.35, d));',

        // dither: 8-bit gradients band badly over large areas
        '  float grain = (hash(gl_FragCoord.xy + fract(u_time)) - 0.5) / 255.0;',
        '  gl_FragColor = vec4(outc + grain, 1.0);',
        '}'
    ].join('\n');

    // ── Boot ───────────────────────────────────────────────────────────────
    function start() {
        var canvas = document.createElement('canvas');
        canvas.id = 'auroraCanvas';
        canvas.setAttribute('aria-hidden', 'true');

        var gl = null;
        try {
            var opts = { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' };
            gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
        } catch (e) { gl = null; }

        if (!gl) { root.classList.add('aurora-fallback'); return; }

        function compile(type, src) {
            var s = gl.createShader(type);
            gl.shaderSource(s, src);
            gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { gl.deleteShader(s); return null; }
            return s;
        }

        var vs = compile(gl.VERTEX_SHADER, VERT);
        var fs = compile(gl.FRAGMENT_SHADER, FRAG);
        if (!vs || !fs) { root.classList.add('aurora-fallback'); return; }

        var prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { root.classList.add('aurora-fallback'); return; }
        gl.useProgram(prog);

        // one oversized triangle covers the viewport with no seam
        var buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        var loc = gl.getAttribLocation(prog, 'a_pos');
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

        var U = {};
        ['u_res', 'u_time', 'u_mouse', 'u_bg', 'u_c1', 'u_c2', 'u_c3', 'u_c4', 'u_intensity', 'u_dark']
            .forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });

        document.body.appendChild(canvas);
        root.classList.add('aurora-on');

        // ── State ──────────────────────────────────────────────────────────
        var palette = readPalette();
        var shown = {                       // what is on screen right now
            bg: palette.bg.slice(), c1: palette.c1.slice(), c2: palette.c2.slice(),
            c3: palette.c3.slice(), c4: palette.c4.slice(),
            intensity: palette.intensity, dark: palette.dark
        };
        var mouse = [0, 0], mouseTarget = [0, 0];
        var dpr = 1, w = 0, h = 0;

        function resize() {
            // Capping DPR keeps big Retina screens from rendering 4x the pixels
            // for an effect nobody looks at directly.
            dpr = Math.min(window.devicePixelRatio || 1, 1.5);
            w = Math.round(window.innerWidth * dpr);
            h = Math.round(window.innerHeight * dpr);
            if (canvas.width === w && canvas.height === h) return;
            canvas.width = w;
            canvas.height = h;
            gl.viewport(0, 0, w, h);
        }
        resize();

        var rt = null;
        window.addEventListener('resize', function () {
            clearTimeout(rt);
            rt = setTimeout(function () { resize(); if (reduced) draw(performance.now()); }, 120);
        });

        if (!reduced) {
            window.addEventListener('pointermove', function (e) {
                mouseTarget[0] = (e.clientX - window.innerWidth / 2) / window.innerHeight;
                mouseTarget[1] = (window.innerHeight / 2 - e.clientY) / window.innerHeight;
            }, { passive: true });
        }

        // Theme (or a custom accent from Settings) changed — ease to the new
        // palette instead of snapping.
        function refreshPalette() { palette = readPalette(); }
        new MutationObserver(refreshPalette).observe(root, { attributes: true, attributeFilter: ['class', 'style'] });
        window.addEventListener('storage', function (e) {
            if (e.key === 'accentVars' || e.key === 'theme') setTimeout(refreshPalette, 30);
        });

        function ease(cur, target, k) {
            for (var i = 0; i < 3; i++) cur[i] += (target[i] - cur[i]) * k;
        }

        var t0 = performance.now();
        var last = 0;
        var MIN_FRAME = 1000 / 40;   // 40fps is smooth for something this slow
        var running = true;

        function draw(now) {
            var time = (now - t0) / 1000;

            ease(shown.bg, palette.bg, 0.08);
            ease(shown.c1, palette.c1, 0.08);
            ease(shown.c2, palette.c2, 0.08);
            ease(shown.c3, palette.c3, 0.08);
            ease(shown.c4, palette.c4, 0.08);
            shown.intensity += (palette.intensity - shown.intensity) * 0.08;
            shown.dark += (palette.dark - shown.dark) * 0.08;

            mouse[0] += (mouseTarget[0] - mouse[0]) * 0.045;
            mouse[1] += (mouseTarget[1] - mouse[1]) * 0.045;

            gl.uniform2f(U.u_res, w, h);
            gl.uniform1f(U.u_time, reduced ? 12.0 : time);
            gl.uniform2f(U.u_mouse, mouse[0], mouse[1]);
            gl.uniform3fv(U.u_bg, shown.bg);
            gl.uniform3fv(U.u_c1, shown.c1);
            gl.uniform3fv(U.u_c2, shown.c2);
            gl.uniform3fv(U.u_c3, shown.c3);
            gl.uniform3fv(U.u_c4, shown.c4);
            gl.uniform1f(U.u_intensity, shown.intensity);
            gl.uniform1f(U.u_dark, shown.dark);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
        }

        function loop(now) {
            if (!running) return;
            requestAnimationFrame(loop);
            if (now - last < MIN_FRAME) return;
            last = now;
            draw(now);
        }

        if (reduced) {
            // Still render — just once, as a still image with no motion.
            draw(performance.now());
            new MutationObserver(function () { draw(performance.now()); })
                .observe(root, { attributes: true, attributeFilter: ['class', 'style'] });
        } else {
            requestAnimationFrame(loop);
            document.addEventListener('visibilitychange', function () {
                if (document.hidden) { running = false; }
                else if (!running && enabled) { running = true; t0 += performance.now() - last; requestAnimationFrame(loop); }
            });
            // A lost context (GPU reset, tab suspended) should fall back quietly.
            canvas.addEventListener('webglcontextlost', function (e) {
                e.preventDefault(); running = false;
                root.classList.remove('aurora-on');
                root.classList.add('aurora-fallback');
            });
        }

        // Settings → Appearance flips this live. `persist` is false while the
        // user is only previewing a change they have not saved yet.
        window.setAmbientBackdrop = function (on, persist) {
            enabled = !!on;
            if (persist !== false) localStorage.setItem('ambientBackdrop', enabled ? 'on' : 'off');
            canvas.style.display = enabled ? '' : 'none';
            root.classList.toggle('aurora-on', enabled);
            root.classList.toggle('aurora-fallback', !enabled);
            if (enabled && !running && !reduced) { running = true; requestAnimationFrame(loop); }
            if (!enabled) running = false;
        };

        // Honour a saved "off" without skipping setup, so it can be undone live.
        if (!enabled) window.setAmbientBackdrop(false, false);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
