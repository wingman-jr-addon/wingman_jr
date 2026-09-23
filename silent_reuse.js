// Silent-mode source that reuses confidently safe images requested by the same
// page. Every call into this file is feature-detected by its caller; removing
// this script from manifest.json and processor.html restores the existing
// collection fallback.

const SMR_ENABLED = true;
const SMR_MAX_SCOPES = 24;
const SMR_MAX_IMAGES_PER_SCOPE = 48;
const SMR_SCOPE_TTL_MS = 10 * 60 * 1000;
const SMR_THUMB_MAX_DIMENSION = 384;
const SMR_MIN_SOURCE_DIMENSION = 64;
const SMR_MIN_SOURCE_AREA = 96 * 96;
const SMR_MIN_COHORT_SIZE = 2;

let SMR_scopes = new Map();

function SMR_makeRequestContext(details) {
    if (!SMR_ENABLED || !details || !Number.isInteger(details.tabId) || details.tabId < 0) {
        return null;
    }

    const pageUrl = details.documentUrl
        || details.originUrl
        || ((details.type === 'main_frame' || details.type === 'sub_frame') ? details.url : '');
    if (!pageUrl) {
        return null;
    }

    let normalizedPageUrl = pageUrl;
    try {
        const parsedPageUrl = new URL(pageUrl);
        parsedPageUrl.hash = '';
        normalizedPageUrl = parsedPageUrl.href;
    } catch (_) { }

    return {
        scopeKey: `${details.tabId}|${details.frameId ?? 0}|${normalizedPageUrl}`,
        sourceUrl: details.url || '',
        requestId: details.requestId || ''
    };
}

function SMR_withSourceSuffix(context, suffix) {
    if (!context) {
        return null;
    }
    return {
        ...context,
        sourceUrl: `${context.sourceUrl || ''}#${suffix || 'inline'}`
    };
}

function SMR_pruneScopes(now = Date.now()) {
    for (const [scopeKey, scope] of SMR_scopes) {
        if (now - scope.lastSeen > SMR_SCOPE_TTL_MS) {
            SMR_scopes.delete(scopeKey);
        }
    }

    if (SMR_scopes.size <= SMR_MAX_SCOPES) {
        return;
    }

    const oldestScopes = [...SMR_scopes.entries()]
        .sort((left, right) => left[1].lastSeen - right[1].lastSeen);
    while (SMR_scopes.size > SMR_MAX_SCOPES && oldestScopes.length > 0) {
        SMR_scopes.delete(oldestScopes.shift()[0]);
    }
}

function SMR_getScope(scopeKey, createIfMissing) {
    if (!scopeKey) {
        return null;
    }

    SMR_pruneScopes();
    let scope = SMR_scopes.get(scopeKey);
    if (!scope && createIfMissing) {
        scope = {
            lastSeen: Date.now(),
            images: []
        };
        SMR_scopes.set(scopeKey, scope);
    }
    if (scope) {
        scope.lastSeen = Date.now();
    }
    return scope;
}

function SMR_isConfidentlySafe(sqrxrScore, threshold) {
    const score = sqrxrScore?.[0]?.[0];
    if (!Number.isFinite(score) || !Number.isFinite(threshold)) {
        return false;
    }

    // Reuse has a stricter admission threshold than ordinary display. This
    // avoids turning borderline passes into repeated placeholders.
    const admissionThreshold = Math.min(threshold * 0.8, threshold - 0.05);
    return score < Math.max(0, admissionThreshold);
}

function SMR_makeThumbnail(img) {
    const scale = Math.min(1, SMR_THUMB_MAX_DIMENSION / Math.max(img.width, img.height));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.fillStyle = '#f4f4f4';
    context.fillRect(0, 0, width, height);
    context.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', 0.72);
}

function SMR_getUrlParts(rawUrl) {
    try {
        const parsed = new URL(rawUrl);
        const lastSlash = parsed.pathname.lastIndexOf('/');
        return {
            host: parsed.host,
            directory: `${parsed.host}${parsed.pathname.slice(0, Math.max(0, lastSlash))}`
        };
    } catch (_) {
        return { host: '', directory: '' };
    }
}

