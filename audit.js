/*
 * Local accountability and audit history.
 *
 * Bulk score history is kept in compact binary IndexedDB chunks. Only the
 * existing top-level filtering site, timestamp, score, threshold, S/Q/R/X
 * rating, outcome, filtering setting and private-window bit are retained. Blocked thumbnails are fixed 128x128 RGB332
 * buffers encrypted with a per-install device key before they are written.
 */

const AUDIT_STORAGE_KEY = 'audit_settings';
const AUDIT_HEARTBEAT_KEY = 'audit_heartbeat';
const AUDIT_DB_NAME = 'wingman-jr-audit';
const AUDIT_DB_VERSION = 1;
const AUDIT_RECORD_BYTES = 12;
const AUDIT_SCORE_CHUNK_SIZE = 256;
const AUDIT_MAX_PENDING_SCORES = 512;
const AUDIT_MAX_SCORE_RECORDS = 100000;
const AUDIT_MAX_THUMBNAILS = 1000;
const AUDIT_MAX_EVENTS = 10000;
const AUDIT_EVENT_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
const AUDIT_PRIVATE_POLL_MS = 5000;
const AUDIT_HEARTBEAT_MS = 15000;
const AUDIT_UNLOCK_MS = 5 * 60 * 1000;
const AUDIT_PASSWORD_ITERATIONS = 210000;

const AUDIT_MODES = Object.freeze({
    OFF: 'off',
    AUDIT: 'audit',
    ACCOUNTABILITY: 'accountability'
});

let AUDIT_settings = {
    mode: AUDIT_MODES.OFF,
    privateAccessAllowed: null,
    deviceKey: null,
    passwordSalt: null,
    passwordVerifier: null
};
let AUDIT_dbPromise = null;
let AUDIT_pendingScores = [];
let AUDIT_droppedPendingScores = 0;
let AUDIT_scoreDrainPromise = null;
let AUDIT_flushTimer = null;
let AUDIT_privatePollTimer = null;
let AUDIT_heartbeatTimer = null;
let AUDIT_unlockedUntil = 0;
let AUDIT_writeQueue = Promise.resolve();
let AUDIT_privateWindowIds = new Set();
let AUDIT_initialized = false;

function auditRequest(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
    });
}

function auditTransactionDone(transaction) {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'));
        transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
    });
}

function auditOpenDatabase() {
    if (AUDIT_dbPromise) {
        return AUDIT_dbPromise;
    }
    AUDIT_dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(AUDIT_DB_NAME, AUDIT_DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains('scoreChunks')) {
                const chunks = db.createObjectStore('scoreChunks', { keyPath: 'id', autoIncrement: true });
                chunks.createIndex('startTime', 'startTime');
                chunks.createIndex('endTime', 'endTime');
            }
            if (!db.objectStoreNames.contains('thumbnails')) {
                const thumbnails = db.createObjectStore('thumbnails', { keyPath: 'id', autoIncrement: true });
                thumbnails.createIndex('timestamp', 'timestamp');
                thumbnails.createIndex('sequence', 'sequence', { unique: true });
            }
            if (!db.objectStoreNames.contains('auditEvents')) {
                const events = db.createObjectStore('auditEvents', { keyPath: 'id', autoIncrement: true });
                events.createIndex('timestamp', 'timestamp');
            }
            if (!db.objectStoreNames.contains('meta')) {
                db.createObjectStore('meta', { keyPath: 'key' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
            AUDIT_dbPromise = null;
            reject(request.error || new Error('Unable to open audit database'));
        };
    });
    return AUDIT_dbPromise;
}

function auditNormalizeMode(mode) {
    return Object.values(AUDIT_MODES).includes(mode) ? mode : AUDIT_MODES.OFF;
}

function auditNormalizeSettings(value) {
    const input = value && typeof value === 'object' ? value : {};
    return {
        mode: auditNormalizeMode(input.mode),
        privateAccessAllowed: typeof input.privateAccessAllowed === 'boolean'
            ? input.privateAccessAllowed
            : null,
        deviceKey: typeof input.deviceKey === 'string' ? input.deviceKey : null,
        passwordSalt: typeof input.passwordSalt === 'string' ? input.passwordSalt : null,
        passwordVerifier: typeof input.passwordVerifier === 'string' ? input.passwordVerifier : null
    };
}

async function auditSaveSettings() {
    await browser.storage.local.set({ [AUDIT_STORAGE_KEY]: { ...AUDIT_settings } });
}

function auditBytesToBase64(bytes) {
    const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let binary = '';
    const step = 0x8000;
    for (let i = 0; i < source.length; i += step) {
        binary += String.fromCharCode(...source.subarray(i, i + step));
    }
    return btoa(binary);
}

