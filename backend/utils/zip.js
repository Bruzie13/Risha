/**
 * Minimal single-file ZIP writer.
 *
 * The daily backup used to go out as .json.gz and Brevo rejected every one of
 * them ("Unsupported file format: gz"), so the backup email silently failed
 * each day. Brevo does accept .zip, and .zip also opens with a double-click on
 * the Windows machines the shop runs — .gz does not.
 *
 * Only what a one-entry archive needs: local header, deflated data, central
 * directory, end-of-central-directory. No dependency, no streaming, no
 * Zip64 — a backup that outgrew 4 GB would have other problems.
 */
const zlib = require('zlib');

// CRC-32 (IEEE 802.3), the checksum ZIP stores for each entry.
let CRC_TABLE = null;
function crcTable() {
    if (CRC_TABLE) return CRC_TABLE;
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        CRC_TABLE[n] = c;
    }
    return CRC_TABLE;
}

function crc32(buf) {
    const table = crcTable();
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ table[(c ^ buf[i]) & 0xFF];
    return (c ^ -1) >>> 0;
}

// MS-DOS date/time, which is what the ZIP format still records.
function dosDateTime(date) {
    const time = ((date.getHours() & 0x1F) << 11)
        | ((date.getMinutes() & 0x3F) << 5)
        | ((Math.floor(date.getSeconds() / 2)) & 0x1F);
    const day = (((date.getFullYear() - 1980) & 0x7F) << 9)
        | (((date.getMonth() + 1) & 0x0F) << 5)
        | (date.getDate() & 0x1F);
    return { time, day };
}

/**
 * Wrap one file in a ZIP archive.
 * @param {string} filename  name the file has inside the archive
 * @param {Buffer} content   the bytes to store
 * @param {Date}   [when]    timestamp recorded for the entry
 * @returns {Buffer} the .zip
 */
function zipSingleFile(filename, content, when = new Date()) {
    const name = Buffer.from(filename, 'utf8');
    const deflated = zlib.deflateRawSync(content, { level: 9 });
    const crc = crc32(content);
    const { time, day } = dosDateTime(when);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034B50, 0);   // local file header signature
    local.writeUInt16LE(20, 4);           // version needed (2.0 = deflate)
    local.writeUInt16LE(0, 6);            // flags
    local.writeUInt16LE(8, 8);            // method: deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);           // extra field length

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014B50, 0); // central directory header signature
    central.writeUInt16LE(20, 4);         // version made by
    central.writeUInt16LE(20, 6);         // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(deflated.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);         // extra
    central.writeUInt16LE(0, 32);         // comment
    central.writeUInt16LE(0, 34);         // disk number
    central.writeUInt16LE(0, 36);         // internal attrs
    central.writeUInt32LE(0, 38);         // external attrs
    central.writeUInt32LE(0, 42);         // offset of local header

    const centralSize = central.length + name.length;
    const centralOffset = local.length + name.length + deflated.length;

    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054B50, 0);     // end of central directory signature
    end.writeUInt16LE(0, 4);              // this disk
    end.writeUInt16LE(0, 6);              // disk with central directory
    end.writeUInt16LE(1, 8);              // entries on this disk
    end.writeUInt16LE(1, 10);             // entries total
    end.writeUInt32LE(centralSize, 12);
    end.writeUInt32LE(centralOffset, 16);
    end.writeUInt16LE(0, 20);             // comment length

    return Buffer.concat([local, name, deflated, central, name, end]);
}

module.exports = { zipSingleFile, crc32 };
