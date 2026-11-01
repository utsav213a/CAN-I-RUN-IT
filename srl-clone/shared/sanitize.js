'use strict';

// The ONLY fields that may leave the user's machine. The scanner runs this before
// showing the preview, and the server runs it again on receipt, so anything not
// listed here (username, PC name, IP, MAC, serials, product key, files, ...) is dropped.
const STORAGE_TYPES = ['SSD', 'HDD', 'NVMe', 'Unknown'];

function text(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
}

function num(value, min, max) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function obj(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function sanitizeScan(input) {
  const src = obj(input);
  const cpu = obj(src.cpu);
  const os = obj(src.os);
  const resolution = obj(src.resolution);
  const gpus = Array.isArray(src.gpus) ? src.gpus : [];
  const storage = Array.isArray(src.storage) ? src.storage : [];

  return {
    schemaVersion: 1,
    approximate: src.approximate === true,
    cpu: {
      name: text(cpu.name, 120),
      cores: num(cpu.cores, 1, 512),
      threads: num(cpu.threads, 1, 1024),
      speedMHz: num(cpu.speedMHz, 0, 20000),
    },
    gpus: gpus
      .slice(0, 8)
      .map((g) => ({ name: text(obj(g).name, 120), vramMB: num(obj(g).vramMB, 0, 1048576) }))
      .filter((g) => g.name),
    ramGB: num(src.ramGB, 0, 4096),
    os: { name: text(os.name, 120), version: text(os.version, 40), is64: os.is64 === true },
    storage: storage
      .slice(0, 16)
      .map((d) => ({
        type: STORAGE_TYPES.includes(obj(d).type) ? obj(d).type : 'Unknown',
        freeGB: num(obj(d).freeGB, 0, 1048576),
      })),
    directX: num(src.directX, 0, 99),
    vulkan: src.vulkan === true ? true : src.vulkan === false ? false : null,
    resolution: {
      width: num(resolution.width, 0, 20000),
      height: num(resolution.height, 0, 20000),
    },
  };
}

// A scan is usable when we know the CPU, RAM and at least one GPU.
function validateScan(scan) {
  if (!scan.cpu.name) return 'CPU name is required';
  if (scan.ramGB === null) return 'RAM amount is required';
  if (!scan.gpus.length) return 'At least one GPU is required';
  return null;
}

module.exports = { sanitizeScan, validateScan };