function auditBase64ToBytes(value) {
    const binary = atob(value || '');
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

async function auditDerivePasswordVerifier(password, saltBytes) {
    const passwordKey = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(password),
        'PBKDF2',
        false,
        ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits({
        name: 'PBKDF2',
        salt: saltBytes,
        iterations: AUDIT_PASSWORD_ITERATIONS,
        hash: 'SHA-256'
    }, passwordKey, 256);
    return new Uint8Array(bits);
}

function auditConstantTimeEqual(left, right) {
    if (left.length !== right.length) {
        return false;
    }
    let difference = 0;
    for (let i = 0; i < left.length; i++) {
        difference |= left[i] ^ right[i];
    }
    return difference === 0;
}

async function auditSetPassword(password) {
    if (typeof password !== 'string' || password.length < 8) {
        throw new Error('Password must be at least 8 characters.');
    }
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const verifier = await auditDerivePasswordVerifier(password, salt);
    AUDIT_settings.passwordSalt = auditBytesToBase64(salt);
    AUDIT_settings.passwordVerifier = auditBytesToBase64(verifier);
}

async function auditVerifyPassword(password) {
    if (!AUDIT_settings.passwordSalt || !AUDIT_settings.passwordVerifier) {
        return false;
    }
    const verifier = await auditDerivePasswordVerifier(
        String(password || ''),
        auditBase64ToBytes(AUDIT_settings.passwordSalt)
    );
    return auditConstantTimeEqual(verifier, auditBase64ToBytes(AUDIT_settings.passwordVerifier));
}

function auditEnsureDeviceKey() {
    if (!AUDIT_settings.deviceKey) {
        AUDIT_settings.deviceKey = auditBytesToBase64(
            crypto.getRandomValues(new Uint8Array(32))
        );
    }
}

async function auditImportDeviceKey() {
    auditEnsureDeviceKey();
    return crypto.subtle.importKey(
        'raw',
        auditBase64ToBytes(AUDIT_settings.deviceKey),
        { name: 'AES-GCM' },
        false,
        ['encrypt', 'decrypt']
    );
}

async function auditEncryptThumbnail(bytes) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await auditImportDeviceKey();
    const source = bytes instanceof ArrayBuffer
        ? bytes
        : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, source);
    return { iv: iv.buffer, data };
}

async function auditDecryptThumbnail(record) {
    const key = await auditImportDeviceKey();
    return crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(record.iv) },
        key,
        record.data
    );
}

function auditEnqueueWrite(action) {
    const next = AUDIT_writeQueue.catch(() => {}).then(action);
    AUDIT_writeQueue = next.catch(error => {
        console.error('AUDIT: persistence failure', error);
    });
    return next;
}

async function auditGetMetaValues(keys) {
    const db = await auditOpenDatabase();
    const tx = db.transaction('meta', 'readonly');
    const store = tx.objectStore('meta');
    const values = {};
    await Promise.all(keys.map(async key => {
        const record = await auditRequest(store.get(key));
        values[key] = record ? record.value : undefined;
    }));
    await auditTransactionDone(tx);
    return values;
}

function auditClampUnit(value) {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.max(0, Math.min(1, value));
}

function auditQuantizeUnit(value) {
    return Math.round(auditClampUnit(value) * 65535);
}

function auditNormalizeRating(value) {
    const normalized = String(value || '').toLowerCase();
    return ['safe', 'q', 'r', 'x'].includes(normalized) ? normalized : null;
}

function auditRatingToCode(value) {
    return { safe: 1, q: 2, r: 3, x: 4 }[auditNormalizeRating(value)] || 0;
}

function auditRatingFromCode(value) {
    return [null, 'safe', 'q', 'r', 'x'][value] || null;
}

function auditZoneToCode(value) {
    return { trusted: 1, neutral: 2, untrusted: 3 }[String(value || '').toLowerCase()] || 0;
}

function auditZoneFromCode(value) {
    return [null, 'trusted', 'neutral', 'untrusted'][value] || null;
}

function auditPackScoreRecords(records, startSequence) {
    const domains = [];
    const domainIndexes = new Map();
    const data = new ArrayBuffer(records.length * AUDIT_RECORD_BYTES);
    const view = new DataView(data);
    let startTime = Number.POSITIVE_INFINITY;
    let endTime = 0;

    for (let i = 0; i < records.length; i++) {
        const record = records[i];
        let domainIndex = domainIndexes.get(record.hostname);
        if (domainIndex === undefined) {
            domainIndex = domains.length;
            domains.push(record.hostname);
            domainIndexes.set(record.hostname, domainIndex);
        }
        const timestamp = Math.max(0, Math.floor(record.timestamp / 1000));
        const offset = i * AUDIT_RECORD_BYTES;
        view.setUint32(offset, timestamp, true);
        view.setUint16(offset + 4, domainIndex, true);
        view.setUint16(offset + 6, auditQuantizeUnit(record.score), true);
        view.setUint16(offset + 8, auditQuantizeUnit(record.threshold), true);
        let flags = record.result === 'block' ? 1 : 0;
        if (record.private === true) {
            flags |= 2;
        }
        flags |= auditZoneToCode(record.effectiveZone) << 2;
        view.setUint8(offset + 10, flags);
        view.setUint8(offset + 11, auditRatingToCode(record.rating));
        startTime = Math.min(startTime, record.timestamp);
        endTime = Math.max(endTime, record.timestamp);
    }

    return {
        startSeq: startSequence,
        endSeq: startSequence + records.length - 1,
        count: records.length,
        startTime: Number.isFinite(startTime) ? startTime : 0,
        endTime,
        domains,
        data
    };
}

function auditDecodeScoreChunk(chunk, callback) {
    const view = new DataView(chunk.data);
    for (let i = 0; i < chunk.count; i++) {
        const offset = i * AUDIT_RECORD_BYTES;
        const flags = view.getUint8(offset + 10);
        callback({
            sequence: chunk.startSeq + i,
            timestamp: view.getUint32(offset, true) * 1000,
            hostname: chunk.domains[view.getUint16(offset + 4, true)] || '(unknown site)',
            score: view.getUint16(offset + 6, true) / 65535,
            threshold: view.getUint16(offset + 8, true) / 65535,
            result: (flags & 1) ? 'block' : 'pass',
            private: (flags & 2) !== 0,
            effectiveZone: auditZoneFromCode((flags >> 2) & 3),
            rating: auditRatingFromCode(view.getUint8(offset + 11))
        });
    }
}

