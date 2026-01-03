const STORAGE_KEYS = {
    collections: 'silent_custom_collections',
    activeCollection: 'silent_custom_active_collection_id'
};

const MAX_COLLECTION_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_BYTES = 100 * 1024;
const MAX_IMAGE_DIMENSION = 512;
const IMAGE_QUALITY_STEPS = [0.7, 0.6, 0.5, 0.4];

let collections = [];
let activeCollectionId = 'builtin';
let selectedCollectionId = null;

const statusEl = document.getElementById('status');
const collectionListEl = document.getElementById('collection-list');
const detailEl = document.getElementById('detail');
const detailTitleEl = document.getElementById('detail-title');
const detailMetaEl = document.getElementById('detail-meta');
const imageGridEl = document.getElementById('image-grid');
const dropZoneEl = document.getElementById('drop-zone');
const fileInputEl = document.getElementById('file-input');
const setActiveButton = document.getElementById('set-active');
const searchPanelEl = document.getElementById('search-panel');
const searchProviderEl = document.getElementById('search-provider');
const searchQueryEl = document.getElementById('search-query');
const searchSubmitEl = document.getElementById('search-submit');
const searchMoreEl = document.getElementById('search-more');
const searchSelectAllEl = document.getElementById('search-select-all');
const searchAddEl = document.getElementById('search-add');
const searchResultsEl = document.getElementById('search-results');
const searchMetaEl = document.getElementById('search-meta');
const defaultSearchAddLabel = searchAddEl.textContent;
const licenseLinksEl = document.getElementById('license-links');

let searchResults = [];
let searchSelectedIds = new Set();
let searchNextPage = 0;
let searchHasMore = false;
let searchInFlight = false;
let lastSearchAt = 0;
let lastRequestDelay = 0;
let lastDownloadAt = 0;
const DOWNLOAD_THROTTLE_MS = 1000;

function setStatus(message, isError = false) {
    if (!message) {
        statusEl.hidden = true;
        statusEl.classList.remove('error');
        statusEl.textContent = '';
        return;
    }
    statusEl.hidden = false;
    statusEl.classList.toggle('error', isError);
    statusEl.textContent = message;
}

function approximateDataUrlBytes(dataUrl) {
    if (!dataUrl) {
        return 0;
    }
    const base64Length = dataUrl.length - dataUrl.indexOf(',') - 1;
    return Math.floor(base64Length * 0.75);
}

function getLicenseInfo(licenseId, licenseUrl) {
    const fallback = LICENSES.UNKNOWN || { label: 'License not specified', url: '' };
    if (!licenseId) {
        return { ...fallback, url: licenseUrl || fallback.url };
    }
    const fromMap = LICENSES[licenseId];
    if (fromMap) {
        return { ...fromMap, url: licenseUrl || fromMap.url };
    }
    return { label: licenseId, url: licenseUrl || '' };
}

function formatAttribution(attribution) {
    if (!attribution) {
        return {
            sourceLabel: 'Attribution unavailable',
            sourceUrl: '',
            creatorLabel: 'Creator unknown',
            creatorUrl: '',
            license: getLicenseInfo(null, '')
        };
    }
    const license = getLicenseInfo(attribution.licenseId, attribution.licenseUrl);
    return {
        sourceLabel: attribution.source || attribution.sourceLabel || 'Source',
        sourceUrl: attribution.sourceUrl || '',
        creatorLabel: attribution.creator || attribution.creatorLabel || 'Creator',
        creatorUrl: attribution.creatorUrl || '',
        title: attribution.title || '',
        license
    };
}

function getCollectionSizeBytes(collection) {
    return collection.images.reduce((total, image) => {
        if (image.bytes) {
            return total + image.bytes;
        }
        return total + approximateDataUrlBytes(image.dataUrl);
    }, 0);
}

