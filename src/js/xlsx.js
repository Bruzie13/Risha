/* A table saved as an Excel file (.xlsx), made in the browser.

   An exported CSV opened in Excel as plain text: no header, no widths, no
   totals. This writes a real workbook instead: a bold coloured header row
   with filter arrows that stays in view while scrolling, columns wide enough
   to read, amounts as peso numbers, dates as dates, and a TOTAL row worked
   out by Excel itself.

   An .xlsx file is a zip of a few XML files. They are small, so they are
   stored without compression, and no library has to be loaded.

   downloadXlsx(filename, sheetName, columns, rows, total)
     columns: [{ head, width, type }]  type: 'text' | 'int' | 'money' | 'datetime' | 'number'
     rows:    arrays of values in column order ('datetime' takes a Date)
     total:   optional { label, sum: [column indexes], skipWhen: { col, equals } }
              skipWhen leaves rows out of the total (for example voided sales) */
(function () {
    'use strict';

    var CRC_TABLE = (function () {
        var t = [];
        for (var n = 0; n < 256; n++) {
            var c = n;
            for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
            t[n] = c >>> 0;
        }
        return t;
    })();
    function crc32(bytes) {
        var c = 0xFFFFFFFF;
        for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
        return (c ^ 0xFFFFFFFF) >>> 0;
    }

    /* files: [{ name, text }] → the bytes of a zip that stores them as they are */
    function zip(files) {
        var enc = new TextEncoder(), parts = [], central = [], offset = 0;
        function u16(v) { return [v & 0xFF, (v >>> 8) & 0xFF]; }
        function u32(v) { return [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF]; }
        files.forEach(function (f) {
            var name = enc.encode(f.name), data = enc.encode(f.text), crc = crc32(data);
            var head = [].concat(u32(0x04034B50), u16(20), u16(0), u16(0), u16(0), u16(0x21),
                u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0));
            parts.push(new Uint8Array(head), name, data);
            central.push([].concat(u32(0x02014B50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0x21),
                u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0),
                u32(0), u32(offset)), name);
            offset += head.length + name.length + data.length;
        });
        var size = 0;
        central.forEach(function (c, i) { parts.push(i % 2 ? c : new Uint8Array(c)); size += c.length; });
        parts.push(new Uint8Array([].concat(u32(0x06054B50), u16(0), u16(0), u16(files.length), u16(files.length),
            u32(size), u32(offset), u16(0))));
        return new Blob(parts, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    }

    function esc(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
            .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
    }
    function colName(i) { var s = ''; i++; while (i) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
    // Excel counts days from 30 Dec 1899, in the time shown on this computer
    function excelDate(d) { return (d.getTime() - d.getTimezoneOffset() * 60000) / 86400000 + 25569; }

    // style numbers in styles.xml below
    var S = { text: 0, header: 1, money: 2, datetime: 3, int: 4, number: 5, totalText: 6, totalMoney: 7, totalInt: 8, totalNumber: 9 };
    var STYLES =
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<numFmts count="2"><numFmt numFmtId="164" formatCode="&quot;₱&quot;#,##0.00"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd hh:mm"/></numFmts>' +
        '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font>' +
        '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>' +
        '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FF0969AD"/><bgColor indexed="64"/></patternFill></fill></fills>' +
        '<borders count="2"><border/><border><top style="thin"><color auto="1"/></top><bottom style="double"><color auto="1"/></bottom></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="10">' +
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
        '<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
        '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
        '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
        '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>' +
        '<xf numFmtId="164" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>' +
        '<xf numFmtId="3" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>' +
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>' +
        '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

    function cell(ref, value, type) {
        if (value === null || value === undefined || value === '') return '';
        if (type === 'datetime' && value instanceof Date && !isNaN(value)) return '<c r="' + ref + '" s="' + S.datetime + '"><v>' + excelDate(value) + '</v></c>';
        if ((type === 'money' || type === 'int' || type === 'number') && isFinite(Number(value))) {
            return '<c r="' + ref + '" s="' + S[type] + '"><v>' + Number(value) + '</v></c>';
        }
        // text is written as text, so nothing typed in a name can become a formula
        return '<c r="' + ref + '" t="inlineStr" s="' + S.text + '"><is><t xml:space="preserve">' + esc(value) + '</t></is></c>';
    }

    window.downloadXlsx = function (filename, sheetName, columns, rows, total) {
        var sheet = String(sheetName || 'Sheet1').replace(/[\[\]:*?\/\\]/g, ' ').slice(0, 31);
        var last = colName(columns.length - 1), first = 2, end = rows.length + 1;
        var xml = [];
        xml.push('<row r="1">' + columns.map(function (c, i) {
            return '<c r="' + colName(i) + '1" t="inlineStr" s="' + S.header + '"><is><t>' + esc(c.head) + '</t></is></c>';
        }).join('') + '</row>');
        rows.forEach(function (r, k) {
            var n = k + 2;
            xml.push('<row r="' + n + '">' + columns.map(function (c, i) { return cell(colName(i) + n, r[i], c.type); }).join('') + '</row>');
        });
        if (total && rows.length) {
            var t = rows.length + 2, skip = total.skipWhen;
            xml.push('<row r="' + t + '">' + columns.map(function (c, i) {
                var ref = colName(i) + t;
                if (i === 0) return '<c r="' + ref + '" t="inlineStr" s="' + S.totalText + '"><is><t>' + esc(total.label || 'TOTAL') + '</t></is></c>';
                if (total.sum.indexOf(i) === -1) return '<c r="' + ref + '" s="' + S.totalText + '"/>';
                var range = colName(i) + first + ':' + colName(i) + end;
                var sum = rows.reduce(function (a, r) { return skip && r[skip.col] === skip.equals ? a : a + (Number(r[i]) || 0); }, 0);
                var f = skip
                    ? 'SUMIF(' + colName(skip.col) + first + ':' + colName(skip.col) + end + ',"&lt;&gt;' + esc(skip.equals) + '",' + range + ')'
                    : 'SUM(' + range + ')';
                var s = c.type === 'money' ? S.totalMoney : c.type === 'int' ? S.totalInt : S.totalNumber;
                return '<c r="' + ref + '" s="' + s + '"><f>' + f + '</f><v>' + Math.round(sum * 100) / 100 + '</v></c>';
            }).join('') + '</row>');
        }
        var sheetXml =
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
            '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
            '<cols>' + columns.map(function (c, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + (c.width || 14) + '" customWidth="1"/>'; }).join('') + '</cols>' +
            '<sheetData>' + xml.join('') + '</sheetData>' +
            (rows.length ? '<autoFilter ref="A1:' + last + end + '"/>' : '') +
            '</worksheet>';
        var files = [
            { name: '[Content_Types].xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
                '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
                '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
                '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
                '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
            { name: '_rels/.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
                '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
            { name: 'xl/workbook.xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
                '<sheets><sheet name="' + esc(sheet) + '" sheetId="1" r:id="rId1"/></sheets>' +
                (rows.length ? '<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">\'' + esc(sheet) + '\'!$A$1:$' + last + '$' + end + '</definedName></definedNames>' : '') +
                '</workbook>' },
            { name: 'xl/_rels/workbook.xml.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
                '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
                '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
            { name: 'xl/styles.xml', text: STYLES },
            { name: 'xl/worksheets/sheet1.xml', text: sheetXml }
        ];
        var url = URL.createObjectURL(zip(files));
        var a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    };
})();