function SMR_observeSafeImage(img, sqrxrScore, threshold, requestContext) {
    if (!SMR_ENABLED || !requestContext?.scopeKey || !SMR_isConfidentlySafe(sqrxrScore, threshold)) {
        return;
    }
    if (img.width < SMR_MIN_SOURCE_DIMENSION || img.height < SMR_MIN_SOURCE_DIMENSION) {
        return;
    }
    if (img.width * img.height < SMR_MIN_SOURCE_AREA) {
        return;
    }

    const scope = SMR_getScope(requestContext.scopeKey, true);
    const sourceUrl = requestContext.sourceUrl || '';
    const duplicateIndex = sourceUrl
        ? scope.images.findIndex(candidate => candidate.sourceUrl === sourceUrl)
        : -1;

    let dataUrl;
    try {
        dataUrl = SMR_makeThumbnail(img);
    } catch (error) {
        WJR_DEBUG && console.warn(`SILENT REUSE: Unable to cache safe image: ${error}`);
        return;
    }

    const urlParts = SMR_getUrlParts(sourceUrl);
    const previousCandidate = duplicateIndex >= 0 ? scope.images[duplicateIndex] : null;
    const now = Date.now();
    const candidate = {
        sourceUrl,
        sourceHost: urlParts.host,
        sourceDirectory: urlParts.directory,
        dataUrl,
        width: img.width,
        height: img.height,
        addedAt: now,
        lastRelevantAt: now,
        reuseCount: previousCandidate?.reuseCount || 0
    };

    if (duplicateIndex >= 0) {
        scope.images.splice(duplicateIndex, 1);
    }
    scope.images.push(candidate);
    while (scope.images.length > SMR_MAX_IMAGES_PER_SCOPE) {
        let evictionIndex = 0;
        for (let index = 1; index < scope.images.length; index++) {
            if (scope.images[index].lastRelevantAt < scope.images[evictionIndex].lastRelevantAt) {
                evictionIndex = index;
            }
        }
        scope.images.splice(evictionIndex, 1);
    }
}

function SMR_hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function SMR_hashUnit(hash, shift) {
    return ((hash >>> shift) & 0xff) / 255;
}

function SMR_pickReplacementSource(targetImg, requestContext) {
    if (!SMR_ENABLED) {
        return null;
    }
    const scope = SMR_getScope(requestContext?.scopeKey, false);
    if (!scope || scope.images.length < SMR_MIN_COHORT_SIZE) {
        return null;
    }

    const targetAspect = targetImg.width / targetImg.height;
    const targetParts = SMR_getUrlParts(requestContext.sourceUrl || '');
    const eligible = scope.images.filter(candidate => {
        const candidateAspect = candidate.width / candidate.height;
        const aspectDelta = Math.abs(Math.log(candidateAspect / targetAspect));
        const widthRatio = candidate.width / targetImg.width;
        const heightRatio = candidate.height / targetImg.height;
        return aspectDelta <= 0.25
            && widthRatio >= 0.45 && widthRatio <= 2.2
            && heightRatio >= 0.45 && heightRatio <= 2.2;
    });

    if (eligible.length < SMR_MIN_COHORT_SIZE) {
        return null;
    }

    const ranked = eligible.map(candidate => {
        const candidateAspect = candidate.width / candidate.height;
        const aspectDelta = Math.abs(Math.log(candidateAspect / targetAspect));
        const sizeDelta = Math.abs(Math.log(candidate.width / targetImg.width))
            + Math.abs(Math.log(candidate.height / targetImg.height));
        const sameDirectory = targetParts.directory
            && candidate.sourceDirectory === targetParts.directory;
        const sameHost = targetParts.host && candidate.sourceHost === targetParts.host;
        const familyBonus = sameDirectory ? 0.65 : (sameHost ? 0.25 : 0);
        return {
            candidate,
            score: aspectDelta * 4 + sizeDelta * 0.65 + candidate.reuseCount * 0.8 - familyBonus
        };
    }).sort((left, right) => left.score - right.score);

    const selectionSeed = `${requestContext.sourceUrl || ''}|${requestContext.requestId || ''}|${targetImg.width}x${targetImg.height}`;
    const hash = SMR_hashString(selectionSeed);
    const selectionPool = ranked.slice(0, Math.min(3, ranked.length));
    const selected = selectionPool[hash % selectionPool.length].candidate;
    selected.reuseCount++;
    selected.lastRelevantAt = Date.now();

    return {
        src: selected.dataUrl,
        label: 'same-page-safe-image',
        isSamePageReuse: true,
        formatting: {
            zoom: 1.015 + SMR_hashUnit(hash, 8) * 0.03,
            focusX: 0.43 + SMR_hashUnit(hash, 16) * 0.14,
            focusY: 0.43 + SMR_hashUnit(hash, 24) * 0.14
        }
    };
}

function SMR_getWatermarkSvg(width, height) {
    const markSize = Math.max(12, Math.min(22, Math.round(Math.min(width, height) * 0.11)));
    const inset = Math.max(3, Math.round(markSize * 0.25));
    const x = Math.max(0, width - markSize - inset);
    const y = Math.max(0, height - markSize - inset);
    const radius = Math.max(3, Math.round(markSize * 0.24));
    const fontSize = Math.max(8, Math.round(markSize * 0.64));
    return `<g opacity="0.58">`
        + `<rect x="${x}" y="${y}" width="${markSize}" height="${markSize}" rx="${radius}" fill="#20242a"/>`
        + `<text x="${x + markSize / 2}" y="${y + markSize * 0.72}" text-anchor="middle" font-family="sans-serif" font-size="${fontSize}" font-weight="600" fill="#fff">W</text>`
        + `</g>`;
}