function auditScheduleFlush() {
    if (AUDIT_flushTimer !== null || AUDIT_pendingScores.length === 0) {
        return;
    }
    AUDIT_flushTimer = setTimeout(() => {
        AUDIT_flushTimer = null;
        auditFlushPending().catch(error => console.error('AUDIT: score flush failed', error));
    }, 2000);
}

function auditRecordScan(context, result, score, thumbnail, rating) {
    if (AUDIT_settings.mode === AUDIT_MODES.OFF
        || !context
        || typeof context.hostname !== 'string'
        || !context.hostname
        || !Number.isFinite(score)
        || (result !== 'pass' && result !== 'block')) {
        return;
    }
    AUDIT_pendingScores.push({
        timestamp: Date.now(),
        hostname: context.hostname,
        score,
        threshold: Number.isFinite(context.threshold) ? context.threshold : 0.5,
        result,
        private: context.isPrivate === true,
        effectiveZone: auditZoneFromCode(auditZoneToCode(context.effectiveZone)),
        rating: auditNormalizeRating(rating),
        thumbnail: result === 'block' && thumbnail instanceof ArrayBuffer ? thumbnail : null
    });
    if (AUDIT_pendingScores.length > AUDIT_MAX_PENDING_SCORES) {
        const overflow = AUDIT_pendingScores.length - AUDIT_MAX_PENDING_SCORES;
        AUDIT_pendingScores.splice(0, overflow);
        AUDIT_droppedPendingScores += overflow;
    }
    if (AUDIT_pendingScores.length >= AUDIT_SCORE_CHUNK_SIZE) {
        auditFlushPending().catch(error => console.error('AUDIT: score flush failed', error));
    } else {
        auditScheduleFlush();
    }
}

async function auditFlushPending() {
    if (AUDIT_flushTimer !== null) {
        clearTimeout(AUDIT_flushTimer);
        AUDIT_flushTimer = null;
    }
    if (AUDIT_scoreDrainPromise) {
        return AUDIT_scoreDrainPromise;
    }
    if (AUDIT_pendingScores.length === 0 && AUDIT_droppedPendingScores === 0) {
        return AUDIT_writeQueue;
    }
    const drain = auditEnqueueWrite(async () => {
        while (AUDIT_pendingScores.length > 0 && AUDIT_settings.mode !== AUDIT_MODES.OFF) {
            const batch = AUDIT_pendingScores.splice(0, AUDIT_SCORE_CHUNK_SIZE);
            await auditWriteScoreBatch(batch);
        }
        if (AUDIT_droppedPendingScores > 0 && AUDIT_settings.mode !== AUDIT_MODES.OFF) {
            const dropped = AUDIT_droppedPendingScores;
            AUDIT_droppedPendingScores = 0;
            await auditAppendEventNow('score-buffer-overflow', { dropped });
        }
    });
    AUDIT_scoreDrainPromise = drain.finally(() => {
        AUDIT_scoreDrainPromise = null;
        if (AUDIT_pendingScores.length > 0 || AUDIT_droppedPendingScores > 0) {
            auditScheduleFlush();
        }
    });
    return AUDIT_scoreDrainPromise;
}

async function auditWriteScoreBatch(records) {
    if (records.length === 0 || AUDIT_settings.mode === AUDIT_MODES.OFF) {
        return;
    }
    const meta = await auditGetMetaValues(['nextSequence', 'scoreCount', 'thumbnailCount']);
    const nextSequence = Number.isInteger(meta.nextSequence) ? meta.nextSequence : 1;
    const chunk = auditPackScoreRecords(records, nextSequence);
    const encryptedThumbnails = [];
    for (let i = 0; i < records.length; i++) {
        if (!records[i].thumbnail) {
            continue;
        }
        const encrypted = await auditEncryptThumbnail(records[i].thumbnail);
        encryptedThumbnails.push({
            sequence: nextSequence + i,
            timestamp: records[i].timestamp,
            hostname: records[i].hostname,
            score: records[i].score,
            private: records[i].private,
            rating: records[i].rating,
            width: 128,
            height: 128,
            encoding: 'rgb332',
            iv: encrypted.iv,
            data: encrypted.data
        });
    }

    const db = await auditOpenDatabase();
    const tx = db.transaction(['scoreChunks', 'thumbnails', 'meta'], 'readwrite');
    tx.objectStore('scoreChunks').add(chunk);
    const thumbnailStore = tx.objectStore('thumbnails');
    for (const thumbnail of encryptedThumbnails) {
        thumbnailStore.add(thumbnail);
    }
    const metaStore = tx.objectStore('meta');
    metaStore.put({ key: 'nextSequence', value: nextSequence + records.length });
    metaStore.put({
        key: 'scoreCount',
        value: (Number(meta.scoreCount) || 0) + records.length
    });
    metaStore.put({
        key: 'thumbnailCount',
        value: (Number(meta.thumbnailCount) || 0) + encryptedThumbnails.length
    });
    await auditTransactionDone(tx);
    await auditPruneScoreHistory();
    await auditPruneThumbnails();
}

