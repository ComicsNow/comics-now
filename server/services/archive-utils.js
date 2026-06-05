const yauzl = require('yauzl');
const { createExtractorFromData } = require('node-unrar-js');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { isImage } = require('../utils');

function isSafeEntry(name) {
    if (typeof name !== 'string') return false;
    if (path.isAbsolute(name)) return false;
    const parts = name.split(/[\\/]/);
    return !parts.includes('..');
}

class ZipReader {
    constructor(zipfile, filePath) {
        this.zipfile = zipfile;
        this.filePath = filePath;
        this.entries = new Map();
    }

    listEntries() {
        if (!this.entries) return [];
        return Array.from(this.entries.keys());
    }

    async readStream(name) {
        if (!isSafeEntry(name)) {
            this.close();
            throw new Error('Potential path traversal attempt: ' + name);
        }
        if (!this.entries) {
            throw new Error('Reader is closed');
        }
        const entry = this.entries.get(name);
        if (!entry) {
            this.close();
            throw new Error('Entry not found: ' + name);
        }
        const { spawn } = require('child_process');
        const child = spawn('unzip', ['-p', this.filePath, name]);
        return child.stdout;
    }

    async readBuffer(name) {
        if (!isSafeEntry(name)) {
            this.close();
            throw new Error('Potential path traversal attempt: ' + name);
        }
        if (!this.entries) {
            throw new Error('Reader is closed');
        }
        const entry = this.entries.get(name);
        if (!entry) {
            this.close();
            throw new Error('Entry not found: ' + name);
        }
        return new Promise((resolve, reject) => {
            const { spawn } = require('child_process');
            const child = spawn('unzip', ['-p', this.filePath, name]);
            const chunks = [];
            let errorOutput = '';

            child.stdout.on('data', (chunk) => {
                chunks.push(chunk);
            });

            child.stderr.on('data', (data) => {
                errorOutput += data.toString();
            });

            child.on('close', (code) => {
                if (code === 0) {
                    resolve(Buffer.concat(chunks));
                } else {
                    reject(new Error(`unzip failed with code ${code}: ${errorOutput}`));
                }
            });

            child.on('error', (err) => {
                reject(err);
            });
        });
    }

    close() {
        if (this.zipfile) {
            this.zipfile.close();
        }
        this.zipfile = null;
        this.entries = null;
    }
}

async function createZipReader(filePath) {
    return new Promise((resolve, reject) => {
        yauzl.open(filePath, { lazyEntries: true, autoClose: false }, (err, zipfile) => {
            if (err) return reject(err);
            const reader = new ZipReader(zipfile, filePath);
            zipfile.readEntry();
            zipfile.on('entry', (entry) => {
                reader.entries.set(entry.fileName, entry);
                zipfile.readEntry();
            });
            zipfile.on('end', () => resolve(reader));
            zipfile.on('error', (err) => {
                zipfile.close();
                reject(err);
            });
        });
    });
}


class RarReader {
    constructor(extractor, data) {
        this.extractor = extractor;
        this.data = data;
        this.entries = [];
        const list = this.extractor.getFileList();
        for (const fileHeader of list.fileHeaders) {
            if (!fileHeader.flags.directory) {
                this.entries.push(fileHeader.name);
            }
        }
    }

    listEntries() {
        return this.entries;
    }

    async readBuffer(name) {
        if (!isSafeEntry(name)) {
            throw new Error('Potential path traversal attempt: ' + name);
        }
        const extracted = this.extractor.extract({ files: [name] });
        const files = Array.from(extracted.files);
        if (files.length === 0) throw new Error('Entry not found: ' + name);
        return Buffer.from(files[0].extraction);
    }

    async readStream(name) {
        const buffer = await this.readBuffer(name);
        return Readable.from(buffer);
    }

    close() {
        // extractor doesn't need closing, but we might want to nullify data if large
        this.data = null;
    }
}

async function createRarReader(filePath) {
    const data = fs.readFileSync(filePath);
    const extractor = await createExtractorFromData({ data });
    return new RarReader(extractor, data);
}

async function openArchive(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.cbz' || ext === '.zip') {
        return createZipReader(filePath);
    } else if (ext === '.cbr' || ext === '.rar') {
        return createRarReader(filePath);
    } else {
        throw new Error('Unsupported archive format: ' + ext);
    }
}

async function listPages(filePath) {
    const archive = await openArchive(filePath);
    try {
        const entries = archive.listEntries();
        return entries
            .filter(e => isImage(e) && !e.split('/').some(part => part.startsWith('.') || part === '__MACOSX'))
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    } finally {
        archive.close();
    }
}

async function getEntryBuffer(filePath, entryName) {
    const archive = await openArchive(filePath);
    try {
        return await archive.readBuffer(entryName);
    } finally {
        archive.close();
    }
}

module.exports = {
    openArchive,
    listPages,
    getEntryBuffer
};
