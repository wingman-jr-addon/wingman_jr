const STORAGE_KEYS = {
    collections: 'silent_custom_collections',
    activeCollection: 'silent_custom_active_collection_id'
};

const MAX_COLLECTION_BYTES = 3 * 1024 * 1024;
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
    detailMetaEl.textContent = `${collection.images.length} images · ${formatBytes(sizeBytes)} of ${formatBytes(MAX_COLLECTION_BYTES)} used`;
    setActiveButton.textContent = activeCollectionId === collection.id
        ? 'Active collection'
        : 'Use this collection for silent mode';
    setActiveButton.disabled = activeCollectionId === collection.id;

    imageGridEl.innerHTML = '';
    collection.images.forEach(image => {
        const card = document.createElement('div');
        card.className = 'image-card';
        card.innerHTML = `
            <img src="${image.dataUrl}" alt="Custom silent image">
            <div class="image-actions">
              <span>${formatBytes(image.bytes || approximateDataUrlBytes(image.dataUrl))}</span>
              <button class="danger" data-action="remove-image" data-id="${collection.id}" data-image-id="${image.id}">Remove</button>
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

async function addImagesToCollection(collectionId, files) {
    const collectionIndex = collections.findIndex(item => item.id === collectionId);
    if (collectionIndex === -1) {
        setStatus('Select a collection before adding images.', true);
        return;
    }
    const collection = collections[collectionIndex];
    let currentSize = getCollectionSizeBytes(collection);
    const newImages = [];
    const errors = [];

    for (const file of files) {
        if (!file.type.startsWith('image/')) {
            errors.push(`${file.name} is not an image.`);
            continue;
        }
        try {
            const converted = await convertImageToJpeg(file);
            if (currentSize + converted.bytes > MAX_COLLECTION_BYTES) {
                errors.push(`${file.name} would exceed the 3 MB collection limit.`);
                continue;
            }
            currentSize += converted.bytes;
            newImages.push(converted);
        } catch (error) {
            errors.push(`${file.name} failed to import.`);
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
    const files = Array.from(event.target.files || []);
    if (files.length === 0) {
        return;
    }
    await addImagesToCollection(selectedCollectionId, files);
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
    const files = Array.from(event.dataTransfer.files || []);
    if (files.length === 0) {
        return;
    }
    await addImagesToCollection(selectedCollectionId, files);
});

loadState();