async function auditPruneScoreHistory() {
    const meta = await auditGetMetaValues(['scoreCount']);
    let excess = Math.max(0, (Number(meta.scoreCount) || 0) - AUDIT_MAX_SCORE_RECORDS);
    if (excess === 0) {
        return;
    }
    const db = await auditOpenDatabase();
    const tx = db.transaction(['scoreChunks', 'meta'], 'readwrite');
    const store = tx.objectStore('scoreChunks');
    const request = store.openCursor();
    request.onsuccess = event => {
        const cursor = event.target.result;
        if (!cursor || excess <= 0) {
            tx.objectStore('meta').put({ key: 'scoreCount', value: AUDIT_MAX_SCORE_RECORDS });
            return;
        }
        const chunk = cursor.value;
        if (chunk.count <= excess) {
            excess -= chunk.count;
            cursor.delete();
            cursor.continue();
            return;
        }
        const removeCount = excess;
        chunk.data = chunk.data.slice(removeCount * AUDIT_RECORD_BYTES);
        chunk.startSeq += removeCount;
        chunk.count -= removeCount;
        const view = new DataView(chunk.data);
        chunk.startTime = view.getUint32(0, true) * 1000;
        excess = 0;
        cursor.update(chunk);
        cursor.continue();
    };
    await auditTransactionDone(tx);
}

async function auditPruneThumbnails() {
    const meta = await auditGetMetaValues(['thumbnailCount']);
    let excess = Math.max(0, (Number(meta.thumbnailCount) || 0) - AUDIT_MAX_THUMBNAILS);
    if (excess === 0) {
        return;
    }
    const db = await auditOpenDatabase();
    const tx = db.transaction(['thumbnails', 'meta'], 'readwrite');
    const store = tx.objectStore('thumbnails');
    const request = store.openCursor();
    request.onsuccess = event => {
        const cursor = event.target.result;
        if (!cursor || excess <= 0) {
            tx.objectStore('meta').put({ key: 'thumbnailCount', value: AUDIT_MAX_THUMBNAILS });
            return;
        }
        excess--;
        cursor.delete();
        cursor.continue();
    };
    await auditTransactionDone(tx);
}

function auditNormalizeDetails(details) {
    if (!details || typeof details !== 'object' || Array.isArray(details)) {
        return {};
    }
    const normalized = {};
    for (const [key, value] of Object.entries(details)) {
        if (typeof value === 'string' || typeof value === 'boolean' || Number.isFinite(value)) {
            normalized[key] = value;
        }
    }
    return normalized;
}

async function auditHashEvent(previousHash, event) {
    const canonical = JSON.stringify([
        previousHash || '',
        event.timestamp,
        event.type,
        event.details
    ]);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
    return auditBytesToBase64(new Uint8Array(digest));
}

function auditAppendEvent(type, details = {}, timestamp = Date.now()) {
    if (AUDIT_settings.mode === AUDIT_MODES.OFF
        && type !== 'tracking-turned-off'
        && type !== 'accountability-reset') {
        return Promise.resolve();
    }
    return auditEnqueueWrite(() => auditAppendEventNow(type, details, timestamp));
}

async function auditAppendEventNow(type, details = {}, timestamp = Date.now()) {
    const meta = await auditGetMetaValues(['auditHeadHash', 'auditCount']);
    const event = {
        timestamp,
        type: String(type),
        details: auditNormalizeDetails(details),
        previousHash: meta.auditHeadHash || ''
    };
    event.hash = await auditHashEvent(event.previousHash, event);
    const db = await auditOpenDatabase();
    const tx = db.transaction(['auditEvents', 'meta'], 'readwrite');
    tx.objectStore('auditEvents').add(event);
    const metaStore = tx.objectStore('meta');
    metaStore.put({ key: 'auditHeadHash', value: event.hash });
    metaStore.put({ key: 'auditCount', value: (Number(meta.auditCount) || 0) + 1 });
    await auditTransactionDone(tx);
    await auditPruneEvents();
}

async function auditPruneEvents() {
    const meta = await auditGetMetaValues(['auditCount']);
    let count = Number(meta.auditCount) || 0;
    const cutoff = Date.now() - AUDIT_EVENT_RETENTION_MS;
    if (count <= AUDIT_MAX_EVENTS) {
        const db = await auditOpenDatabase();
        const tx = db.transaction('auditEvents', 'readonly');
        const first = await auditRequest(tx.objectStore('auditEvents').openCursor());
        await auditTransactionDone(tx);
        if (!first || first.value.timestamp >= cutoff) {
            return;
        }
    }
    const db = await auditOpenDatabase();
    const tx = db.transaction(['auditEvents', 'meta'], 'readwrite');
    const store = tx.objectStore('auditEvents');
    const request = store.openCursor();
    request.onsuccess = event => {
        const cursor = event.target.result;
        if (!cursor) {
            tx.objectStore('meta').put({ key: 'auditCount', value: count });
            return;
        }
        if (count > AUDIT_MAX_EVENTS || cursor.value.timestamp < cutoff) {
            count--;
            cursor.delete();
            cursor.continue();
        } else {
            tx.objectStore('meta').put({ key: 'auditCount', value: count });
        }
    };
    await auditTransactionDone(tx);
}

async function auditClearHistoryAndAddTombstone(type) {
    AUDIT_pendingScores = [];
    AUDIT_droppedPendingScores = 0;
    if (AUDIT_flushTimer !== null) {
        clearTimeout(AUDIT_flushTimer);
        AUDIT_flushTimer = null;
    }
    const db = await auditOpenDatabase();
    const tx = db.transaction(['scoreChunks', 'thumbnails', 'auditEvents', 'meta'], 'readwrite');
    tx.objectStore('scoreChunks').clear();
    tx.objectStore('thumbnails').clear();
    tx.objectStore('auditEvents').clear();
    tx.objectStore('meta').clear();
    await auditTransactionDone(tx);
    await auditAppendEventNow(type, {});
}

