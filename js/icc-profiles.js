/**
 * icc-profiles.js
 * Generates minimal valid ICC v2 profiles entirely in JavaScript.
 * No file I/O needed — everything runs in-browser, privacy-safe.
 *
 * Profiles included:
 *   - sRGB (Stock Standard)   — IEC 61966-2-1 primaries
 *   - Adobe RGB (1998)        — wider gamut, D65
 *   - Apple RGB               — legacy Apple display
 *   - ColorMatch RGB          — Radius PressView primaries
 */

const IccProfiles = (() => {
  // ---- low-level binary helpers ----
  function u8(v) { return v & 0xff; }
  function u16be(v) { return [(v >> 8) & 0xff, v & 0xff]; }
  function u32be(v) { return [(v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]; }

  function s15f16(v) {
    // ICC s15Fixed16Number: 16-bit integer + 16-bit fraction
    const i = Math.trunc(v);
    const f = Math.round((v - i) * 65536);
    return [...u16be(i & 0xffff), ...u16be(f & 0xffff)];
  }

  function tag(sig, data) {
    const s = sig.split('').map(c => c.charCodeAt(0));
    return [...s, ...data];
  }

  function asciiTag(sig, text) {
    const padded = (text + '                ').slice(0, Math.max(text.length, 1));
    return tag(sig, [
      0, 0, 0, 0, // type 'mluc' would be longer; use 'desc' v2
      ...padded.split('').map(c => c.charCodeAt(0)),
      0
    ]);
  }

  /**
   * Build a minimal ICC v2 RGB profile.
   * primaries: { rx,ry, gx,gy, bx,by } — CIE xy chromaticities
   * whitepoint: { x, y } — CIE xy
   * gamma: number (e.g. 2.2)
   * description: string
   */
  function buildProfile({ primaries, whitepoint, gamma, description }) {
    // Convert xy chromaticity to XYZ (Y=1)
    function xyToXYZ(x, y) {
      return { X: x / y, Y: 1.0, Z: (1 - x - y) / y };
    }

    const wp = xyToXYZ(whitepoint.x, whitepoint.y);

    // Compute RGB to XYZ matrix (Bradford-adapted to D50 for ICC)
    // For simplicity use approximate D65->D50 Bradford adaptation
    const brad = [
      [ 1.0478112,  0.0228866, -0.0501270],
      [ 0.0295424,  0.9904844, -0.0170491],
      [-0.0092345,  0.0150436,  0.7521316],
    ];

    function mat3x3mul(m, v) {
      return [
        m[0][0]*v[0] + m[0][1]*v[1] + m[0][2]*v[2],
        m[1][0]*v[0] + m[1][1]*v[1] + m[1][2]*v[2],
        m[2][0]*v[0] + m[2][1]*v[1] + m[2][2]*v[2],
      ];
    }

    function adaptToD50(xyz) {
      const v = mat3x3mul(brad, [xyz.X, xyz.Y, xyz.Z]);
      return { X: v[0], Y: v[1], Z: v[2] };
    }

    // Primary XYZ (relative to white)
    const rXYZ_d65 = xyToXYZ(primaries.rx, primaries.ry);
    const gXYZ_d65 = xyToXYZ(primaries.gx, primaries.gy);
    const bXYZ_d65 = xyToXYZ(primaries.bx, primaries.by);
    const wXYZ_d65 = wp;

    // Scale each primary so that R+G+B white = illuminant white
    // Solve: [rXYZ gXYZ bXYZ] * [Sr Sg Sb]^T = wXYZ
    function det3(a) {
      return a[0][0]*(a[1][1]*a[2][2]-a[1][2]*a[2][1])
           - a[0][1]*(a[1][0]*a[2][2]-a[1][2]*a[2][0])
           + a[0][2]*(a[1][0]*a[2][1]-a[1][1]*a[2][0]);
    }
    function inv3(a) {
      const d = det3(a);
      return [
        [(a[1][1]*a[2][2]-a[1][2]*a[2][1])/d, (a[0][2]*a[2][1]-a[0][1]*a[2][2])/d, (a[0][1]*a[1][2]-a[0][2]*a[1][1])/d],
        [(a[1][2]*a[2][0]-a[1][0]*a[2][2])/d, (a[0][0]*a[2][2]-a[0][2]*a[2][0])/d, (a[0][2]*a[1][0]-a[0][0]*a[1][2])/d],
        [(a[1][0]*a[2][1]-a[1][1]*a[2][0])/d, (a[0][1]*a[2][0]-a[0][0]*a[2][1])/d, (a[0][0]*a[1][1]-a[0][1]*a[1][0])/d],
      ];
    }

    const M = [
      [rXYZ_d65.X, gXYZ_d65.X, bXYZ_d65.X],
      [rXYZ_d65.Y, gXYZ_d65.Y, bXYZ_d65.Y],
      [rXYZ_d65.Z, gXYZ_d65.Z, bXYZ_d65.Z],
    ];
    const Mi = inv3(M);
    const S = mat3x3mul(Mi, [wXYZ_d65.X, wXYZ_d65.Y, wXYZ_d65.Z]);

    const rXYZ = { X: rXYZ_d65.X*S[0], Y: rXYZ_d65.Y*S[0], Z: rXYZ_d65.Z*S[0] };
    const gXYZ = { X: gXYZ_d65.X*S[1], Y: gXYZ_d65.Y*S[1], Z: gXYZ_d65.Z*S[1] };
    const bXYZ = { X: bXYZ_d65.X*S[2], Y: bXYZ_d65.Y*S[2], Z: bXYZ_d65.Z*S[2] };

    // Adapt to D50
    const rD50 = adaptToD50(rXYZ);
    const gD50 = adaptToD50(gXYZ);
    const bD50 = adaptToD50(bXYZ);
    const wD50 = adaptToD50(wXYZ_d65);

    // --- Build tag data ---
    // XYZ tag: type 'XYZ ' + 4 bytes reserved + 3 x s15Fixed16
    function xyzTagData(xyz) {
      return [
        0x58, 0x59, 0x5a, 0x20, // 'XYZ '
        0,0,0,0,                 // reserved
        ...s15f16(xyz.X),
        ...s15f16(xyz.Y),
        ...s15f16(xyz.Z),
      ];
    }

    // Gamma curve: type 'curv' + reserved + count=1 + gamma as u8Fixed8
    function curveTagData(g) {
      const gVal = Math.round(g * 256);
      return [
        0x63, 0x75, 0x72, 0x76, // 'curv'
        0,0,0,0,                  // reserved
        0,0,0,1,                  // count=1
        ...u16be(gVal),
      ];
    }

    // text tag: 'text' + reserved + ASCII
    function textTagData(s) {
      const bytes = s.split('').map(c => c.charCodeAt(0));
      return [0x74,0x65,0x78,0x74, 0,0,0,0, ...bytes, 0];
    }

    // desc tag (v2 'desc'): type + reserved + len + ascii + ...
    function descTagData(s) {
      const ascii = s.split('').map(c => c.charCodeAt(0));
      const asciiLen = ascii.length + 1;
      return [
        0x64,0x65,0x73,0x63, // 'desc'
        0,0,0,0,
        ...u32be(asciiLen),
        ...ascii, 0,
        0,0,0,0,0,0,0,0,0,0,0,0, // unicode + scriptcode placeholders
      ];
    }

    // mediaWhitePoint uses D50
    const D50 = { X: 0.9642, Y: 1.0000, Z: 0.8249 };

    // ---- Tag table ----
    const tags = [
      { sig: 'rXYZ', data: xyzTagData(rD50) },
      { sig: 'gXYZ', data: xyzTagData(gD50) },
      { sig: 'bXYZ', data: xyzTagData(bD50) },
      { sig: 'rTRC', data: curveTagData(gamma) },
      { sig: 'gTRC', data: curveTagData(gamma) },
      { sig: 'bTRC', data: curveTagData(gamma) },
      { sig: 'wtpt', data: xyzTagData(D50) },
      { sig: 'cprt', data: textTagData('No copyright') },
      { sig: 'desc', data: descTagData(description) },
    ];

    // ---- Compute offsets ----
    const headerSize = 128;
    const tagCountSize = 4;
    const tagEntrySize = 12; // sig(4) + offset(4) + size(4)
    const tagTableSize = tagCountSize + tags.length * tagEntrySize;

    let offset = headerSize + tagTableSize;
    const offsets = [];
    for (const t of tags) {
      offsets.push(offset);
      offset += t.data.length;
      // Align to 4 bytes
      if (t.data.length % 4 !== 0) offset += 4 - (t.data.length % 4);
    }

    const totalSize = offset;

    // ---- Build bytes ----
    const bytes = new Uint8Array(totalSize);
    const dv = new DataView(bytes.buffer);

    // Header (128 bytes)
    dv.setUint32(0, totalSize);                // profile size
    dv.setUint32(4, 0);                        // preferred CMM
    dv.setUint32(8, 0x02100000);               // version 2.1
    // profile/device class
    bytes[12] = 0x6d; bytes[13] = 0x6e; bytes[14] = 0x72; bytes[15] = 0x63; // 'mnrc' = display
    // Actually correct class for display: 'mntr'
    bytes[12] = 0x6d; bytes[13] = 0x6e; bytes[14] = 0x74; bytes[15] = 0x72; // 'mntr'
    // color space
    bytes[16] = 0x52; bytes[17] = 0x47; bytes[18] = 0x42; bytes[19] = 0x20; // 'RGB '
    // PCS
    bytes[20] = 0x58; bytes[21] = 0x59; bytes[22] = 0x5a; bytes[23] = 0x20; // 'XYZ '
    // date/time (zeroed)
    // platform sig
    bytes[40] = 0x61; bytes[41] = 0x70; bytes[42] = 0x70; bytes[43] = 0x6c; // 'appl'
    // flags, device manufacturer, model — all zero
    // rendering intent: perceptual = 0
    // PCS illuminant (D50)
    dv.setInt32(68, Math.round(0.9642 * 65536));
    dv.setInt32(72, Math.round(1.0000 * 65536));
    dv.setInt32(76, Math.round(0.8249 * 65536));

    // Tag count
    let pos = headerSize;
    dv.setUint32(pos, tags.length); pos += 4;

    // Tag entries
    for (let i = 0; i < tags.length; i++) {
      const sig = tags[i].sig;
      for (let j = 0; j < 4; j++) bytes[pos + j] = sig.charCodeAt(j);
      dv.setUint32(pos + 4, offsets[i]);
      dv.setUint32(pos + 8, tags[i].data.length);
      pos += 12;
    }

    // Tag data
    for (let i = 0; i < tags.length; i++) {
      for (let j = 0; j < tags[i].data.length; j++) {
        bytes[offsets[i] + j] = tags[i].data[j];
      }
    }

    return bytes;
  }

  // ---- Profile definitions ----
  const PROFILES = {
    'sRGB': buildProfile({
      description: 'sRGB IEC61966-2-1',
      primaries: { rx:0.64, ry:0.33, gx:0.30, gy:0.60, bx:0.15, by:0.06 },
      whitepoint: { x:0.3127, y:0.3290 },
      gamma: 2.2,
    }),
    'AdobeRGB1998': buildProfile({
      description: 'Adobe RGB (1998)',
      primaries: { rx:0.64, ry:0.33, gx:0.21, gy:0.71, bx:0.15, by:0.06 },
      whitepoint: { x:0.3127, y:0.3290 },
      gamma: 2.2,
    }),
    'AppleRGB': buildProfile({
      description: 'Apple RGB',
      primaries: { rx:0.625, ry:0.340, gx:0.280, gy:0.595, bx:0.155, by:0.070 },
      whitepoint: { x:0.3127, y:0.3290 },
      gamma: 1.8,
    }),
    'ColorMatchRGB': buildProfile({
      description: 'ColorMatch RGB',
      primaries: { rx:0.630, ry:0.340, gx:0.295, gy:0.605, bx:0.150, by:0.075 },
      whitepoint: { x:0.3457, y:0.3585 }, // D50
      gamma: 1.8,
    }),
  };

  function getProfile(name) {
    return PROFILES[name] || PROFILES['sRGB'];
  }

  /**
   * Embed ICC profile into a PNG file (Uint8Array).
   * Inserts an iCCP chunk right after the IHDR chunk.
   */
  function embedIccIntoPng(pngBytes, profileName, iccBytes) {
    // PNG signature: 8 bytes
    // Each chunk: length(4) + type(4) + data(length) + crc(4)
    const sig = [137,80,78,71,13,10,26,10];
    const enc = new TextEncoder();

    // Find insertion point (after IHDR chunk = after sig + 4+4+13+4 = 33 bytes)
    const insertAt = 8 + 4 + 4 + 13 + 4; // 33

    // Build iCCP chunk
    const profileNameBytes = enc.encode(profileName + '\0'); // null-terminated
    // compression method = 0 (deflate), then compressed data
    // For simplicity, store uncompressed using deflate level 0
    const compressedIcc = deflateRaw(iccBytes);
    const chunkData = new Uint8Array(profileNameBytes.length + 1 + compressedIcc.length);
    chunkData.set(profileNameBytes, 0);
    chunkData[profileNameBytes.length] = 0; // compression method
    chunkData.set(compressedIcc, profileNameBytes.length + 1);

    const chunkType = enc.encode('iCCP');
    const chunkLen = chunkData.length;
    const crc = crc32(new Uint8Array([...chunkType, ...chunkData]));

    const chunk = new Uint8Array(4 + 4 + chunkLen + 4);
    new DataView(chunk.buffer).setUint32(0, chunkLen);
    chunk.set(chunkType, 4);
    chunk.set(chunkData, 8);
    new DataView(chunk.buffer).setUint32(8 + chunkLen, crc >>> 0);

    // Reconstruct PNG
    const result = new Uint8Array(pngBytes.length + chunk.length);
    result.set(pngBytes.slice(0, insertAt), 0);
    result.set(chunk, insertAt);
    result.set(pngBytes.slice(insertAt), insertAt + chunk.length);
    return result;
  }

  /**
   * Embed ICC profile into JPEG (Uint8Array).
   * Inserts APP2 marker right after SOI.
   */
  function embedIccIntoJpeg(jpegBytes, iccBytes) {
    // JPEG APP2 ICC: FF E2 + length(2) + 'ICC_PROFILE\0' + seq(1) + total(1) + data
    // For profiles < 65519 bytes (one chunk suffices)
    const marker = new Uint8Array([0xFF, 0xE2]);
    const id = new TextEncoder().encode('ICC_PROFILE\0');
    const seq = new Uint8Array([1, 1]); // chunk 1 of 1
    const payloadLen = id.length + seq.length + iccBytes.length;
    const totalLen = 2 + payloadLen; // length field includes itself

    const app2 = new Uint8Array(2 + 2 + payloadLen);
    app2[0] = 0xFF; app2[1] = 0xE2;
    new DataView(app2.buffer).setUint16(2, totalLen);
    app2.set(id, 4);
    app2.set(seq, 4 + id.length);
    app2.set(iccBytes, 4 + id.length + seq.length);

    // Insert after SOI (FF D8)
    const result = new Uint8Array(jpegBytes.length + app2.length);
    result.set(jpegBytes.slice(0, 2), 0);
    result.set(app2, 2);
    result.set(jpegBytes.slice(2), 2 + app2.length);
    return result;
  }

  // --- Minimal CRC-32 ---
  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })();

  function crc32(data) {
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  // --- Minimal deflate (store only, level 0) ---
  function deflateRaw(data) {
    // zlib header + deflate stored blocks + adler32
    const BSIZE = 65535;
    const blocks = Math.ceil(data.length / BSIZE) || 1;
    const out = [];
    // zlib header: CMF=0x78 (deflate, window=32k), FLG
    out.push(0x78, 0x9C);
    let pos = 0;
    for (let i = 0; i < blocks; i++) {
      const last = i === blocks - 1 ? 1 : 0;
      const blockData = data.slice(pos, pos + BSIZE);
      const len = blockData.length;
      out.push(last); // BFINAL + BTYPE=00 (no compression)
      out.push(len & 0xff, (len >> 8) & 0xff);
      out.push((~len) & 0xff, ((~len) >> 8) & 0xff);
      for (let j = 0; j < len; j++) out.push(blockData[j]);
      pos += BSIZE;
    }
    // Adler-32
    let s1 = 1, s2 = 0;
    for (let i = 0; i < data.length; i++) {
      s1 = (s1 + data[i]) % 65521;
      s2 = (s2 + s1) % 65521;
    }
    const adler = (s2 << 16) | s1;
    out.push((adler >> 24) & 0xff, (adler >> 16) & 0xff, (adler >> 8) & 0xff, adler & 0xff);
    return new Uint8Array(out);
  }

  return { getProfile, embedIccIntoPng, embedIccIntoJpeg, PROFILES };
})();

window.IccProfiles = IccProfiles;
