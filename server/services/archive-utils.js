const yauzl = require('yauzl');
const { createExtractorFromFile } = require('node-unrar-js');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const { spawn } = require('child_process');
const { isImage } = require('../utils');

function isSafeEntry(name) {
    if (typeof name !== 'string') return false;
    if (path.isAbsolute(name)) return false;
    const parts = name.split(/[\\/]/);
    return !parts.includes('..');
}

function escapeZipGlob(name) {
    if (typeof name !== 'string') return '';
    return name.replace(/([\[*?\\])/g, '\\$1');
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

    getEntry(name) {
        if (!this.entries) return null;
        let entry = this.entries.get(name);
        if (!entry && typeof name === 'string') {
            const normalized = name.normalize();
            entry = this.entries.get(normalized);
            if (!entry) {
                for (const [k, v] of this.entries.entries()) {
                    if (k.normalize() === normalized) {
                        return v;
                    }
                }
            }
        }
        return entry || null;
    }

    async readStream(name) {
        if (!isSafeEntry(name)) {
            this.close();
            throw new Error('Potential path traversal attempt: ' + name);
        }
        if (!this.entries) {
            throw new Error('Reader is closed');
        }
        const entry = this.getEntry(name);
        if (!entry) {
            this.close();
            throw new Error('Entry not found: ' + name);
        }
        const actualName = entry.fileName || name;
        const child = spawn('unzip', ['-p', '--', this.filePath, escapeZipGlob(actualName)]);
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
        const entry = this.getEntry(name);
        if (!entry) {
            this.close();
            throw new Error('Entry not found: ' + name);
        }

        const actualName = entry.fileName || name;

        const readWithYauzl = () => {
            return new Promise((resolve, reject) => {
                if (!this.zipfile) {
                    return reject(new Error('Zipfile closed'));
                }
                let settled = false;
                const timer = setTimeout(() => {
                    if (!settled) {
                        settled = true;
                        reject(new Error('yauzl stream timed out'));
                    }
                }, 10000);
                this.zipfile.openReadStream(entry, (err, stream) => {
                    if (err) {
                        clearTimeout(timer);
                        if (!settled) {
                            settled = true;
                            reject(err);
                        }
                        return;
                    }
                    const chunks = [];
                    stream.on('data', (chunk) => chunks.push(chunk));
                    stream.on('end', () => {
                        clearTimeout(timer);
                        if (!settled) {
                            settled = true;
                            resolve(Buffer.concat(chunks));
                        }
                    });
                    stream.on('error', (streamErr) => {
                        clearTimeout(timer);
                        if (!settled) {
                            settled = true;
                            reject(streamErr);
                        }
                    });
                });
            });
        };

        return new Promise((resolve, reject) => {
            const child = spawn('unzip', ['-p', '--', this.filePath, escapeZipGlob(actualName)]);
            const chunks = [];
            let errorOutput = '';

            child.stdout.on('data', (chunk) => {
                chunks.push(chunk);
            });

            child.stderr.on('data', (data) => {
                errorOutput += data.toString();
            });

            child.on('close', async (code) => {
                if (code === 0 && chunks.length > 0) {
                    resolve(Buffer.concat(chunks));
                } else {
                    try {
                        const yauzlBuf = await readWithYauzl();
                        resolve(yauzlBuf);
                    } catch (yErr) {
                        reject(new Error(`unzip failed with code ${code}: ${errorOutput || yErr.message}`));
                    }
                }
            });

            child.on('error', async (err) => {
                try {
                    const yauzlBuf = await readWithYauzl();
                    resolve(yauzlBuf);
                } catch {
                    reject(err);
                }
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
    constructor(extractor, targetPath) {
        this.extractor = extractor;
        this.targetPath = targetPath;
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
        if (!this.targetPath) {
            throw new Error('RAR extraction target is not configured');
        }
        // The file-based extractor writes entries to targetPath and yields only
        // file headers, so consume the iterator before reading from disk.
        const extracted = this.extractor.extract({ files: [name] });
        const files = Array.from(extracted.files);
        if (files.length === 0) throw new Error('Entry not found: ' + name);

        const extractedPath = path.join(this.targetPath, path.basename(name.replace(/\\/g, '/')));
        try {
            return await fs.promises.readFile(extractedPath);
        } finally {
            await fs.promises.rm(extractedPath, { force: true }).catch(() => {});
        }
    }

    async readStream(name) {
        const buffer = await this.readBuffer(name);
        return Readable.from(buffer);
    }

    close() {
        if (this.targetPath) {
            fs.rmSync(this.targetPath, { recursive: true, force: true });
            this.targetPath = null;
        }
    }
}

async function createRarReader(filePath) {
    const targetPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'comics-now-rar-'));
    try {
        const extractor = await createExtractorFromFile({
            filepath: filePath,
            targetPath,
            filenameTransform: (name) => path.basename(name.replace(/\\/g, '/'))
        });
        return new RarReader(extractor, targetPath);
    } catch (err) {
        await fs.promises.rm(targetPath, { recursive: true, force: true }).catch(() => {});
        throw err;
    }
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

/**
 * Filters archive entries down to visible image pages in reading order.
 * RAR entry names may use backslashes, so path parts are split on both separators.
 */
function selectImagePages(entries) {
    return (entries || [])
        .filter(e => typeof e === 'string' && isImage(e))
        .filter(e => !e.split(/[\\/]/).some(part => part.startsWith('.') || part === '__MACOSX'))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

function createArchiveSession(archive) {
    const pages = selectImagePages(archive.listEntries());
    let closed = false;
    let inFlight = 0;
    let idleResolve = null;
    let idlePromise = null;
    let chain = Promise.resolve();

    function readBuffer(name) {
        if (closed) return Promise.reject(new Error('Archive session is closed'));
        inFlight++;
        // Serialize reads: the extractor is stateful and entries are flattened
        // to basenames on disk, so concurrent duplicate names would collide.
        const run = chain.then(() => archive.readBuffer(name));
        chain = run.then(() => {}, () => {});
        return run.finally(() => {
            inFlight--;
            if (inFlight === 0 && idleResolve) {
                const resolve = idleResolve;
                idleResolve = null;
                idlePromise = null;
                resolve();
            }
        });
    }

    function close() {
        if (closed) return Promise.resolve();
        closed = true;
        if (inFlight === 0) {
            archive.close();
            return Promise.resolve();
        }
        if (!idlePromise) {
            idlePromise = new Promise(resolve => { idleResolve = resolve; });
        }
        return new Promise(resolve => {
            const timer = setTimeout(resolve, 2000);
            idlePromise.then(() => { clearTimeout(timer); resolve(); });
        }).then(() => archive.close());
    }

    return { pages, readBuffer, close };
}

async function openArchiveSession(filePath) {
    const archive = await openArchive(filePath);
    return createArchiveSession(archive);
}

async function listPages(filePath) {
    const session = await openArchiveSession(filePath);
    await session.close();
    return session.pages;
}

/**
 * Removes leftover RAR extraction directories from crashed or interrupted runs.
 */
function cleanupStaleRarTempDirs(maxAgeMs = 24 * 60 * 60 * 1000, baseDir = os.tmpdir()) {
    let removed = 0;
    let names = [];
    try {
        names = fs.readdirSync(baseDir);
    } catch (_) {
        return 0;
    }
    const cutoff = Date.now() - maxAgeMs;
    for (const name of names) {
        if (!name.startsWith('comics-now-rar-')) continue;
        const dirPath = path.join(baseDir, name);
        try {
            const stat = fs.statSync(dirPath);
            if (stat.isDirectory() && stat.mtimeMs <= cutoff) {
                fs.rmSync(dirPath, { recursive: true, force: true });
                removed++;
            }
        } catch (_) {}
    }
    return removed;
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
    openArchiveSession,
    selectImagePages,
    cleanupStaleRarTempDirs,
    listPages,
    getEntryBuffer
};
