/* The eye in a password field: press it to see what was typed, press again
   to hide it. Added to every password field on the page that does not have
   one yet (the sign-in page draws its own). Each field has its own eye. */
(function () {
    'use strict';
    function addEye(input) {
        if (input.dataset.eye || (input.parentElement && input.parentElement.querySelector('.toggle-password, .pw-eye'))) return;
        input.dataset.eye = '1';
        var wrap = document.createElement('span');
        wrap.className = 'pw-wrap';
        input.parentNode.insertBefore(wrap, input);
        wrap.appendChild(input);
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pw-eye';
        btn.setAttribute('aria-label', 'Show password');
        btn.setAttribute('aria-pressed', 'false');
        btn.title = 'Show password';
        btn.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">visibility</span>';
        function set(show) {
            input.type = show ? 'text' : 'password';
            btn.firstChild.textContent = show ? 'visibility_off' : 'visibility';
            btn.setAttribute('aria-pressed', show ? 'true' : 'false');
            btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
            btn.title = show ? 'Hide password' : 'Show password';
        }
        btn.addEventListener('click', function () {
            set(input.type === 'password');
            input.focus();
        });
        wrap.appendChild(btn);
        // a form that is cleared or sent hides the password again
        if (input.form) {
            ['reset', 'submit'].forEach(function (ev) {
                input.form.addEventListener(ev, function () { set(false); });
            });
        }
    }
    function scan(root) {
        (root.querySelectorAll ? root.querySelectorAll('input[type="password"]') : []).forEach(addEye);
    }
    function start() {
        scan(document);
        new MutationObserver(function (records) {
            records.forEach(function (r) { r.addedNodes.forEach(function (n) { if (n.nodeType === 1) scan(n); }); });
        }).observe(document.body, { childList: true, subtree: true });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