async function auditSetMode(requestedMode, password, allowIncompletePrivateCoverage = false) {
    const nextMode = auditNormalizeMode(requestedMode);
    const previousMode = AUDIT_settings.mode;
    if (nextMode === previousMode) {
        return auditGetState();
    }
    await auditFlushPending();
    return auditEnqueueWrite(async () => {
        if (previousMode === AUDIT_MODES.ACCOUNTABILITY
            && !(await auditVerifyPassword(password))) {
            throw new Error('The accountability password is incorrect.');
        }
        const privateAllowed = await auditReadPrivateAccess();
        if (nextMode === AUDIT_MODES.ACCOUNTABILITY
            && !privateAllowed
            && !allowIncompletePrivateCoverage) {
            const error = new Error('Enable Wingman Jr. in private windows, or explicitly continue with incomplete coverage.');
            error.code = 'private-coverage-required';
            throw error;
        }

        if (nextMode === AUDIT_MODES.OFF) {
            auditStopPrivateMonitoring();
            auditStopHeartbeat();
            await auditClearHistoryAndAddTombstone('tracking-turned-off');
            AUDIT_settings.mode = AUDIT_MODES.OFF;
            AUDIT_settings.passwordSalt = null;
            AUDIT_settings.passwordVerifier = null;
            AUDIT_settings.deviceKey = null;
            AUDIT_unlockedUntil = 0;
            await auditSaveSettings();
            auditUpdateModeIndicators();
            await browser.storage.local.remove(AUDIT_HEARTBEAT_KEY);
            return auditGetState();
        }

        auditEnsureDeviceKey();
        if (nextMode === AUDIT_MODES.ACCOUNTABILITY) {
            if (previousMode !== AUDIT_MODES.ACCOUNTABILITY) {
                await auditSetPassword(password);
            }
            AUDIT_unlockedUntil = Date.now() + AUDIT_UNLOCK_MS;
        } else {
            AUDIT_settings.passwordSalt = null;
            AUDIT_settings.passwordVerifier = null;
            AUDIT_unlockedUntil = 0;
        }
        AUDIT_settings.mode = nextMode;
        AUDIT_settings.privateAccessAllowed = privateAllowed;
        await auditSaveSettings();
        auditUpdateModeIndicators();
        auditStartPrivateMonitoring();
        auditStartHeartbeat();
        await auditAppendEventNow('mode-changed', {
            from: previousMode,
            to: nextMode
        });
        await auditAppendEventNow(
            privateAllowed ? 'private-coverage-enabled' : 'private-coverage-unavailable',
            { source: 'mode-change' }
        );
        await auditRefreshPrivateWindows(true, true);
        return auditGetState();
    });
}

async function auditResetPassword() {
    return auditEnqueueWrite(async () => {
        auditStopPrivateMonitoring();
        auditStopHeartbeat();
        await auditClearHistoryAndAddTombstone('accountability-reset');
        AUDIT_settings.mode = AUDIT_MODES.OFF;
        AUDIT_settings.passwordSalt = null;
        AUDIT_settings.passwordVerifier = null;
        AUDIT_settings.deviceKey = null;
        AUDIT_settings.privateAccessAllowed = await auditReadPrivateAccess();
        AUDIT_unlockedUntil = 0;
        await auditSaveSettings();
        auditUpdateModeIndicators();
        await browser.storage.local.remove(AUDIT_HEARTBEAT_KEY);
        return auditGetState();
    });
}

async function auditUnlock(password) {
    if (AUDIT_settings.mode !== AUDIT_MODES.ACCOUNTABILITY) {
        return true;
    }
    if (!(await auditVerifyPassword(password))) {
        return false;
    }
    AUDIT_unlockedUntil = Date.now() + AUDIT_UNLOCK_MS;
    return true;
}

async function auditReadPrivateAccess() {
    try {
        return await browser.extension.isAllowedIncognitoAccess();
    } catch (error) {
        console.warn('AUDIT: Unable to read private browsing access', error);
        return false;
    }
}

async function auditCheckPrivateCoverage(source = 'poll', forceBaseline = false) {
    const allowed = await auditReadPrivateAccess();
    const previous = AUDIT_settings.privateAccessAllowed;
    if (previous !== allowed || forceBaseline) {
        AUDIT_settings.privateAccessAllowed = allowed;
        await auditSaveSettings();
        if (AUDIT_settings.mode !== AUDIT_MODES.OFF) {
            await auditAppendEvent(
                allowed ? 'private-coverage-enabled' : 'private-coverage-revoked',
                { source }
            );
        }
    }
    if (allowed) {
        await auditRefreshPrivateWindows(false);
    } else {
        AUDIT_privateWindowIds.clear();
    }
    return allowed;
}

async function auditRefreshPrivateWindows(logExisting, directWrite = false) {
    if (!AUDIT_settings.privateAccessAllowed || !browser.windows?.getAll) {
        AUDIT_privateWindowIds.clear();
        return;
    }
    try {
        const windows = await browser.windows.getAll({ populate: false });
        const nextIds = new Set(windows.filter(windowInfo => windowInfo.incognito).map(windowInfo => windowInfo.id));
        const previouslyEmpty = AUDIT_privateWindowIds.size === 0;
        AUDIT_privateWindowIds = nextIds;
        if (logExisting && previouslyEmpty && nextIds.size > 0 && AUDIT_settings.mode !== AUDIT_MODES.OFF) {
            const write = directWrite ? auditAppendEventNow : auditAppendEvent;
            await write('private-session-observed', { windows: nextIds.size });
        }
    } catch (error) {
        console.warn('AUDIT: Unable to enumerate private windows', error);
    }
}