function formatBytes(bytes) {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function normalizeName(name) {
    return name.trim().replace(/\s+/g, ' ');
}

function getBuiltInCollection() {
    const images = (typeof SM_DATA === 'undefined' ? [] : SM_DATA).map((entry, index) => ({
        id: `builtin-${index}`,
        dataUrl: entry.file,
        width: entry.w,
        height: entry.h,
        bytes: 0,
        attribution: {
            creatorLabel: 'Unsplash contributor',
            sourceLabel: 'Unsplash',
            sourceUrl: entry.credits || '',
            licenseId: 'UNSPLASH'
        }
    }));
    return {
        id: 'builtin',
        name: 'Built-in collection',
        images,
        isBuiltin: true
    };
}

function makeId(prefix = 'collection') {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function loadState() {
    try {
        const result = await browser.storage.local.get([STORAGE_KEYS.collections, STORAGE_KEYS.activeCollection]);
        collections = result[STORAGE_KEYS.collections] || [];
        activeCollectionId = result[STORAGE_KEYS.activeCollection] || 'builtin';
        renderCollections();
    } catch (error) {
        setStatus(`Unable to load collections: ${error}`, true);
    }
}

async function saveState() {
    try {
        await browser.storage.local.set({
            [STORAGE_KEYS.collections]: collections,
            [STORAGE_KEYS.activeCollection]: activeCollectionId
        });
        setStatus('Collections updated.');
    } catch (error) {
        setStatus(`Failed to save collections. Check storage permissions or free up space. (${error})`, true);
        throw error;
    }
}

function renderCollections() {
    collectionListEl.innerHTML = '';

    const builtInCard = document.createElement('div');
    builtInCard.className = `collection-card ${activeCollectionId === 'builtin' ? 'active' : ''}`;
    builtInCard.innerHTML = `
        <strong>Built-in collection</strong>
        <div class="collection-meta">Safe images included with the add-on.</div>
        <div class="row">
          <button class="secondary" data-action="open" data-id="builtin">View details</button>
          <button class="secondary" data-action="activate" data-id="builtin">Use built-in collection</button>
          <a href="silent_credits.html" target="_blank" class="muted">View credits</a>
        </div>
    `;
    collectionListEl.appendChild(builtInCard);

    collections.forEach(collection => {
        const card = document.createElement('div');
        card.className = `collection-card ${activeCollectionId === collection.id ? 'active' : ''}`;
        const sizeBytes = getCollectionSizeBytes(collection);
        const previewImages = collection.images.slice(0, 4).map(image => `
            <img src="${image.dataUrl}" alt="${collection.name} preview">
        `).join('');
        card.innerHTML = `
            <strong>${collection.name}</strong>
            <div class="collection-meta">${collection.images.length} images · ${formatBytes(sizeBytes)}</div>
            <div class="preview-grid">${previewImages || '<span class="muted">No images yet.</span>'}</div>
            <div class="row">
              <button class="secondary" data-action="open" data-id="${collection.id}">Manage</button>
              <button data-action="activate" data-id="${collection.id}">Use this collection</button>
              <button class="danger" data-action="delete" data-id="${collection.id}">Delete</button>
            </div>
        `;
        collectionListEl.appendChild(card);
    });

    if (selectedCollectionId) {
        if (selectedCollectionId === 'builtin') {
            renderDetail(getBuiltInCollection());
            return;
        }
        const found = collections.find(collection => collection.id === selectedCollectionId);
        if (found) {
            renderDetail(found);
        } else {
            selectedCollectionId = null;
            detailEl.classList.remove('active');
        }
    }
}

function renderDetail(collection) {
    detailEl.classList.add('active');
    detailTitleEl.textContent = `Collection: ${collection.name}`;
    const sizeBytes = getCollectionSizeBytes(collection);
    detailMetaEl.textContent = collection.isBuiltin
        ? `${collection.images.length} images · Built-in collection (read-only)`
        : `${collection.images.length} images · ${formatBytes(sizeBytes)} of ${formatBytes(MAX_COLLECTION_BYTES)} used`;
    setActiveButton.textContent = activeCollectionId === collection.id
        ? 'Active collection'
        : 'Use this collection for silent mode';
    setActiveButton.disabled = activeCollectionId === collection.id;
    const isBuiltin = collection.isBuiltin || collection.id === 'builtin';
    dropZoneEl.hidden = isBuiltin;
    document.getElementById('add-images').disabled = isBuiltin;
    searchPanelEl.hidden = isBuiltin;

    imageGridEl.innerHTML = '';
    collection.images.forEach(image => {
        const card = document.createElement('div');
        card.className = 'image-card';
        const attribution = formatAttribution(image.attribution);
        const sourceHtml = attribution.sourceUrl
            ? `<a href="${attribution.sourceUrl}" target="_blank">${attribution.sourceLabel}</a>`
            : attribution.sourceLabel;
        const creatorHtml = attribution.creatorUrl
            ? `<a href="${attribution.creatorUrl}" target="_blank">${attribution.creatorLabel}</a>`
            : attribution.creatorLabel;
        const licenseHtml = attribution.license.url
            ? `<a href="${attribution.license.url}" target="_blank">${attribution.license.label}</a>`
            : attribution.license.label;
        card.innerHTML = `
            <img src="${image.dataUrl}" alt="Custom silent image">
            <div class="image-actions">
              <span>${formatBytes(image.bytes || approximateDataUrlBytes(image.dataUrl))}</span>
              ${isBuiltin ? '' : `<button class="danger" data-action="remove-image" data-id="${collection.id}" data-image-id="${image.id}">Remove</button>`}
            </div>
            <div class="image-attribution">
              ${attribution.title ? `<span>${attribution.title}</span>` : ''}
              <span>Creator: ${creatorHtml}</span>
              <span>Source: ${sourceHtml}</span>
              <span>License: ${licenseHtml}</span>
            </div>
        `;
        imageGridEl.appendChild(card);
    });
}

async function createCollection(name) {
    const normalizedName = normalizeName(name);
    if (!normalizedName) {
        setStatus('Please enter a collection name.', true);
        return;
    }
    if (collections.some(collection => collection.name.toLowerCase() === normalizedName.toLowerCase())) {
        setStatus('A collection with that name already exists.', true);
        return;
    }
    const newCollection = {
        id: makeId(),
        name: normalizedName,
        images: []
    };
    collections = [...collections, newCollection];
    selectedCollectionId = newCollection.id;
    await saveState();
    renderCollections();
    setStatus('Collection created. Add images below.');
}

async function deleteCollection(collectionId) {
    const collection = collections.find(item => item.id === collectionId);
    if (!collection) {
        return;
    }
    if (!confirm(`Delete "${collection.name}" and all of its images?`)) {
        return;
    }
    collections = collections.filter(item => item.id !== collectionId);
    if (activeCollectionId === collectionId) {
        activeCollectionId = 'builtin';
    }
    if (selectedCollectionId === collectionId) {
        selectedCollectionId = null;
        detailEl.classList.remove('active');
    }
    await saveState();
    renderCollections();
}

async function setActiveCollection(collectionId) {
    activeCollectionId = collectionId;
    await saveState();
    renderCollections();
}

function getImageScaleDimensions(width, height) {
    const maxSide = Math.max(width, height);
    if (maxSide <= MAX_IMAGE_DIMENSION) {
        return { width, height };
    }
    const scale = MAX_IMAGE_DIMENSION / maxSide;
    return {
        width: Math.round(width * scale),
        height: Math.round(height * scale)
    };
}

function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Unable to read image file.'));
        image.src = URL.createObjectURL(file);
    });
}

