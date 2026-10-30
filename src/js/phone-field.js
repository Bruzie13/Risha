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
        return iti;
    };

    // the country data loads a moment after the page: until then the server
    // is the one that checks
    const ready = () => !!window.intlTelInputUtils;

    window.phoneProblem = function (input, needed) {
        const v = String(input && input.value || '').trim();
        if (!v) return needed ? 'Enter the phone number.' : null;
        const iti = fields.get(input);
        if (!iti || !ready()) return null;
        if (iti.isValidNumber()) return null;
        const country = (iti.getSelectedCountryData().name || 'the country chosen').replace(/\s*\(.*\)$/, '');
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