function auditStartPrivateMonitoring() {
    auditStopPrivateMonitoring();
    if (AUDIT_settings.mode === AUDIT_MODES.OFF) {
        return;
    }
    AUDIT_privatePollTimer = setInterval(() => {
        auditCheckPrivateCoverage('poll').catch(error => {
            console.error('AUDIT: private coverage check failed', error);
        });
    }, AUDIT_PRIVATE_POLL_MS);
}

function auditStopPrivateMonitoring() {
    if (AUDIT_privatePollTimer !== null) {
        clearInterval(AUDIT_privatePollTimer);
        AUDIT_privatePollTimer = null;
    }
    AUDIT_privateWindowIds.clear();
}

async function auditWriteHeartbeat() {
    if (AUDIT_settings.mode === AUDIT_MODES.OFF) {
        return;
    }
    await browser.storage.local.set({ [AUDIT_HEARTBEAT_KEY]: Date.now() });
}

function auditStartHeartbeat() {
    auditStopHeartbeat();
    if (AUDIT_settings.mode === AUDIT_MODES.OFF) {
        return;
    }
    auditWriteHeartbeat().catch(error => console.error('AUDIT: heartbeat write failed', error));
    AUDIT_heartbeatTimer = setInterval(() => {
        auditWriteHeartbeat().catch(error => console.error('AUDIT: heartbeat write failed', error));
    }, AUDIT_HEARTBEAT_MS);
}

function auditStopHeartbeat() {
    if (AUDIT_heartbeatTimer !== null) {
        clearInterval(AUDIT_heartbeatTimer);
        AUDIT_heartbeatTimer = null;
    }
}

function auditOnWindowCreated(windowInfo) {
    if (AUDIT_settings.mode === AUDIT_MODES.OFF || !windowInfo?.incognito) {
        return;
    }
    const wasEmpty = AUDIT_privateWindowIds.size === 0;
    AUDIT_privateWindowIds.add(windowInfo.id);
    if (wasEmpty) {
        auditAppendEvent('private-session-started', {}).catch(() => {});
    }
}

function auditOnWindowRemoved(windowId) {
    if (!AUDIT_privateWindowIds.has(windowId)) {
        return;
    }
    AUDIT_privateWindowIds.delete(windowId);
    if (AUDIT_privateWindowIds.size === 0 && AUDIT_settings.mode !== AUDIT_MODES.OFF) {
        auditAppendEvent('private-session-ended', {}).catch(() => {});
    }
}

function auditRelativeLogit(score, threshold) {
    const epsilon = 1 / 65535;
    const safeScore = Math.max(epsilon, Math.min(1 - epsilon, score));
    const safeThreshold = Math.max(epsilon, Math.min(1 - epsilon, threshold));
    const value = Math.log(safeScore / (1 - safeScore))
        - Math.log(safeThreshold / (1 - safeThreshold));
    return Math.max(-6, Math.min(6, value));
}

async function auditReadEventsThrough(endTime) {
    const db = await auditOpenDatabase();
    const tx = db.transaction('auditEvents', 'readonly');
    const index = tx.objectStore('auditEvents').index('timestamp');
    const range = IDBKeyRange.upperBound(endTime);
    const events = [];
    const request = index.openCursor(range);
    request.onsuccess = event => {
        const cursor = event.target.result;
        if (cursor) {
            events.push(cursor.value);
            cursor.continue();
        }
    };
    await auditTransactionDone(tx);
    return events;
}

async function auditVerifyEventChain(events, compareHead) {
    const hashes = await Promise.all(events.map(event => auditHashEvent(event.previousHash, event)));
    let valid = true;
    for (let i = 0; i < events.length; i++) {
        if (hashes[i] !== events[i].hash) {
            valid = false;
            break;
        }
        if (i > 0 && events[i].previousHash !== events[i - 1].hash) {
            valid = false;
            break;
        }
    }
    let headChecked = false;
    if (valid && compareHead) {
        const meta = await auditGetMetaValues(['auditHeadHash']);
        headChecked = true;
        valid = events.length > 0
            ? meta.auditHeadHash === events[events.length - 1].hash
            : !meta.auditHeadHash;
    }
    return { valid, checked: events.length, headChecked };
}

function auditBuildIntervals(events, startTime, endTime, startTypes, endTypes, openEndTime = endTime) {
    const intervals = [];
    const boundedOpenEnd = Math.min(
        endTime,
        Number.isFinite(openEndTime) ? openEndTime : endTime
    );
    let activeSince = null;
    for (const event of events) {
        if (startTypes.has(event.type)) {
            if (activeSince === null) {
                activeSince = event.timestamp;
            }
        } else if (endTypes.has(event.type) && activeSince !== null) {
            if (event.timestamp >= startTime && activeSince <= endTime) {
                intervals.push({
                    start: Math.max(startTime, activeSince),
                    end: Math.min(endTime, event.timestamp)
                });
            }
            activeSince = null;
        }
    }
    if (activeSince !== null && activeSince <= boundedOpenEnd && boundedOpenEnd > startTime) {
        intervals.push({ start: Math.max(startTime, activeSince), end: boundedOpenEnd });
    }
    return intervals;
}

async function auditReadThumbnailsForWindow(startTime, endTime) {
    const db = await auditOpenDatabase();
    const tx = db.transaction('thumbnails', 'readonly');
    const index = tx.objectStore('thumbnails').index('timestamp');
    const records = [];
    const request = index.openCursor(IDBKeyRange.bound(startTime, endTime));
    request.onsuccess = event => {
        const cursor = event.target.result;
        if (cursor) {
            const value = cursor.value;
            records.push({
                id: value.id,
                sequence: value.sequence,
                timestamp: value.timestamp,
                hostname: value.hostname,
                score: value.score,
                private: value.private === true,
                rating: auditNormalizeRating(value.rating)
            });
            cursor.continue();
        }
    };
    await auditTransactionDone(tx);
    return records;
}