async function convertImageToJpeg(file) {
    const image = await loadImageFromFile(file);
    const { width, height } = getImageScaleDimensions(image.width, image.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(image, 0, 0, width, height);

    let dataUrl = canvas.toDataURL('image/jpeg', IMAGE_QUALITY_STEPS[0]);
    let bytes = approximateDataUrlBytes(dataUrl);
    for (let i = 1; i < IMAGE_QUALITY_STEPS.length && bytes > MAX_IMAGE_BYTES; i += 1) {
        dataUrl = canvas.toDataURL('image/jpeg', IMAGE_QUALITY_STEPS[i]);
        bytes = approximateDataUrlBytes(dataUrl);
    }

    return {
        id: makeId('image'),
        dataUrl,
        width,
        height,
        bytes
    };
}

async function addImagesToCollection(collectionId, sources) {
    const collectionIndex = collections.findIndex(item => item.id === collectionId);
    if (collectionIndex === -1) {
        setStatus('Select a collection before adding images.', true);
        return;
    }
    const collection = collections[collectionIndex];
    let currentSize = getCollectionSizeBytes(collection);
    const newImages = [];
    const errors = [];

    for (const source of sources) {
        const file = source.file;
        const fileName = file.name || 'image';
        if (!file.type.startsWith('image/')) {
            errors.push(`${fileName} is not an image.`);
            continue;
        }
        try {
            const converted = await convertImageToJpeg(file);
            if (currentSize + converted.bytes > MAX_COLLECTION_BYTES) {
                errors.push(`${fileName} would exceed the 8 MB collection limit.`);
                continue;
            }
            currentSize += converted.bytes;
            newImages.push({
                ...converted,
                attribution: source.attribution || null
            });
        } catch (error) {
            errors.push(`${fileName} failed to import.`);
        }
    }

    if (newImages.length === 0) {
        setStatus(errors.join(' ') || 'No images were added.', true);
        return;
    }

    collections[collectionIndex] = {
        ...collection,
        images: [...collection.images, ...newImages]
    };

    await saveState();
    renderCollections();
    if (errors.length > 0) {
        setStatus(errors.join(' '), true);
    } else {
        setStatus(`Added ${newImages.length} image${newImages.length === 1 ? '' : 's'} to ${collection.name}.`);
    }
}

async function removeImage(collectionId, imageId) {
    const collectionIndex = collections.findIndex(item => item.id === collectionId);
    if (collectionIndex === -1) {
        return;
    }
    const collection = collections[collectionIndex];
    const filtered = collection.images.filter(image => image.id !== imageId);
    collections[collectionIndex] = {
        ...collection,
        images: filtered
    };
    await saveState();
    renderCollections();
}

document.getElementById('create-collection').addEventListener('click', async () => {
    setStatus('');
    const nameInput = document.getElementById('collection-name');
    await createCollection(nameInput.value);
    nameInput.value = '';
});

collectionListEl.addEventListener('click', async event => {
    const action = event.target.getAttribute('data-action');
    if (!action) {
        return;
    }
    const collectionId = event.target.getAttribute('data-id');
    if (action === 'open') {
        selectedCollectionId = collectionId;
        if (collectionId === 'builtin') {
            renderDetail(getBuiltInCollection());
            return;
        }
        const collection = collections.find(item => item.id === collectionId);
        if (collection) {
            renderDetail(collection);
        }
        return;
    }
    if (action === 'activate') {
        await setActiveCollection(collectionId);
        return;
    }
    if (action === 'delete') {
        await deleteCollection(collectionId);
    }
});

imageGridEl.addEventListener('click', async event => {
    const action = event.target.getAttribute('data-action');
    if (action !== 'remove-image') {
        return;
    }
    const collectionId = event.target.getAttribute('data-id');
    if (collectionId === 'builtin') {
        return;
    }
    const imageId = event.target.getAttribute('data-image-id');
    await removeImage(collectionId, imageId);
});

setActiveButton.addEventListener('click', async () => {
    if (!selectedCollectionId) {
        return;
    }
    await setActiveCollection(selectedCollectionId);
});

document.getElementById('add-images').addEventListener('click', () => {
    fileInputEl.click();
});

fileInputEl.addEventListener('change', async event => {
    if (!selectedCollectionId) {
        setStatus('Select a collection before adding images.', true);
        return;
    }
    if (selectedCollectionId === 'builtin') {
        setStatus('The built-in collection is read-only.', true);
        return;
    }
    const files = Array.from(event.target.files || []);
    if (files.length === 0) {
        return;
    }
    const sources = files.map(file => ({
        file,
        attribution: {
            creatorLabel: 'Local upload',
            sourceLabel: 'Your device',
            licenseId: null,
            licenseUrl: ''
        }
    }));
    await addImagesToCollection(selectedCollectionId, sources);
    fileInputEl.value = '';
});

dropZoneEl.addEventListener('dragover', event => {
    event.preventDefault();
    dropZoneEl.classList.add('dragover');
});

dropZoneEl.addEventListener('dragleave', () => {
    dropZoneEl.classList.remove('dragover');
});

dropZoneEl.addEventListener('drop', async event => {
    event.preventDefault();
    dropZoneEl.classList.remove('dragover');
    if (!selectedCollectionId) {
        setStatus('Select a collection before adding images.', true);
        return;
    }
    if (selectedCollectionId === 'builtin') {
        setStatus('The built-in collection is read-only.', true);
        return;
    }
    const files = Array.from(event.dataTransfer.files || []);
    if (files.length === 0) {
        return;
    }
    const sources = files.map(file => ({
        file,
        attribution: {
            creatorLabel: 'Local upload',
            sourceLabel: 'Your device',
            licenseId: null,
            licenseUrl: ''
        }
    }));
    await addImagesToCollection(selectedCollectionId, sources);
});

function renderLicenseLinks() {
    if (!licenseLinksEl) {
        return;
    }
    licenseLinksEl.innerHTML = '';
    ALLOWED_LICENSE_IDS.forEach(licenseId => {
        const license = LICENSES[licenseId];
        if (!license) {
            return;
        }
        const li = document.createElement('li');
        const link = document.createElement('a');
        link.href = license.url;
        link.target = '_blank';
        link.textContent = license.label;
        li.appendChild(link);
        licenseLinksEl.appendChild(li);
    });
}

function populateProviders() {
    searchProviderEl.innerHTML = '';
    Object.entries(SilentImageSearch.providers).forEach(([key, provider]) => {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = provider.label;
        searchProviderEl.appendChild(option);
    });
}

function updateSearchMeta() {
    const selectedCount = searchSelectedIds.size;
    searchMetaEl.textContent = selectedCount
        ? `${selectedCount} selected`
        : '';
    searchAddEl.disabled = selectedCount === 0 || !selectedCollectionId || selectedCollectionId === 'builtin';
    searchSelectAllEl.disabled = searchResults.length === 0;
}

function renderSearchResults() {
    searchResultsEl.innerHTML = '';
    if (searchResults.length === 0) {
        searchResultsEl.innerHTML = '<span class=\"muted\">No results yet. Try a search above.</span>';
        updateSearchMeta();
        return;
    }
    searchResults.forEach(result => {
        const card = document.createElement('div');
        card.className = 'search-card';
        const licenseInfo = getLicenseInfo(result.licenseId, result.licenseUrl);
        const sourceHtml = result.sourceUrl
            ? `<a href=\"${result.sourceUrl}\" target=\"_blank\">Source page</a>`
            : 'Source page';
        const creatorHtml = result.creatorUrl
            ? `<a href=\"${result.creatorUrl}\" target=\"_blank\">${result.creator}</a>`
            : result.creator;
        const licenseHtml = licenseInfo.url
            ? `<a href=\"${licenseInfo.url}\" target=\"_blank\">${licenseInfo.label}</a>`
            : licenseInfo.label;
        const checked = searchSelectedIds.has(result.id) ? 'checked' : '';
        card.innerHTML = `
            <img src=\"${result.thumbnailUrl}\" alt=\"${result.title}\">
            <label class=\"select-overlay\">
              <input type=\"checkbox\" data-id=\"${result.id}\" ${checked}>
              Select
            </label>
            <div class=\"search-info\">
              <strong class=\"search-title\">${result.title}</strong>
              <span>Creator: ${creatorHtml}</span>
              <span>${sourceHtml}</span>
              <span>License: ${licenseHtml}</span>
            </div>
        `;
        searchResultsEl.appendChild(card);
    });
    updateSearchMeta();
}

async function performSearch({ loadNext }) {
    const query = normalizeName(searchQueryEl.value || '');
    if (!query) {
        setStatus('Enter a theme to search for images.', true);
        return;
    }
    if (!selectedCollectionId) {
        setStatus('Select a collection before searching.', true);
        return;
    }
    if (selectedCollectionId === 'builtin') {
        setStatus('The built-in collection is read-only.', true);
        return;
    }
    if (searchInFlight) {
        return;
    }
    const now = Date.now();
    if (now - lastSearchAt < SilentImageSearch.cooldownMs) {
        const waitMs = SilentImageSearch.cooldownMs - (now - lastSearchAt);
        setStatus(`Please wait ${Math.ceil(waitMs / 1000)} seconds before searching again.`, true);
        return;
    }
    searchInFlight = true;
    searchSubmitEl.disabled = true;
    searchMoreEl.disabled = true;
    setStatus('');
    try {
        if (!loadNext) {
            searchNextPage = 0;
            searchResults = [];
        }
        const providerId = searchProviderEl.value;
        const provider = SilentImageSearch.providers[providerId];
        if (!provider) {
            throw new Error('No search provider available.');
        }
        const response = await provider.search(query, searchNextPage);
        searchHasMore = response.nextPage !== null;
        searchNextPage = response.nextPage ?? searchNextPage;
        searchResults = response.results;
        searchSelectedIds = new Set();
        renderSearchResults();
        if (searchResults.length === 0) {
            setStatus('No results matched the allowed licenses. Try another theme.', true);
        }
    } catch (error) {
        setStatus(`Search failed: ${error.message}`, true);
    } finally {
        lastSearchAt = Date.now();
        searchInFlight = false;
        searchSubmitEl.disabled = false;
        searchMoreEl.disabled = !searchHasMore;
    }
}

searchResultsEl.addEventListener('change', event => {
    const checkbox = event.target;
    if (checkbox.tagName !== 'INPUT') {
        return;
    }
    const id = checkbox.getAttribute('data-id');
    if (!id) {
        return;
    }
    if (checkbox.checked) {
        searchSelectedIds.add(id);
    } else {
        searchSelectedIds.delete(id);
    }
    updateSearchMeta();
});

searchSubmitEl.addEventListener('click', () => {
    performSearch({ loadNext: false });
});

searchMoreEl.addEventListener('click', () => {
    if (!searchHasMore) {
        return;
    }
    performSearch({ loadNext: true });
});

searchSelectAllEl.addEventListener('click', () => {
    const selectableIds = searchResults.map(result => result.id);
    const allSelected = selectableIds.length > 0 && selectableIds.every(id => searchSelectedIds.has(id));
    searchSelectedIds = allSelected ? new Set() : new Set(selectableIds);
    renderSearchResults();
});

function getDuplicateKey(entry) {
    if (!entry) {
        return '';
    }
    const sourceUrl = entry.attribution && entry.attribution.sourceUrl;
    if (sourceUrl) {
        return sourceUrl;
    }
    return '';
}

function buildDuplicateSet(collection) {
    const duplicates = new Set();
    if (!collection || !collection.images) {
        return duplicates;
    }
    collection.images.forEach(image => {
        const key = getDuplicateKey(image);
        if (key) {
            duplicates.add(key);
        }
    });
    return duplicates;
}

function getRetryDelayMs(response, attempt) {
    const retryAfter = response.headers.get('retry-after');
    if (retryAfter) {
        const parsed = Number(retryAfter);
        if (!Number.isNaN(parsed)) {
            return parsed * 1000;
        }
    }
    const baseDelay = 700;
    return Math.min(5000, baseDelay * Math.pow(2, attempt));
}

async function fetchWithRetry(url, options = {}) {
    const maxAttempts = 3;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const response = await fetch(url, options);
        if (response.status !== 429) {
            return response;
        }
        const delay = getRetryDelayMs(response, attempt);
        lastRequestDelay = delay;
        await new Promise(resolve => setTimeout(resolve, delay));
    }
    return fetch(url, options);
}

