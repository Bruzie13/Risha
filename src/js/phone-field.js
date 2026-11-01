/* A phone box with a country picker, like Google's forms: a flag and its code
   (+63) beside the number, and the number checked against that country's real
   numbering, so "0000000000" cannot be saved. It uses intl-tel-input and its
   copy of Google's phone data (kept in src/vendor, so it comes from this server); the server
   checks the same thing with libphonenumber-js (backend/utils/supplier.js).

   phoneField(input)            turns a text box into one (the Philippines first)
   phoneProblem(input, needed)  the reason the number cannot be saved, or null
   phoneValue(input)            the number to send: +639171234567
   setPhoneValue(input, value)  puts a saved number back in the box */
(function () {
    'use strict';
    const UTILS = 'vendor/intl-tel-input-18.2.1/js/utils.js';
    const fields = new WeakMap();

    window.phoneField = function (input) {
        if (!input || typeof window.intlTelInput !== 'function') return null;
        if (fields.has(input)) return fields.get(input);
        const iti = window.intlTelInput(input, {
            initialCountry: 'ph',
            preferredCountries: ['ph'],
            separateDialCode: true,
            nationalMode: true,
            autoPlaceholder: 'aggressive',
            dropdownContainer: document.body,      // a window's own scroll area would cut the list off
            utilsScript: UTILS
        });
        fields.set(input, iti);
        // no more digits than the chosen country's numbers have (UAT, 1 Nov)
        input.addEventListener('input', () => keepToLimit(input, iti));
        input.addEventListener('countrychange', () => keepToLimit(input, iti));
        return iti;
    };

    // the country data loads a moment after the page: until then the server
    // is the one that checks
    const ready = () => !!window.intlTelInputUtils;
    const countryName = iti => (iti.getSelectedCountryData().name || 'the country chosen').replace(/\s*\(.*\)$/, '');

    /* The most digits the chosen country's ordinary numbers have as they are
       typed: the longer of its mobile and landline examples in Google's
       numbering data (0905 123 4567, so 11 for the Philippines). The leading 0
       counts only when it is typed. Rare longer numbers (toll-free and the
       like) are not shop phones, so they are left out. */
    function maxDigits(iti, typed) {
        const u = window.intlTelInputUtils, iso2 = iti.getSelectedCountryData().iso2;
        const lengths = [u.numberType.MOBILE, u.numberType.FIXED_LINE].map(function (type) {
            const ex = String(u.getExampleNumber(iso2, true, type) || '').replace(/\D/g, '');
            // the example is written with the country's leading 0; without it, one fewer
            return ex.charAt(0) === '0' && typed.charAt(0) !== '0' ? ex.length - 1 : ex.length;
        });
        return Math.max.apply(null, lengths);
    }
    function keepToLimit(input, iti) {
        // a number typed with its + code is the library's to read; leave it be
        if (!ready() || input.value.trim().charAt(0) === '+') { delete input.dataset.maxDigits; return; }
        const max = maxDigits(iti, input.value.replace(/\D/g, ''));
        if (!max) return;
        input.dataset.maxDigits = max;            // the box's counter (clear-input.js) says it
        input.dataset.maxDigitsWhere = countryName(iti);
        let v = input.value, extra = v.replace(/\D/g, '').length - max;
        while (extra-- > 0) {                     // drop the extra digits from the end
            const i = v.search(/\d(?=\D*$)/);
            v = v.slice(0, i) + v.slice(i + 1);
        }
        if (v !== input.value) input.value = v.replace(/[\s.\-]+$/, '');   // and the space left before them
    }

    window.phoneProblem = function (input, needed) {
        const v = String(input && input.value || '').trim();
        if (!v) return needed ? 'Enter the phone number.' : null;
        const iti = fields.get(input);
        if (!iti || !ready()) return null;
        if (iti.isValidNumber()) return null;
        const country = countryName(iti);
        return `Enter a real phone number for ${country}` + (input.placeholder ? `, like ${input.placeholder}.` : '.')
            + ' Pick another country with the flag if the number is from abroad.';
    };

    window.phoneValue = function (input) {
        const v = String(input && input.value || '').trim();
        if (!v) return '';
        const iti = fields.get(input);
        return iti && ready() && iti.isValidNumber() ? iti.getNumber() : v;
    };

    window.setPhoneValue = function (input, value) {
        const iti = fields.get(input);
        if (!iti) { if (input) input.value = value || ''; return; }
        if (value) iti.setNumber(String(value));
        else { input.value = ''; iti.setCountry('ph'); }
    };
})();