async function auditQueryWindow(startTime, endTime, binCount = 168) {
    await auditFlushPending();
    await AUDIT_writeQueue;
    const safeStart = Number(startTime);
    const safeEnd = Number(endTime);
    const safeBins = Math.max(24, Math.min(336, Math.floor(binCount) || 168));
    if (!Number.isFinite(safeStart) || !Number.isFinite(safeEnd) || safeEnd <= safeStart) {
        throw new Error('Invalid audit time window.');
    }

    const thumbnails = await auditReadThumbnailsForWindow(safeStart, safeEnd);
    const thumbnailsBySequence = new Map(thumbnails.map(item => [item.sequence, item]));
    const rows = new Map();
    const db = await auditOpenDatabase();
    const tx = db.transaction('scoreChunks', 'readonly');
    const request = tx.objectStore('scoreChunks').openCursor();
    request.onsuccess = event => {
        const cursor = event.target.result;
        if (!cursor) {
            return;
        }
        const chunk = cursor.value;
        if (chunk.endTime >= safeStart && chunk.startTime <= safeEnd) {
            auditDecodeScoreChunk(chunk, scoreEvent => {
                if (scoreEvent.timestamp < safeStart || scoreEvent.timestamp >= safeEnd) {
                    return;
                }
                let row = rows.get(scoreEvent.hostname);
                if (!row) {
                    row = {
                        hostname: scoreEvent.hostname,
                        count: 0,
                        blocked: 0,
                        privateCount: 0,
                        bins: Object.create(null),
                        blocks: []
                    };
                    rows.set(scoreEvent.hostname, row);
                }
                row.count++;
                if (scoreEvent.private) {
                    row.privateCount++;
                }
                const bin = Math.min(
                    safeBins - 1,
                    Math.max(0, Math.floor((scoreEvent.timestamp - safeStart) / (safeEnd - safeStart) * safeBins))
                );
                if (!row.bins[bin]) {
                    row.bins[bin] = { count: 0, heatTotal: 0, privateCount: 0 };
                }
                row.bins[bin].count++;
                row.bins[bin].heatTotal += auditRelativeLogit(scoreEvent.score, scoreEvent.threshold);
                if (scoreEvent.private) {
                    row.bins[bin].privateCount++;
                }
                if (scoreEvent.result === 'block') {
                    const thumbnail = thumbnailsBySequence.get(scoreEvent.sequence);
                    row.blocked++;
                    row.blocks.push({
                        timestamp: scoreEvent.timestamp,
                        score: scoreEvent.score,
                        threshold: scoreEvent.threshold,
                        private: scoreEvent.private,
                        effectiveZone: scoreEvent.effectiveZone,
                        rating: scoreEvent.rating || thumbnail?.rating || null,
                        thumbnailId: thumbnail?.id || null
                    });
                }
            });
        }
        cursor.continue();
    };
    await auditTransactionDone(tx);

    const allEvents = await auditReadEventsThrough(safeEnd);
    const integrity = await auditVerifyEventChain(allEvents, safeEnd >= Date.now());
    const events = allEvents.filter(event => event.timestamp >= safeStart && event.timestamp <= safeEnd);
    const observedEnd = Math.min(safeEnd, Date.now());
    const privateSessions = auditBuildIntervals(
        allEvents,
        safeStart,
        safeEnd,
        new Set(['private-session-started', 'private-session-observed']),
        new Set(['private-session-ended']),
        observedEnd
    );
    const coverageGaps = auditBuildIntervals(
        allEvents,
        safeStart,
        safeEnd,
        new Set(['private-coverage-revoked', 'private-coverage-unavailable']),
        new Set(['private-coverage-enabled']),
        observedEnd
    );
    const resultRows = Array.from(rows.values())
        .sort((left, right) => right.count - left.count || left.hostname.localeCompare(right.hostname))
        .map(row => ({
            ...row,
            bins: Object.entries(row.bins).map(([index, value]) => ({
                index: Number(index),
                count: value.count,
                heat: value.heatTotal / value.count,
                privateCount: value.privateCount
            }))
        }));

    return {
        startTime: safeStart,
        endTime: safeEnd,
        binCount: safeBins,
        rows: resultRows,
        events,
        privateSessions,
        coverageGaps,
        integrity,
        totals: {
            checks: resultRows.reduce((sum, row) => sum + row.count, 0),
            blocked: resultRows.reduce((sum, row) => sum + row.blocked, 0),
            privateChecks: resultRows.reduce((sum, row) => sum + row.privateCount, 0),
            auditEvents: events.length
        }
    };
}

async function auditGetThumbnail(id, password) {
    if (AUDIT_settings.mode === AUDIT_MODES.ACCOUNTABILITY
        && Date.now() >= AUDIT_unlockedUntil) {
        if (!(await auditUnlock(password))) {
            return { ok: false, locked: true };
        }
    }
    const db = await auditOpenDatabase();
    const tx = db.transaction('thumbnails', 'readonly');
    const record = await auditRequest(tx.objectStore('thumbnails').get(Number(id)));
    await auditTransactionDone(tx);
    if (!record) {
        return { ok: false, missing: true };
    }
    const data = await auditDecryptThumbnail(record);
    await auditAppendEvent('blocked-image-revealed', {
        hostname: record.hostname,
        private: record.private === true,
        score: Math.round(record.score * 10000) / 10000,
        rating: auditNormalizeRating(record.rating)
    });
    return {
        ok: true,
        width: record.width,
        height: record.height,
        encoding: record.encoding,
        data,
        hostname: record.hostname,
        timestamp: record.timestamp,
        score: record.score,
        private: record.private === true,
        rating: auditNormalizeRating(record.rating)
    };
}

