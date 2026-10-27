/* Tables saved as an Excel file (.xlsx), made in the browser.

   An exported CSV opened in Excel as plain text: no header, no widths, no
   totals. This writes a real workbook instead. Each sheet holds an Excel
   table (Insert > Table: a coloured header with filter arrows, striped rows,
   cell borders) whose header stays in view while scrolling, columns wide
   enough to read, amounts as peso numbers, dates as dates, a TOTAL row worked
   out by Excel itself, and, when asked for, a chart drawn by Excel from the
   table, so it changes if a number in the table is changed.

   An .xlsx file is a zip of a few XML files. They are small, so they are
   stored without compression, and no library has to be loaded.

   downloadWorkbook(filename, sheets)
     sheets: [{ name, columns, rows, total, chart }]
     columns: [{ head, width, type }]  type: 'text' | 'int' | 'money' | 'datetime' | 'number'
     rows:    arrays of values in column order ('datetime' takes a Date)
     total:   optional { label, sum: [column indexes], skipWhen: { col, equals } }
              skipWhen leaves rows out of the total (for example voided sales)
     chart:   optional { title, cat, val }: a chart of column `val` against the
              labels in column `cat` (column indexes): columns for up to 31
              rows, a line for more

   downloadXlsx(filename, sheetName, columns, rows, total, chart) is one sheet. */
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

    // style numbers in styles.xml below; the cells of a table (10 to 14) have thin
    // grey borders, while 0 stays plain for whatever is typed outside the table
    var S = { text: 10, header: 1, money: 11, datetime: 12, int: 13, number: 14, totalText: 6, totalMoney: 7, totalInt: 8, totalNumber: 9 };
    var STYLES =
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<numFmts count="2"><numFmt numFmtId="164" formatCode="&quot;₱&quot;#,##0.00"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd hh:mm"/></numFmts>' +
        '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font>' +
        '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>' +
        '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FF0969AD"/><bgColor indexed="64"/></patternFill></fill></fills>' +
        '<borders count="3"><border/><border><top style="thin"><color auto="1"/></top><bottom style="double"><color auto="1"/></bottom></border>' +
        '<border><left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right>' +
        '<top style="thin"><color rgb="FFBFBFBF"/></top><bottom style="thin"><color rgb="FFBFBFBF"/></bottom></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="15">' +
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
        '<xf numFmtId="0" fontId="2" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>' +
        '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
        '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
        '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>' +
        '<xf numFmtId="164" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>' +
        '<xf numFmtId="3" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>' +
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>' +
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="2" xfId="0" applyBorder="1"/>' +
        '<xf numFmtId="164" fontId="0" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyBorder="1"/>' +
        '<xf numFmtId="165" fontId="0" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyBorder="1"/>' +
        '<xf numFmtId="3" fontId="0" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyBorder="1"/>' +
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="2" xfId="0" applyBorder="1"/>' +
        '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

    function cell(ref, value, type) {
        // an empty cell is still written, so the table's borders have no gaps
        if (value === null || value === undefined || value === '') return '<c r="' + ref + '" s="' + S.text + '"/>';
        if (type === 'datetime' && value instanceof Date && !isNaN(value)) return '<c r="' + ref + '" s="' + S.datetime + '"><v>' + excelDate(value) + '</v></c>';
        if ((type === 'money' || type === 'int' || type === 'number') && isFinite(Number(value))) {
            return '<c r="' + ref + '" s="' + S[type] + '"><v>' + Number(value) + '</v></c>';
        }
        // text is written as text, so nothing typed in a name can become a formula
        return '<c r="' + ref + '" t="inlineStr" s="' + S.text + '"><is><t xml:space="preserve">' + esc(value) + '</t></is></c>';
    }

    var NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
    var XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    var REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    var CHART_NS = 'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="' + REL + '"';

    function rels(list) {
        return XML + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            list.map(function (r, k) { return '<Relationship Id="rId' + (k + 1) + '" Type="' + REL + '/' + r[0] + '" Target="' + r[1] + '"/>'; }).join('') +
            '</Relationships>';
    }

    // a sheet name Excel takes: 31 characters, none of [ ] : * ? / \
    function safeSheet(name, n) { return String(name || 'Sheet' + n).replace(/[\[\]:*?\/\\]/g, ' ').slice(0, 31); }
    // a table name: letters, numbers and _ only, starting with a letter
    function tableName(name, n) { return ('Table_' + String(name).replace(/[^A-Za-z0-9_]/g, '_')).slice(0, 40) + '_' + n; }
    // the same heading twice would make Excel refuse the table, so a repeat gets a number
    function uniqueHeads(columns) {
        var seen = {};
        return columns.map(function (c) {
            var h = String(c.head || 'Column'), k = 2;
            while (seen[h.toLowerCase()]) h = c.head + ' ' + k++;
            seen[h.toLowerCase()] = true;
            return h;
        });
    }

    // thin light grey, for the gridlines and the bottom axis
    var GREY_LINE = '<c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="D9D9D9"/></a:solidFill></a:ln></c:spPr>';

    /* A chart of one column against the labels of another, read from the
       sheet's own cells (the numbers are also stored, for viewers that do not
       work charts out themselves). Up to a month of points are columns; more
       than that are a line, drawn wider, which stays readable. */
    var MAX_BARS = 31;
    function isLine(sh) { return sh.rows.length > MAX_BARS; }
    function chartXml(sheet, sh, heads) {
        var c = sh.chart, n = sh.rows.length, q = "'" + esc(sheet).replace(/'/g, "''") + "'";
        var catCol = colName(c.cat), valCol = colName(c.val);
        var catPts = sh.rows.map(function (r, k) { return '<c:pt idx="' + k + '"><c:v>' + esc(r[c.cat] == null ? '' : r[c.cat]) + '</c:v></c:pt>'; }).join('');
        var valPts = sh.rows.map(function (r, k) { return '<c:pt idx="' + k + '"><c:v>' + (Number(r[c.val]) || 0) + '</c:v></c:pt>'; }).join('');
        var money = sh.columns[c.val].type === 'money', line = isLine(sh);
        return XML + '<c:chartSpace ' + CHART_NS + '><c:roundedCorners val="0"/><c:chart>' +
            '<c:title><c:tx><c:rich><a:bodyPr/><a:p><a:pPr><a:defRPr sz="1400" b="1"/></a:pPr><a:r><a:rPr lang="en-US" sz="1400" b="1"/><a:t>' +
            esc(c.title || heads[c.val]) + '</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>' +
            '<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>' +
            (line ? '<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>'
                  : '<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>') +
            '<c:ser><c:idx val="0"/><c:order val="0"/>' +
            '<c:tx><c:strRef><c:f>' + q + '!$' + valCol + '$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>' + esc(heads[c.val]) + '</c:v></c:pt></c:strCache></c:strRef></c:tx>' +
            (line ? '<c:spPr><a:ln w="22225" cap="rnd"><a:solidFill><a:srgbClr val="0969AD"/></a:solidFill><a:round/></a:ln></c:spPr><c:marker><c:symbol val="none"/></c:marker>'
                  : '<c:spPr><a:solidFill><a:srgbClr val="0969AD"/></a:solidFill></c:spPr><c:invertIfNegative val="0"/>') +
            '<c:cat><c:strRef><c:f>' + q + '!$' + catCol + '$2:$' + catCol + '$' + (n + 1) + '</c:f><c:strCache><c:ptCount val="' + n + '"/>' + catPts + '</c:strCache></c:strRef></c:cat>' +
            '<c:val><c:numRef><c:f>' + q + '!$' + valCol + '$2:$' + valCol + '$' + (n + 1) + '</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="' + n + '"/>' + valPts + '</c:numCache></c:numRef></c:val>' +
            (line ? '<c:smooth val="0"/></c:ser><c:marker val="1"/><c:axId val="5001"/><c:axId val="5002"/></c:lineChart>'
                  : '</c:ser><c:gapWidth val="60"/><c:axId val="5001"/><c:axId val="5002"/></c:barChart>') +
            '<c:catAx><c:axId val="5001"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/>' +
            '<c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>' + GREY_LINE +
            '<c:crossAx val="5002"/><c:crosses val="autoZero"/>' +
            '<c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>' +
            '<c:valAx><c:axId val="5002"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines>' + GREY_LINE + '</c:majorGridlines>' +
            '<c:numFmt formatCode="' + (money ? '&quot;₱&quot;#,##0' : '#,##0') + '" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>' +
            '<c:spPr><a:ln><a:noFill/></a:ln></c:spPr><c:crossAx val="5001"/>' +
            '<c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>' +
            '</c:plotArea><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>';
    }

    // the chart sits beside the table, one column to its right, 20 rows high and
    // 10 columns wide (16 for a line of many points)
    function drawingXml(fromCol, wide) {
        return XML + '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
            '<xdr:twoCellAnchor><xdr:from><xdr:col>' + fromCol + '</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>' +
            '<xdr:to><xdr:col>' + (fromCol + (wide ? 16 : 10)) + '</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>21</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>' +
            '<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Chart 1"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>' +
            '<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>' +
            '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">' +
            '<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="' + REL + '" r:id="rId1"/>' +
            '</a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>';
    }

    function sheetXml(sh, heads, first, hasTable, hasChart) {
        var columns = sh.columns, rows = sh.rows, top = 2, end = rows.length + 1, total = sh.total;
        var xml = ['<row r="1">' + heads.map(function (h, i) {
            return '<c r="' + colName(i) + '1" t="inlineStr" s="' + S.header + '"><is><t>' + esc(h) + '</t></is></c>';
        }).join('') + '</row>'];
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
                var range = colName(i) + top + ':' + colName(i) + end;
                var sum = rows.reduce(function (a, r) { return skip && r[skip.col] === skip.equals ? a : a + (Number(r[i]) || 0); }, 0);
                var f = skip
                    ? 'SUMIF(' + colName(skip.col) + top + ':' + colName(skip.col) + end + ',"&lt;&gt;' + esc(skip.equals) + '",' + range + ')'
                    : 'SUM(' + range + ')';
                var s = c.type === 'money' ? S.totalMoney : c.type === 'int' ? S.totalInt : S.totalNumber;
                return '<c r="' + ref + '" s="' + s + '"><f>' + f + '</f><v>' + Math.round(sum * 100) / 100 + '</v></c>';
            }).join('') + '</row>');
        }
        // the table is rId1 and the chart's drawing comes after it
        // printed landscape and one page wide, so a chart prints beside its table
        return XML + '<worksheet ' + NS + '><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' +
            '<sheetViews><sheetView workbookViewId="0"' + (first ? ' tabSelected="1"' : '') + '><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
            '<cols>' + columns.map(function (c, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + (c.width || 14) + '" customWidth="1"/>'; }).join('') + '</cols>' +
            '<sheetData>' + xml.join('') + '</sheetData>' +
            '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>' +
            '<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>' +
            (hasChart ? '<drawing r:id="rId' + (hasTable ? 2 : 1) + '"/>' : '') +
            (hasTable ? '<tableParts count="1"><tablePart r:id="rId1"/></tableParts>' : '') +
            '</worksheet>';
    }

    window.downloadWorkbook = function (filename, sheets) {
        var parts = [], types = [], wbSheets = [], wbRels = [];
        sheets.forEach(function (sh, k) {
            var n = k + 1, name = safeSheet(sh.name, n), heads = uniqueHeads(sh.columns);
            // a table needs at least one row under its header
            var hasTable = sh.rows.length > 0, hasChart = !!(sh.chart && sh.rows.length), sheetRels = [];
            if (hasTable) {
                var ref = 'A1:' + colName(sh.columns.length - 1) + (sh.rows.length + 1), tn = tableName(name, n);
                parts.push({ name: 'xl/tables/table' + n + '.xml', text: XML +
                    '<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="' + n + '" name="' + tn + '" displayName="' + tn + '" ref="' + ref + '" totalsRowShown="0">' +
                    '<autoFilter ref="' + ref + '"/><tableColumns count="' + heads.length + '">' +
                    heads.map(function (h, i) { return '<tableColumn id="' + (i + 1) + '" name="' + esc(h) + '"/>'; }).join('') +
                    '</tableColumns><tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/></table>' });
                types.push(['/xl/tables/table' + n + '.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml']);
                sheetRels.push(['table', '../tables/table' + n + '.xml']);
            }
            if (hasChart) {
                parts.push({ name: 'xl/charts/chart' + n + '.xml', text: chartXml(name, sh, heads) });
                parts.push({ name: 'xl/drawings/drawing' + n + '.xml', text: drawingXml(sh.columns.length + 1, isLine(sh)) });
                parts.push({ name: 'xl/drawings/_rels/drawing' + n + '.xml.rels', text: rels([['chart', '../charts/chart' + n + '.xml']]) });
                types.push(['/xl/charts/chart' + n + '.xml', 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml']);
                types.push(['/xl/drawings/drawing' + n + '.xml', 'application/vnd.openxmlformats-officedocument.drawing+xml']);
                sheetRels.push(['drawing', '../drawings/drawing' + n + '.xml']);
            }
            parts.push({ name: 'xl/worksheets/sheet' + n + '.xml', text: sheetXml(sh, heads, k === 0, hasTable, hasChart) });
            if (sheetRels.length) parts.push({ name: 'xl/worksheets/_rels/sheet' + n + '.xml.rels', text: rels(sheetRels) });
            types.push(['/xl/worksheets/sheet' + n + '.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml']);
            wbSheets.push('<sheet name="' + esc(name) + '" sheetId="' + n + '" r:id="rId' + n + '"/>');
            wbRels.push(['worksheet', 'worksheets/sheet' + n + '.xml']);
        });
        wbRels.push(['styles', 'styles.xml']);
        var files = [
            { name: '[Content_Types].xml', text: XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
                '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
                '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
                '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
                types.map(function (t) { return '<Override PartName="' + t[0] + '" ContentType="' + t[1] + '"/>'; }).join('') + '</Types>' },
            { name: '_rels/.rels', text: rels([['officeDocument', 'xl/workbook.xml']]) },
            { name: 'xl/workbook.xml', text: XML + '<workbook ' + NS + '><sheets>' + wbSheets.join('') + '</sheets></workbook>' },
            { name: 'xl/_rels/workbook.xml.rels', text: rels(wbRels) },
            { name: 'xl/styles.xml', text: STYLES }
        ].concat(parts);
        var url = URL.createObjectURL(zip(files));
        var a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    };

    window.downloadXlsx = function (filename, sheetName, columns, rows, total, chart) {
        window.downloadWorkbook(filename, [{ name: sheetName, columns: columns, rows: rows, total: total, chart: chart }]);
    };
})();