async function throttleRequests() {
    if (lastRequestDelay > 0) {
        await new Promise(resolve => setTimeout(resolve, lastRequestDelay));
        lastRequestDelay = 0;
    }
}

async function throttleDownloads() {
    const now = Date.now();
    if (lastDownloadAt > 0) {
        const elapsed = now - lastDownloadAt;
        if (elapsed < DOWNLOAD_THROTTLE_MS) {
            await new Promise(resolve => setTimeout(resolve, DOWNLOAD_THROTTLE_MS - elapsed));
        }
    }
    lastDownloadAt = Date.now();
}

searchAddEl.addEventListener('click', async () => {
    if (!selectedCollectionId || selectedCollectionId === 'builtin') {
        setStatus('Select a custom collection before importing.', true);
        return;
    }
    const selectedResults = searchResults.filter(result => searchSelectedIds.has(result.id));
    if (selectedResults.length === 0) {
        setStatus('Select images to import first.', true);
        return;
    }
    setStatus('Downloading and importing selected images...');
    searchAddEl.disabled = true;
    searchAddEl.textContent = 'Importing...';
    try {
        const sources = [];
        const collection = collections.find(item => item.id === selectedCollectionId);
        const duplicateKeys = buildDuplicateSet(collection);
        const batchKeys = new Set();
        const errors = [];
        for (const result of selectedResults) {
            const duplicateKey = result.sourceUrl || result.fullUrl;
            if (duplicateKey && (duplicateKeys.has(duplicateKey) || batchKeys.has(duplicateKey))) {
                errors.push(`Skipped duplicate: ${result.title}`);
                continue;
            }
            try {
                await throttleRequests();
                await throttleDownloads();
                const importUrl = result.importUrl || result.fullUrl;
                const response = await fetchWithRetry(importUrl, { credentials: 'omit' });
                if (!response.ok) {
                    errors.push(`Failed to download ${result.title} (${response.status}).`);
                    console.warn('Import download failed', { title: result.title, status: response.status, url: importUrl });
                    continue;
                }
                const blob = await response.blob();
                const file = new File([blob], `${result.id}.jpg`, { type: blob.type || 'image/jpeg' });
                sources.push({
                    file,
                    attribution: {
                        creatorLabel: result.creator,
                        creatorUrl: result.creatorUrl,
                        sourceLabel: result.provider === 'commons' ? 'Wikimedia Commons' : 'Openverse',
                        sourceUrl: result.sourceUrl,
                        title: result.title,
                        licenseId: result.licenseId,
                        licenseUrl: result.licenseUrl
                    }
                });
                if (duplicateKey) {
                    batchKeys.add(duplicateKey);
                }
            } catch (error) {
                errors.push(`Failed to download ${result.title}.`);
                console.warn('Import download error', { title: result.title, error });
            }
        }
        if (sources.length === 0) {
            setStatus(errors.join(' ') || 'No images were imported.', true);
            return;
        }
        await addImagesToCollection(selectedCollectionId, sources);
        if (errors.length > 0) {
            setStatus(errors.join(' '), true);
        }
        searchSelectedIds = new Set();
        searchResults = [];
        renderSearchResults();
        if (searchHasMore) {
            await performSearch({ loadNext: true });
        }
    } catch (error) {
        setStatus(`Import failed: ${error.message}`, true);
    } finally {
        searchAddEl.textContent = defaultSearchAddLabel;
        updateSearchMeta();
    }
});

searchQueryEl.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
        event.preventDefault();
        performSearch({ loadNext: false });
    }
});

loadState();
renderLicenseLinks();
populateProviders();
renderSearchResults();