async function auditGetState() {
    const meta = await auditGetMetaValues(['scoreCount', 'thumbnailCount', 'auditCount']);
    return {
        mode: AUDIT_settings.mode,
        privateAccessAllowed: AUDIT_settings.privateAccessAllowed === true,
        unlocked: AUDIT_settings.mode !== AUDIT_MODES.ACCOUNTABILITY || Date.now() < AUDIT_unlockedUntil,
        scoreCount: Number(meta.scoreCount) || 0,
        thumbnailCount: Number(meta.thumbnailCount) || 0,
        auditEventCount: Number(meta.auditCount) || 0,
        limits: {
            scores: AUDIT_MAX_SCORE_RECORDS,
            thumbnails: AUDIT_MAX_THUMBNAILS,
            auditEvents: AUDIT_MAX_EVENTS
        }
    };
}

function auditUpdateModeIndicators() {
    if (typeof statusSetAuditMode === 'function') {
        statusSetAuditMode(AUDIT_settings.mode);
    }
    if (typeof bkBroadcastProcessorSettings === 'function') {
        bkBroadcastProcessorSettings();
    }
}

function auditDescribeSettingChange(key, change) {
    const details = { setting: key };
    if (['default_zone', 'video_blocking_mode', 'model_selection', 'backend_selection', 'is_silent_mode_enabled'].includes(key)) {
        if (typeof change.oldValue === 'string' || typeof change.oldValue === 'boolean') {
            details.from = change.oldValue;
        }
        if (typeof change.newValue === 'string' || typeof change.newValue === 'boolean') {
            details.to = change.newValue;
        }
    }
    return details;
}

function auditOnStorageChanged(changes, areaName) {
    if (areaName !== 'local' || AUDIT_settings.mode === AUDIT_MODES.OFF) {
        return;
    }
    const watched = new Set([
        'default_zone',
        'video_blocking_mode',
        'model_selection',
        'backend_selection',
        'is_silent_mode_enabled',
        'site_filtering_settings',
        'url_filter_rules',
        'remember_adaptive_zones'
    ]);
    for (const [key, change] of Object.entries(changes)) {
        if (key === 'site_filtering_settings') {
            const oldSettings = change.oldValue && typeof change.oldValue === 'object'
                ? change.oldValue
                : {};
            const newSettings = change.newValue && typeof change.newValue === 'object'
                ? change.newValue
                : {};
            const hostnames = new Set([...Object.keys(oldSettings), ...Object.keys(newSettings)]);
            for (const hostname of hostnames) {
                const from = typeof oldSettings[hostname] === 'string'
                    ? oldSettings[hostname]
                    : 'default';
                const to = typeof newSettings[hostname] === 'string'
                    ? newSettings[hostname]
                    : 'default';
                if (from !== to) {
                    auditAppendEvent('site-mode-changed', { hostname, from, to }).catch(() => {});
                }
            }
            continue;
        }
        if (watched.has(key)) {
            auditAppendEvent('setting-changed', auditDescribeSettingChange(key, change)).catch(() => {});
        }
    }
}

function auditHandleMessage(request) {
    switch (request?.type) {
        case 'audit.getState':
            return auditGetState();
        case 'audit.setMode':
            return auditSetMode(
                request.mode,
                request.password,
                request.allowIncompletePrivateCoverage === true
            );
        case 'audit.resetPassword':
            return auditResetPassword();
        case 'audit.query':
            return auditQueryWindow(request.startTime, request.endTime, request.binCount);
        case 'audit.getThumbnail':
            return auditGetThumbnail(request.id, request.password);
        case 'audit.checkPrivateCoverage':
            return auditCheckPrivateCoverage('manual').then(() => auditGetState());
        case 'audit.logEvent':
            return auditAppendEvent(request.eventType, request.details || {});
        default:
            return undefined;
    }
}

async function auditInitialize() {
    if (AUDIT_initialized) {
        return;
    }
    AUDIT_initialized = true;
    const stored = await browser.storage.local.get([AUDIT_STORAGE_KEY, AUDIT_HEARTBEAT_KEY]);
    AUDIT_settings = auditNormalizeSettings(stored[AUDIT_STORAGE_KEY]);
    await auditOpenDatabase();
    auditUpdateModeIndicators();
    if (AUDIT_settings.mode !== AUDIT_MODES.OFF) {
        const previousHeartbeat = Number(stored[AUDIT_HEARTBEAT_KEY]);
        const runtimeDetails = Number.isFinite(previousHeartbeat) && previousHeartbeat > 0
            ? { gapSeconds: Math.max(0, Math.round((Date.now() - previousHeartbeat) / 1000)) }
            : { priorHeartbeat: false };
        await auditAppendEvent('tracking-runtime-started', runtimeDetails);
        auditStartHeartbeat();
        await auditCheckPrivateCoverage('startup');
        auditStartPrivateMonitoring();
        await auditRefreshPrivateWindows(true);
    }
}

if (typeof browser !== 'undefined' && browser.runtime && browser.storage) {
    browser.runtime.onMessage.addListener(auditHandleMessage);
    browser.storage.onChanged.addListener(auditOnStorageChanged);
    if (browser.windows?.onCreated) {
        browser.windows.onCreated.addListener(auditOnWindowCreated);
        browser.windows.onRemoved.addListener(auditOnWindowRemoved);
    }
    auditInitialize().catch(error => console.error('AUDIT: initialization failed', error));
}
