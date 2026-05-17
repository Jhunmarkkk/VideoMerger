(function () {
  "use strict";

  function err(message) {
    throw new Error(message);
  }

  function readType(view, offset) {
    return String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3)
    );
  }

  function writeType(view, offset, type) {
    for (var i = 0; i < 4; i++) view.setUint8(offset + i, type.charCodeAt(i));
  }

  function readU64(view, offset) {
    var high = view.getUint32(offset);
    var low = view.getUint32(offset + 4);
    return high * 4294967296 + low;
  }

  function writeU64(view, offset, value) {
    view.setUint32(offset, Math.floor(value / 4294967296));
    view.setUint32(offset + 4, value >>> 0);
  }

  function concatArrays(chunks) {
    var total = 0;
    chunks.forEach(function (chunk) { total += chunk.length; });
    var output = new Uint8Array(total);
    var offset = 0;
    chunks.forEach(function (chunk) {
      output.set(chunk, offset);
      offset += chunk.length;
    });
    return output;
  }

  function makeBox(type, payloads) {
    var payload = concatArrays(payloads || []);
    var box = new Uint8Array(payload.length + 8);
    var view = new DataView(box.buffer);
    view.setUint32(0, box.length);
    writeType(view, 4, type);
    box.set(payload, 8);
    return box;
  }

  function cloneBytes(bytes) {
    return new Uint8Array(bytes);
  }

  function parseBoxes(bytes, start, end) {
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var boxes = [];
    var offset = start || 0;
    end = end == null ? bytes.length : end;
    while (offset + 8 <= end) {
      var size = view.getUint32(offset);
      var header = 8;
      if (size === 1) {
        size = readU64(view, offset + 8);
        header = 16;
      } else if (size === 0) {
        size = end - offset;
      }
      if (size < header || offset + size > end) err("Invalid MP4 box layout.");
      boxes.push({ type: readType(view, offset + 4), start: offset, size: size, header: header, end: offset + size });
      offset += size;
    }
    return boxes;
  }

  function children(bytes, box) {
    return parseBoxes(bytes, box.start + box.header, box.end);
  }

  function findChild(bytes, box, type) {
    var list = children(bytes, box);
    for (var i = 0; i < list.length; i++) if (list[i].type === type) return list[i];
    return null;
  }

  function findPath(bytes, box, path) {
    var current = box;
    for (var i = 0; i < path.length; i++) {
      current = findChild(bytes, current, path[i]);
      if (!current) return null;
    }
    return current;
  }

  function getFullBoxVersion(view, box) {
    return view.getUint8(box.start + box.header);
  }

  function readDuration(view, box) {
    var version = getFullBoxVersion(view, box);
    return version === 1 ? readU64(view, box.start + box.header + 20) : view.getUint32(box.start + box.header + 12);
  }

  function writeDuration(view, box, duration) {
    var version = getFullBoxVersion(view, box);
    if (version === 1) writeU64(view, box.start + box.header + 20, duration);
    else view.setUint32(box.start + box.header + 12, duration);
  }

  function readTimescale(view, box) {
    var version = getFullBoxVersion(view, box);
    return view.getUint32(box.start + box.header + (version === 1 ? 16 : 8));
  }

  function readHandler(bytes, trak) {
    var hdlr = findPath(bytes, trak, ["mdia", "hdlr"]);
    if (!hdlr) return "";
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return readType(view, hdlr.start + hdlr.header + 8);
  }

  function readEntryTable(bytes, box, fields) {
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var count = view.getUint32(box.start + box.header + 4);
    var offset = box.start + box.header + 8;
    var entries = [];
    for (var i = 0; i < count; i++) {
      var entry = {};
      fields.forEach(function (field) {
        entry[field] = view.getUint32(offset);
        offset += 4;
      });
      entries.push(entry);
    }
    return entries;
  }

  function readStsz(bytes, box) {
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var sampleSize = view.getUint32(box.start + box.header + 4);
    var sampleCount = view.getUint32(box.start + box.header + 8);
    var sizes = [];
    if (sampleSize) {
      for (var i = 0; i < sampleCount; i++) sizes.push(sampleSize);
    } else {
      var offset = box.start + box.header + 12;
      for (var j = 0; j < sampleCount; j++) {
        sizes.push(view.getUint32(offset));
        offset += 4;
      }
    }
    return sizes;
  }

  function readStco(bytes, box) {
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var count = view.getUint32(box.start + box.header + 4);
    var offset = box.start + box.header + 8;
    var values = [];
    for (var i = 0; i < count; i++) {
      values.push(box.type === "co64" ? readU64(view, offset) : view.getUint32(offset));
      offset += box.type === "co64" ? 8 : 4;
    }
    return values;
  }

  function readStss(bytes, box) {
    if (!box) return null;
    return readEntryTable(bytes, box, ["sample_number"]).map(function (entry) { return entry.sample_number; });
  }

  function fullHeader(sourceBytes, box) {
    return cloneBytes(sourceBytes.subarray(box.start + 8, box.start + box.header + 4));
  }

  function tableBox(type, sourceBytes, sourceBox, entries, fields) {
    var header = fullHeader(sourceBytes, sourceBox);
    var payload = new Uint8Array(header.length + 4 + entries.length * fields.length * 4);
    var view = new DataView(payload.buffer);
    payload.set(header, 0);
    view.setUint32(header.length, entries.length);
    var offset = header.length + 4;
    entries.forEach(function (entry) {
      fields.forEach(function (field) {
        view.setUint32(offset, entry[field]);
        offset += 4;
      });
    });
    return makeBox(type, [payload]);
  }

  function stszBox(sourceBytes, sourceBox, sizes) {
    var header = fullHeader(sourceBytes, sourceBox);
    var payload = new Uint8Array(header.length + 8 + sizes.length * 4);
    var view = new DataView(payload.buffer);
    payload.set(header, 0);
    view.setUint32(header.length, 0);
    view.setUint32(header.length + 4, sizes.length);
    var offset = header.length + 8;
    sizes.forEach(function (size) {
      view.setUint32(offset, size);
      offset += 4;
    });
    return makeBox("stsz", [payload]);
  }

  function stcoBox(sourceBytes, sourceBox, offsets) {
    var header = fullHeader(sourceBytes, sourceBox);
    var payload = new Uint8Array(header.length + 4 + offsets.length * 4);
    var view = new DataView(payload.buffer);
    payload.set(header, 0);
    view.setUint32(header.length, offsets.length);
    var offset = header.length + 4;
    offsets.forEach(function (value) {
      if (value > 4294967295) err("Merged file is too large for this lightweight MP4 joiner.");
      view.setUint32(offset, value);
      offset += 4;
    });
    return makeBox("stco", [payload]);
  }

  function stssBox(sourceBytes, sourceBox, samples) {
    if (!sourceBox || !samples) return null;
    return tableBox("stss", sourceBytes, sourceBox, samples.map(function (n) {
      return { sample_number: n };
    }), ["sample_number"]);
  }

  function mergeRunTables(tables, fieldNames, mergeField) {
    var output = [];
    tables.forEach(function (table) {
      table.forEach(function (entry) {
        var copy = {};
        fieldNames.forEach(function (field) { copy[field] = entry[field]; });
        var last = output[output.length - 1];
        if (last && last[mergeField] === copy[mergeField]) last.sample_count += copy.sample_count;
        else output.push(copy);
      });
    });
    return output;
  }

  function sampleCountFromStts(stts) {
    return stts.reduce(function (sum, entry) { return sum + entry.sample_count; }, 0);
  }

  function durationFromStts(stts) {
    return stts.reduce(function (sum, entry) { return sum + entry.sample_count * entry.sample_delta; }, 0);
  }

  function parseTrack(bytes, trak) {
    var stbl = findPath(bytes, trak, ["mdia", "minf", "stbl"]);
    if (!stbl) err("Unsupported MP4: missing sample table.");
    var stts = findChild(bytes, stbl, "stts");
    var stsc = findChild(bytes, stbl, "stsc");
    var stsz = findChild(bytes, stbl, "stsz");
    var stco = findChild(bytes, stbl, "stco") || findChild(bytes, stbl, "co64");
    if (!stts || !stsc || !stsz || !stco) err("Unsupported MP4: missing timing or chunk table.");
    return {
      trak: trak,
      handler: readHandler(bytes, trak),
      mdhd: findPath(bytes, trak, ["mdia", "mdhd"]),
      tkhd: findChild(bytes, trak, "tkhd"),
      stbl: stbl,
      sttsBox: stts,
      cttsBox: findChild(bytes, stbl, "ctts"),
      stscBox: stsc,
      stszBox: stsz,
      stcoBox: stco,
      stssBox: findChild(bytes, stbl, "stss"),
      stts: readEntryTable(bytes, stts, ["sample_count", "sample_delta"]),
      ctts: findChild(bytes, stbl, "ctts") ? readEntryTable(bytes, findChild(bytes, stbl, "ctts"), ["sample_count", "sample_offset"]) : null,
      stsc: readEntryTable(bytes, stsc, ["first_chunk", "samples_per_chunk", "sample_description_index"]),
      stsz: readStsz(bytes, stsz),
      stco: readStco(bytes, stco),
      stss: readStss(bytes, findChild(bytes, stbl, "stss"))
    };
  }

  function parseFile(buffer, name) {
    var bytes = new Uint8Array(buffer);
    var top = parseBoxes(bytes);
    var ftyp = top.filter(function (box) { return box.type === "ftyp"; })[0];
    var moov = top.filter(function (box) { return box.type === "moov"; })[0];
    var mdats = top.filter(function (box) { return box.type === "mdat"; });
    if (!ftyp || !moov || mdats.length !== 1) err(name + " is not a supported simple MP4.");
    var mdat = mdats[0];
    var traks = children(bytes, moov).filter(function (box) { return box.type === "trak"; });
    return {
      name: name,
      bytes: bytes,
      ftyp: ftyp,
      moov: moov,
      mdat: mdat,
      mdatDataStart: mdat.start + mdat.header,
      mdatPayload: bytes.subarray(mdat.start + mdat.header, mdat.end),
      mvhd: findChild(bytes, moov, "mvhd"),
      tracks: traks.map(function (trak) { return parseTrack(bytes, trak); })
    };
  }

  function compatible(files) {
    var base = files[0];
    files.slice(1).forEach(function (file) {
      if (file.tracks.length !== base.tracks.length) err(file.name + " has a different track count.");
      file.tracks.forEach(function (track, index) {
        var other = base.tracks[index];
        if (track.handler !== other.handler) err(file.name + " has tracks in a different order.");
        var viewA = new DataView(file.bytes.buffer, file.bytes.byteOffset, file.bytes.byteLength);
        var viewB = new DataView(base.bytes.buffer, base.bytes.byteOffset, base.bytes.byteLength);
        if (readTimescale(viewA, track.mdhd) !== readTimescale(viewB, other.mdhd)) {
          err(file.name + " uses a different video/audio timescale.");
        }
      });
    });
  }

  function rewriteContainer(sourceBytes, box, replacements) {
    var pieces = [];
    children(sourceBytes, box).forEach(function (child) {
      if (replacements[child.start]) pieces.push(replacements[child.start]);
      else pieces.push(sourceBytes.subarray(child.start, child.end));
    });
    return makeBox(box.type, pieces);
  }

  function buildTrack(files, trackIndex, firstTrack, baseMoovShift, fileDataStarts, movieTimescale) {
    var firstBytes = files[0].bytes;
    var sampleOffset = 0;
    var chunkOffset = 0;
    var sttsTables = [];
    var cttsTables = [];
    var stscTables = [];
    var sizes = [];
    var offsets = [];
    var syncSamples = firstTrack.stss ? [] : null;

    files.forEach(function (file, fileIndex) {
      var track = file.tracks[trackIndex];
      sttsTables.push(track.stts);
      if (firstTrack.ctts) {
        if (!track.ctts) err(file.name + " is missing composition timing.");
        cttsTables.push(track.ctts);
      }
      track.stsc.forEach(function (entry) {
        stscTables.push({
          first_chunk: entry.first_chunk + chunkOffset,
          samples_per_chunk: entry.samples_per_chunk,
          sample_description_index: entry.sample_description_index
        });
      });
      sizes = sizes.concat(track.stsz);
      track.stco.forEach(function (offset) {
        offsets.push(fileDataStarts[fileIndex] + (offset - file.mdatDataStart));
      });
      if (syncSamples && track.stss) {
        track.stss.forEach(function (sample) { syncSamples.push(sample + sampleOffset); });
      }
      sampleOffset += sampleCountFromStts(track.stts);
      chunkOffset += track.stco.length;
    });

    var newStts = tableBox("stts", firstBytes, firstTrack.sttsBox, mergeRunTables(sttsTables, ["sample_count", "sample_delta"], "sample_delta"), ["sample_count", "sample_delta"]);
    var newStsc = tableBox("stsc", firstBytes, firstTrack.stscBox, stscTables, ["first_chunk", "samples_per_chunk", "sample_description_index"]);
    var newStsz = stszBox(firstBytes, firstTrack.stszBox, sizes);
    var newStco = stcoBox(firstBytes, firstTrack.stcoBox, offsets.map(function (offset) { return offset + baseMoovShift; }));
    var newStss = stssBox(firstBytes, firstTrack.stssBox, syncSamples);
    var replacements = {};
    replacements[firstTrack.sttsBox.start] = newStts;
    replacements[firstTrack.stscBox.start] = newStsc;
    replacements[firstTrack.stszBox.start] = newStsz;
    replacements[firstTrack.stcoBox.start] = newStco;
    if (firstTrack.cttsBox) {
      replacements[firstTrack.cttsBox.start] = tableBox("ctts", firstBytes, firstTrack.cttsBox, mergeRunTables(cttsTables, ["sample_count", "sample_offset"], "sample_offset"), ["sample_count", "sample_offset"]);
    }
    if (newStss) replacements[firstTrack.stssBox.start] = newStss;

    var newStbl = rewriteContainer(firstBytes, firstTrack.stbl, replacements);
    replacements = {};
    replacements[firstTrack.stbl.start] = newStbl;
    var minf = findPath(firstBytes, firstTrack.trak, ["mdia", "minf"]);
    var newMinf = rewriteContainer(firstBytes, minf, replacements);
    replacements = {};
    replacements[minf.start] = newMinf;
    var mdia = findChild(firstBytes, firstTrack.trak, "mdia");
    var newMdia = rewriteContainer(firstBytes, mdia, replacements);
    replacements = {};
    replacements[mdia.start] = newMdia;
    var newTrak = rewriteContainer(firstBytes, firstTrack.trak, replacements);

    var trakCopy = cloneBytes(newTrak);
    var view = new DataView(trakCopy.buffer);
    var trakBox = parseBoxes(trakCopy)[0];
    var mdhd = findPath(trakCopy, trakBox, ["mdia", "mdhd"]);
    var tkhd = findChild(trakCopy, trakBox, "tkhd");
    var mediaDuration = files.reduce(function (sum, file) {
      return sum + durationFromStts(file.tracks[trackIndex].stts);
    }, 0);
    var movieDuration = files.reduce(function (sum, file) {
      var fileView = new DataView(file.bytes.buffer, file.bytes.byteOffset, file.bytes.byteLength);
      var timescale = readTimescale(fileView, file.tracks[trackIndex].mdhd);
      return sum + durationFromStts(file.tracks[trackIndex].stts) * movieTimescale / timescale;
    }, 0);
    writeDuration(view, mdhd, mediaDuration);
    if (tkhd) writeDuration(view, tkhd, Math.round(movieDuration));
    return trakCopy;
  }

  function buildMoov(files, moovShift, fileDataStarts) {
    var first = files[0];
    var replacements = {};
    var firstView = new DataView(first.bytes.buffer, first.bytes.byteOffset, first.bytes.byteLength);
    var movieTimescale = readTimescale(firstView, first.mvhd);
    first.tracks.forEach(function (track, index) {
      replacements[track.trak.start] = buildTrack(files, index, track, moovShift, fileDataStarts, movieTimescale);
    });
    var moov = rewriteContainer(first.bytes, first.moov, replacements);
    var view = new DataView(moov.buffer);
    var moovBox = parseBoxes(moov)[0];
    var mvhd = findChild(moov, moovBox, "mvhd");
    var maxDuration = 0;
    first.tracks.forEach(function (_track, index) {
      var total = 0;
      files.forEach(function (file) {
        var view = new DataView(file.bytes.buffer, file.bytes.byteOffset, file.bytes.byteLength);
        var timescale = readTimescale(view, file.tracks[index].mdhd);
        total += durationFromStts(file.tracks[index].stts) * movieTimescale / timescale;
      });
      maxDuration = Math.max(maxDuration, Math.round(total));
    });
    writeDuration(view, mvhd, maxDuration);
    return moov;
  }

  function makeMdat(payloads) {
    var size = 8 + payloads.reduce(function (sum, chunk) { return sum + chunk.length; }, 0);
    if (size > 4294967295) err("Merged video is too large for this lightweight joiner.");
    var header = new Uint8Array(8);
    var view = new DataView(header.buffer);
    view.setUint32(0, size);
    writeType(view, 4, "mdat");
    return concatArrays([header].concat(payloads));
  }

  function readFileBuffer(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(new Error("Could not read " + file.name + ".")); };
      reader.readAsArrayBuffer(file);
    });
  }

  async function mergeMp4Files(fileEntries, onProgress) {
    if (!fileEntries.length) err("No files selected.");
    var parsed = [];
    for (var i = 0; i < fileEntries.length; i++) {
      var file = fileEntries[i].file;
      if (!/\.mp4$/i.test(file.name)) err("Lightweight mode only supports .mp4 files.");
      onProgress(8 + i / fileEntries.length * 32, "Reading " + (i + 1) + " of " + fileEntries.length + "...");
      parsed.push(parseFile(await readFileBuffer(file), file.name));
    }
    compatible(parsed);

    var ftyp = cloneBytes(parsed[0].bytes.subarray(parsed[0].ftyp.start, parsed[0].ftyp.end));
    var fileDataStarts = [];
    var cursor = ftyp.length + 8;
    parsed.forEach(function (file) {
      fileDataStarts.push(cursor);
      cursor += file.mdatPayload.length;
    });

    onProgress(48, "Building MP4 tables...");
    var moov = buildMoov(parsed, 0, fileDataStarts);
    var finalMoov = buildMoov(parsed, moov.length, fileDataStarts);
    var mdat = makeMdat(parsed.map(function (file) { return file.mdatPayload; }));

    onProgress(84, "Preparing download...");
    return new Blob([ftyp, finalMoov, mdat], { type: "video/mp4" });
  }

  window.LightweightMp4Joiner = { merge: mergeMp4Files };
})();
