const yauzl = require('yauzl');
const { createExtractorFromData } = require('node-unrar-js');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { isImage } = require('../utils');

class ZipReader {
    constructor(zipfile) {
        this.zipfile = zipfile;
        this.entries = new Map();
    }

    listEntries() {
        return Array.from(this.entries.keys());
    }

    async readStream(name) {
        if (path.isAbsolute(name) || name.includes('..')) {
            this.close();
            throw new Error('Potential path traversal attempt: ' + name);
        }
        const entry = this.entries.get(name);
        if (!entry) {
            this.close();
            throw new Error('Entry not found: ' + name);
        }
        return new Promise((resolve, reject) => {
            this.zipfile.openReadStream(entry, (err, stream) => {
                if (err) {
                    this.close();
                    return reject(err);
                }
                resolve(stream);
            });
        });
    }

    async readBuffer(name) {
        const stream = await this.readStream(name);
        return new Promise((resolve, reject) => {
            const chunks = [];
            stream.on('data', (chunk) => chunks.push(chunk));
            stream.on('end', () => resolve(Buffer.concat(chunks)));
            stream.on('error', reject);
        });
    }

    close() {
        this.zipfile.close();
    }
}

async function createZipReader(filePath) {
    return new Promise((resolve, reject) => {
        yauzl.open(filePath, { lazyEntries: true, autoClose: false }, (err, zipfile) => {
            if (err) return reject(err);
            const reader = new ZipReader(zipfile);
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
        for (const arcHeader of list.arcHeader) {
            // Not really useful for files
        }
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
        if (path.isAbsolute(name) || name.includes('..')) {
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
