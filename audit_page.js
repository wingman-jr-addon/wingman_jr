let AUDPAGE_state = null;
let AUDPAGE_window = null;
let AUDPAGE_blockMarkers = [];
let AUDPAGE_selectedBlock = null;
let AUDPAGE_selectedBlocks = [];
let AUDPAGE_selectedBlockIndex = 0;
let AUDPAGE_thumbnailRequestId = 0;
let AUDPAGE_thumbnailBlur = 5;
let AUDPAGE_sitePage = 0;
const AUDPAGE_TIMELINE_RENDER_SCALE = 2;
const AUDPAGE_SITES_PER_PAGE = 50;
const AUDPAGE_BLOCK_CLUSTER_DISTANCE = 24;
const AUDPAGE_BLOCK_CLUSTER_MAX_MS = 4 * 60 * 60 * 1000;

function audPageStartOfWeek(date = new Date()) {
    const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const day = result.getDay();
    result.setDate(result.getDate() - (day === 0 ? 6 : day - 1));
    return result;
}

function audPageDateInputValue(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function audPageReadStartDate() {
    const value = document.getElementById('week-start').value;
    const parsed = value ? new Date(`${value}T00:00:00`) : audPageStartOfWeek();
    return Number.isFinite(parsed.getTime()) ? parsed : audPageStartOfWeek();
}

function audPageSetStatus(id, message, state = '') {
    const element = document.getElementById(id);
    element.textContent = message;
    element.dataset.state = state;
}

function audPageClampBlur(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return 5;
    }
    return Math.max(0, Math.min(10, Math.round(parsed * 2) / 2));
}

function audPageApplyThumbnailBlur(value) {
    AUDPAGE_thumbnailBlur = audPageClampBlur(value);
    const slider = document.getElementById('thumbnail-blur');
    const output = document.getElementById('thumbnail-blur-value');
    const image = document.getElementById('thumbnail');
    slider.value = String(AUDPAGE_thumbnailBlur);
    output.textContent = `${AUDPAGE_thumbnailBlur}px`;
    image.style.filter = `blur(${AUDPAGE_thumbnailBlur}px)`;
}

function audPageRatingForBlock(block) {
    const storedRating = String(block?.rating || '').toLowerCase();
    if (['safe', 'q', 'r', 'x'].includes(storedRating)) {
        return storedRating;
    }
    return null;
}

function audPageDefaultBlurForRating(rating) {
    return { safe: 0, q: 4, r: 6, x: 10 }[rating] ?? 5;
}

function audPageSelectedMode() {
    return document.querySelector('input[name="audit-mode"]:checked')?.value || 'off';
}

function audPageRenderModeControls() {
    if (!AUDPAGE_state) {
        return;
    }
    const modeInput = document.querySelector(`input[name="audit-mode"][value="${AUDPAGE_state.mode}"]`);
    if (modeInput) {
        modeInput.checked = true;
    }
    const coverage = document.getElementById('coverage');
    coverage.dataset.covered = String(AUDPAGE_state.privateAccessAllowed);
    coverage.textContent = AUDPAGE_state.privateAccessAllowed
        ? 'Private browsing covered'
        : 'Private browsing not covered';
    document.getElementById('private-help').hidden = AUDPAGE_state.privateAccessAllowed;
    document.getElementById('reset-password').hidden = AUDPAGE_state.mode !== 'accountability';
    audPageUpdateModeForm();
}

function audPageUpdateModeForm() {
    if (!AUDPAGE_state) {
        return;
    }
    const selected = audPageSelectedMode();
    document.querySelectorAll('.mode-options label').forEach(label => {
        label.classList.toggle('selected', label.querySelector('input')?.checked === true);
    });
    const needsPassword = selected === 'accountability'
        ? AUDPAGE_state.mode !== 'accountability'
        : AUDPAGE_state.mode === 'accountability';
    document.getElementById('password-panel').hidden = !needsPassword;
    document.getElementById('password-label').textContent = selected === 'accountability'
        ? 'Create accountability password'
        : 'Current accountability password';
    document.getElementById('password-help').textContent = selected === 'accountability'
        ? 'At least 8 characters. It will be required to reveal thumbnails or lower this mode.'
        : 'Required to lower or turn off Accountability.';
    const incomplete = selected === 'accountability' && !AUDPAGE_state.privateAccessAllowed;
    document.getElementById('private-ack').hidden = !incomplete;
}

async function audPageLoadState() {
    AUDPAGE_state = await browser.runtime.sendMessage({ type: 'audit.getState' });
    audPageRenderModeControls();
}

async function audPageApplyMode() {
    const selected = audPageSelectedMode();
    const password = document.getElementById('mode-password').value;
    const allowIncomplete = document.getElementById('allow-incomplete-private').checked;
    audPageSetStatus('mode-status', 'Applying…');
    try {
        AUDPAGE_state = await browser.runtime.sendMessage({
            type: 'audit.setMode',
            mode: selected,
            password,
            allowIncompletePrivateCoverage: allowIncomplete
        });
        document.getElementById('mode-password').value = '';
        audPageRenderModeControls();
        audPageSetStatus('mode-status', `Mode set to ${selected}.`, 'saved');
        await audPageLoadTimeline();
    } catch (error) {
        audPageSetStatus('mode-status', error.message || String(error), 'error');
    }
}

async function audPageCheckPrivate() {
    audPageSetStatus('mode-status', 'Checking private browsing access…');
    try {
        AUDPAGE_state = await browser.runtime.sendMessage({ type: 'audit.checkPrivateCoverage' });
        audPageRenderModeControls();
        audPageSetStatus(
            'mode-status',
            AUDPAGE_state.privateAccessAllowed
                ? 'Private browsing coverage is enabled.'
                : 'Private browsing coverage is still unavailable.',
            AUDPAGE_state.privateAccessAllowed ? 'saved' : 'error'
        );
        await audPageLoadTimeline();
    } catch (error) {
        audPageSetStatus('mode-status', error.message || String(error), 'error');
    }
}

async function audPageResetPassword() {
    if (!confirm('Destroy all retained audit history and thumbnails, turn tracking off, and leave only a reset tombstone?')) {
        return;
    }
    audPageSetStatus('mode-status', 'Destroying retained audit data…');
    try {
        AUDPAGE_state = await browser.runtime.sendMessage({ type: 'audit.resetPassword' });
        audPageRenderModeControls();
        audPageSetStatus('mode-status', 'Audit data destroyed. A reset tombstone remains.', 'saved');
        await audPageLoadTimeline();
    } catch (error) {
        audPageSetStatus('mode-status', error.message || String(error), 'error');
    }
}

function audPageHeatColor(heat, count) {
    const strength = Math.max(0, Math.min(1, (heat + 6) / 12));
    const alpha = Math.max(0.22, Math.min(1, 0.28 + Math.log2(count + 1) / 4));
    let red;
    let green;
    let blue;
    if (strength < 0.5) {
        const t = strength * 2;
        red = Math.round(139 + (244 - 139) * t);
        green = Math.round(185 + (180 - 185) * t);
        blue = Math.round(232 + (60 - 232) * t);
    } else {
        const t = (strength - 0.5) * 2;
        red = Math.round(244 + (211 - 244) * t);
        green = Math.round(180 + (59 - 180) * t);
        blue = Math.round(60 + (47 - 60) * t);
    }
    return `rgba(${red},${green},${blue},${alpha})`;
}

function audPageTimeX(timestamp, startTime, endTime, left, width) {
    return left + Math.max(0, Math.min(1, (timestamp - startTime) / (endTime - startTime))) * width;
}

function audPageDrawDiamond(ctx, x, y, size) {
    ctx.beginPath();
    ctx.moveTo(x, y - size);
    ctx.lineTo(x + size, y);
    ctx.lineTo(x, y + size);
    ctx.lineTo(x - size, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
}

function audPageClusterBlocks(
    blocks,
    startTime,
    endTime,
    left,
    plotWidth,
    maxDistance = AUDPAGE_BLOCK_CLUSTER_DISTANCE,
    maxTimeDistance = AUDPAGE_BLOCK_CLUSTER_MAX_MS
) {
    const positioned = blocks
        .map(block => ({
            block,
            x: audPageTimeX(block.timestamp, startTime, endTime, left, plotWidth)
        }))
        .sort((leftBlock, rightBlock) => leftBlock.x - rightBlock.x);
    const clusters = [];
    for (const item of positioned) {
        const current = clusters[clusters.length - 1];
        if (!current
            || item.x - current.anchorX > maxDistance
            || item.block.timestamp - current.anchorTimestamp > maxTimeDistance) {
            clusters.push({
                anchorX: item.x,
                anchorTimestamp: item.block.timestamp,
                xTotal: item.x,
                x: item.x,
                blocks: [item.block]
            });
            continue;
        }
        current.blocks.push(item.block);
        current.xTotal += item.x;
        current.x = current.xTotal / current.blocks.length;
    }
    return clusters;
}

function audPageDrawBlockCluster(ctx, cluster, y) {
    if (cluster.blocks.length === 1) {
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#d52b1e';
        ctx.lineWidth = 1.6;
        audPageDrawDiamond(ctx, cluster.x, y, 4.5);
        return 8;
    }
    ctx.beginPath();
    ctx.arc(cluster.x, y, 9, 0, Math.PI * 2);
    ctx.fillStyle = '#d52b1e';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = '700 9px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(cluster.blocks.length > 9 ? '9+' : String(cluster.blocks.length), cluster.x, y + 0.5);
    return 12;
}

function audPageEventLabel(type) {
    const labels = {
        'mode-changed': 'Mode changed',
        'tracking-turned-off': 'Tracking turned off',
        'tracking-runtime-started': 'Tracking runtime started',
        'score-buffer-overflow': 'Score buffer overflow',
        'accountability-reset': 'Accountability reset',
        'private-coverage-enabled': 'Private coverage enabled',
        'private-coverage-unavailable': 'Private coverage unavailable',
        'private-coverage-revoked': 'Private coverage revoked',
        'private-session-started': 'Private browsing started',
        'private-session-observed': 'Private browsing active',
        'private-session-ended': 'Private browsing ended',
        'blocked-image-revealed': 'Stored image revealed',
        'page-image-revealed': 'Page image revealed',
        'master-filtering-changed': 'Filtering changed',
        'master-filtering-paused': 'Filtering paused',
        'site-mode-changed': 'Site filtering mode changed',
        'setting-changed': 'Setting changed'
    };
    return labels[type] || type.replace(/-/g, ' ');
}

function audPageRenderTimeline(data) {
    const canvas = document.getElementById('timeline');
    const wrapWidth = canvas.parentElement.clientWidth || 1120;
    const width = Math.max(920, wrapWidth);
    const pageCount = Math.max(1, Math.ceil(data.rows.length / AUDPAGE_SITES_PER_PAGE));
    AUDPAGE_sitePage = Math.max(0, Math.min(AUDPAGE_sitePage, pageCount - 1));
    const pageStart = AUDPAGE_sitePage * AUDPAGE_SITES_PER_PAGE;
    const visibleRows = data.rows.slice(pageStart, pageStart + AUDPAGE_SITES_PER_PAGE);
    const left = 185;
    const right = 18;
    const plotWidth = width - left - right;
    const headerHeight = 48;
    const laneHeight = 30;
    const rowHeight = 36;
    const rowsTop = headerHeight + laneHeight * 2 + 8;
    const height = rowsTop + Math.max(1, visibleRows.length) * rowHeight + 24;
    canvas.dataset.logicalWidth = String(width);
    canvas.dataset.logicalHeight = String(height);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.width = Math.ceil(width * AUDPAGE_TIMELINE_RENDER_SCALE);
    canvas.height = Math.ceil(height * AUDPAGE_TIMELINE_RENDER_SCALE);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(
        canvas.width / width,
        0,
        0,
        canvas.height / height,
        0,
        0
    );
    ctx.imageSmoothingEnabled = true;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.font = '12px Segoe UI, sans-serif';
    ctx.textBaseline = 'middle';
    AUDPAGE_blockMarkers = [];

    for (let day = 0; day <= 7; day++) {
        const x = left + plotWidth * day / 7;
        ctx.strokeStyle = day === 0 || day === 7 ? '#aab5c4' : '#dfe4ec';
        ctx.beginPath();
        ctx.moveTo(x, 28);
        ctx.lineTo(x, height);
        ctx.stroke();
        if (day < 7) {
            const date = new Date(data.startTime + day * 24 * 60 * 60 * 1000);
            ctx.fillStyle = '#4f5b75';
            ctx.textAlign = 'center';
            ctx.fillText(date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }), x + plotWidth / 14, 18);
        }
    }

    const lanes = [
        { label: 'Private browsing', intervals: data.privateSessions, color: 'rgba(114,87,180,0.55)' },
        { label: 'Coverage unavailable', intervals: data.coverageGaps, color: 'rgba(180,35,24,0.38)' }
    ];
    lanes.forEach((lane, index) => {
        const y = headerHeight + index * laneHeight;
        ctx.fillStyle = '#f5f7fa';
        ctx.fillRect(0, y, width, laneHeight - 2);
        ctx.fillStyle = '#1f2a44';
        ctx.textAlign = 'left';
        ctx.fillText(lane.label, 10, y + (laneHeight - 2) / 2);
        for (const interval of lane.intervals) {
            const x1 = audPageTimeX(interval.start, data.startTime, data.endTime, left, plotWidth);
            const x2 = audPageTimeX(interval.end, data.startTime, data.endTime, left, plotWidth);
            ctx.fillStyle = lane.color;
            ctx.fillRect(x1, y + 5, Math.max(2, x2 - x1), laneHeight - 12);
        }
    });

    visibleRows.forEach((row, rowIndex) => {
        const y = rowsTop + rowIndex * rowHeight;
        if (rowIndex % 2 === 0) {
            ctx.fillStyle = '#fafbfd';
            ctx.fillRect(0, y, width, rowHeight);
        }
        ctx.fillStyle = '#1f2a44';
        ctx.textAlign = 'left';
        ctx.font = '600 12px Segoe UI, sans-serif';
        ctx.fillText(row.hostname, 10, y + 12);
        ctx.fillStyle = '#69778f';
        ctx.font = '11px Segoe UI, sans-serif';
        ctx.fillText(`${row.count.toLocaleString()} checks${row.privateCount ? ` · ${row.privateCount.toLocaleString()} private` : ''}`, 10, y + 27);
        const binWidth = plotWidth / data.binCount;
        for (const bin of row.bins) {
            const x = left + bin.index * binWidth;
            ctx.fillStyle = audPageHeatColor(bin.heat, bin.count);
            ctx.fillRect(x + 0.5, y + 7, Math.max(1, binWidth - 1), rowHeight - 14);
            if (bin.privateCount > 0) {
                ctx.fillStyle = 'rgba(87,61,150,0.9)';
                ctx.fillRect(x + 0.5, y + 7, Math.max(1, binWidth - 1), 2);
            }
        }
        const blockClusters = audPageClusterBlocks(
            row.blocks.map(block => ({ ...block, hostname: row.hostname })),
            data.startTime,
            data.endTime,
            left,
            plotWidth
        );
        for (const cluster of blockClusters) {
            const markerY = y + rowHeight / 2;
            const radius = audPageDrawBlockCluster(ctx, cluster, markerY);
            AUDPAGE_blockMarkers.push({
                x: cluster.x,
                y: markerY,
                radius,
                blocks: cluster.blocks
            });
        }
    });

    for (const event of data.events) {
        const x = audPageTimeX(event.timestamp, data.startTime, data.endTime, left, plotWidth);
        ctx.strokeStyle = 'rgba(31, 67, 113, 0.46)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, headerHeight);
        ctx.lineTo(x, height - 12);
        ctx.stroke();
    }

    const pageEnd = Math.min(data.rows.length, pageStart + visibleRows.length);
    document.getElementById('site-page').textContent = data.rows.length
        ? `Sites ${pageStart + 1}–${pageEnd} of ${data.rows.length}`
        : 'Sites 0–0 of 0';
    document.getElementById('previous-sites').disabled = AUDPAGE_sitePage === 0;
    document.getElementById('next-sites').disabled = AUDPAGE_sitePage >= pageCount - 1;
    audPageSetStatus('timeline-status', data.rows.length ? '' : 'No filtering scores in this week.');
}

function audPageRenderIntegrity(integrity) {
    const badge = document.getElementById('integrity-status');
    const valid = integrity?.valid === true;
    badge.dataset.covered = String(valid);
    if (!integrity || integrity.checked === 0) {
        badge.textContent = 'No chained events in range';
    } else if (valid) {
        badge.textContent = integrity.headChecked
            ? `Hash chain verified · ${integrity.checked.toLocaleString()} events`
            : `Hash chain verified through week · ${integrity.checked.toLocaleString()} events`;
    } else {
        badge.textContent = 'Hash chain verification failed';
    }
}

function audPageFormatDetails(details) {
    const parts = [];
    for (const [key, value] of Object.entries(details || {})) {
        parts.push(`${key.replace(/([A-Z])/g, ' $1')}: ${value}`);
    }
    return parts.join(' · ');
}

function audPageRenderLog(events) {
    const body = document.getElementById('audit-log');
    body.textContent = '';
    for (const event of [...events].reverse()) {
        const row = document.createElement('tr');
        const time = document.createElement('td');
        const name = document.createElement('td');
        const details = document.createElement('td');
        time.textContent = new Date(event.timestamp).toLocaleString();
        name.textContent = audPageEventLabel(event.type);
        details.textContent = audPageFormatDetails(event.details);
        row.append(time, name, details);
        body.append(row);
    }
    if (events.length === 0) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 3;
        cell.className = 'muted';
        cell.textContent = 'No audit events in this week.';
        row.append(cell);
        body.append(row);
    }
}

async function audPageLoadTimeline() {
    const start = audPageReadStartDate();
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    audPageSetStatus('timeline-status', 'Loading…');
    try {
        AUDPAGE_window = await browser.runtime.sendMessage({
            type: 'audit.query',
            startTime: start.getTime(),
            endTime: end.getTime(),
            binCount: 168
        });
        document.getElementById('summary-checks').textContent = AUDPAGE_window.totals.checks.toLocaleString();
        document.getElementById('summary-blocked').textContent = AUDPAGE_window.totals.blocked.toLocaleString();
        document.getElementById('summary-private').textContent = AUDPAGE_window.totals.privateChecks.toLocaleString();
        document.getElementById('summary-events').textContent = AUDPAGE_window.totals.auditEvents.toLocaleString();
        audPageRenderTimeline(AUDPAGE_window);
        audPageRenderLog(AUDPAGE_window.events);
        audPageRenderIntegrity(AUDPAGE_window.integrity);
    } catch (error) {
        audPageSetStatus('timeline-status', error.message || String(error), 'error');
    }
}

function audPageShiftWeek(days) {
    const start = audPageReadStartDate();
    start.setDate(start.getDate() + days);
    document.getElementById('week-start').value = audPageDateInputValue(start);
    AUDPAGE_sitePage = 0;
    audPageLoadTimeline();
}

function audPageShiftSites(delta) {
    AUDPAGE_sitePage += delta;
    if (AUDPAGE_window) {
        audPageRenderTimeline(AUDPAGE_window);
    }
}

function audPageClusterTimeSummary(blocks) {
    const first = new Date(blocks[0].timestamp);
    const last = new Date(blocks[blocks.length - 1].timestamp);
    if (blocks.length === 1) {
        return 'One blocked image at this point on the timeline.';
    }
    const firstText = first.toLocaleString();
    const lastText = last.toLocaleString();
    return `${blocks.length.toLocaleString()} blocked images between ${firstText} and ${lastText}.`;
}

function audPageRenderSelectedBlock() {
    AUDPAGE_thumbnailRequestId++;
    AUDPAGE_selectedBlock = AUDPAGE_selectedBlocks[AUDPAGE_selectedBlockIndex] || null;
    if (!AUDPAGE_selectedBlock) {
        return;
    }
    const block = AUDPAGE_selectedBlock;
    const rating = audPageRatingForBlock(block);
    audPageApplyThumbnailBlur(audPageDefaultBlurForRating(rating));
    document.getElementById('thumbnail-domain').textContent = block.hostname;
    document.getElementById('thumbnail-position').textContent = `${AUDPAGE_selectedBlockIndex + 1} of ${AUDPAGE_selectedBlocks.length}`;
    document.getElementById('previous-thumbnail').disabled = AUDPAGE_selectedBlockIndex === 0;
    document.getElementById('next-thumbnail').disabled = AUDPAGE_selectedBlockIndex >= AUDPAGE_selectedBlocks.length - 1;
    const ratingLabel = rating === 'safe' ? 'Safe' : (rating ? rating.toUpperCase() : 'Unknown rating');
    document.getElementById('thumbnail-meta').textContent = `${new Date(block.timestamp).toLocaleString()} · ${ratingLabel} · score ${(block.score * 100).toFixed(1)}%${block.private ? ' · private window' : ''}`;
    const image = document.getElementById('thumbnail');
    image.hidden = true;
    image.removeAttribute('src');
    const locked = document.getElementById('thumbnail-locked');
    locked.hidden = false;
    locked.textContent = block.thumbnailId ? 'Thumbnail locked' : 'Thumbnail expired or unavailable';
    document.getElementById('thumbnail-password').value = '';
    audPageSetStatus('thumbnail-status', '');
    if (!block.thumbnailId) {
        document.getElementById('thumbnail-password-row').hidden = true;
        audPageSetStatus('thumbnail-status', 'This block remains in score history, but its bounded thumbnail has expired.', 'error');
        return;
    }
    document.getElementById('thumbnail-password-row').hidden = AUDPAGE_state.mode !== 'accountability';
    if (AUDPAGE_state.mode !== 'accountability' || AUDPAGE_state.unlocked) {
        audPageFetchThumbnail('');
    }
}

function audPageOpenBlockCluster(blocks) {
    AUDPAGE_selectedBlocks = [...blocks].sort((left, right) => left.timestamp - right.timestamp);
    AUDPAGE_selectedBlockIndex = 0;
    document.getElementById('thumbnail-drawer').hidden = false;
    document.getElementById('thumbnail-cluster-summary').textContent = audPageClusterTimeSummary(AUDPAGE_selectedBlocks);
    audPageRenderSelectedBlock();
}

function audPageShiftSelectedBlock(delta) {
    const nextIndex = AUDPAGE_selectedBlockIndex + delta;
    if (nextIndex < 0 || nextIndex >= AUDPAGE_selectedBlocks.length) {
        return;
    }
    AUDPAGE_selectedBlockIndex = nextIndex;
    audPageRenderSelectedBlock();
}

function audPageRgb332DataUrl(buffer, width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(width, height);
    const packed = new Uint8Array(buffer);
    for (let source = 0, target = 0; source < packed.length; source++, target += 4) {
        const value = packed[source];
        imageData.data[target] = Math.round(((value >> 5) & 7) * 255 / 7);
        imageData.data[target + 1] = Math.round(((value >> 2) & 7) * 255 / 7);
        imageData.data[target + 2] = Math.round((value & 3) * 255 / 3);
        imageData.data[target + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/png');
}

async function audPageFetchThumbnail(password) {
    if (!AUDPAGE_selectedBlock || !AUDPAGE_selectedBlock.thumbnailId) {
        return;
    }
    const requestedThumbnailId = AUDPAGE_selectedBlock.thumbnailId;
    const requestId = ++AUDPAGE_thumbnailRequestId;
    audPageSetStatus('thumbnail-status', 'Loading…');
    try {
        const result = await browser.runtime.sendMessage({
            type: 'audit.getThumbnail',
            id: requestedThumbnailId,
            password
        });
        if (requestId !== AUDPAGE_thumbnailRequestId
            || AUDPAGE_selectedBlock?.thumbnailId !== requestedThumbnailId) {
            return;
        }
        if (result.locked) {
            document.getElementById('thumbnail-password-row').hidden = false;
            audPageSetStatus('thumbnail-status', password ? 'Incorrect password.' : 'Enter the accountability password.', password ? 'error' : '');
            return;
        }
        if (!result.ok) {
            document.getElementById('thumbnail-locked').textContent = 'Thumbnail expired or unavailable';
            audPageSetStatus('thumbnail-status', 'Thumbnail is no longer available.', 'error');
            return;
        }
        const image = document.getElementById('thumbnail');
        image.src = audPageRgb332DataUrl(result.data, result.width, result.height);
        image.hidden = false;
        document.getElementById('thumbnail-locked').hidden = true;
        document.getElementById('thumbnail-password-row').hidden = true;
        AUDPAGE_state.unlocked = true;
        audPageSetStatus('thumbnail-status', result.private ? 'Captured in a private window.' : '');
        audPageLoadTimeline();
    } catch (error) {
        audPageSetStatus('thumbnail-status', error.message || String(error), 'error');
    }
}

function audPageMarkerFromPointer(event) {
    const canvas = document.getElementById('timeline');
    const rect = canvas.getBoundingClientRect();
    const logicalWidth = Number(canvas.dataset.logicalWidth) || rect.width;
    const logicalHeight = Number(canvas.dataset.logicalHeight) || rect.height;
    const x = (event.clientX - rect.left) * logicalWidth / rect.width;
    const y = (event.clientY - rect.top) * logicalHeight / rect.height;
    return AUDPAGE_blockMarkers.find(candidate =>
        Math.hypot(candidate.x - x, candidate.y - y) <= candidate.radius
    );
}

function audPageOnTimelineClick(event) {
    const marker = audPageMarkerFromPointer(event);
    if (marker) {
        audPageOpenBlockCluster(marker.blocks);
    }
}

function audPageOnTimelinePointerMove(event) {
    const canvas = document.getElementById('timeline');
    const marker = audPageMarkerFromPointer(event);
    canvas.style.cursor = marker ? 'pointer' : 'default';
    canvas.title = marker
        ? `${marker.blocks.length} blocked ${marker.blocks.length === 1 ? 'image' : 'images'} — click to inspect`
        : '';
}

async function audPageInitialize() {
    document.getElementById('week-start').value = audPageDateInputValue(audPageStartOfWeek());
    await audPageLoadState();
    await audPageLoadTimeline();
}

if (typeof document !== 'undefined' && typeof browser !== 'undefined') {
    document.querySelectorAll('input[name="audit-mode"]').forEach(input => {
        input.addEventListener('change', audPageUpdateModeForm);
    });
    document.getElementById('apply-mode').addEventListener('click', audPageApplyMode);
    document.getElementById('check-private').addEventListener('click', audPageCheckPrivate);
    document.getElementById('reset-password').addEventListener('click', audPageResetPassword);
    document.getElementById('previous-week').addEventListener('click', () => audPageShiftWeek(-7));
    document.getElementById('next-week').addEventListener('click', () => audPageShiftWeek(7));
    document.getElementById('week-start').addEventListener('change', () => {
        AUDPAGE_sitePage = 0;
        audPageLoadTimeline();
    });
    document.getElementById('previous-sites').addEventListener('click', () => audPageShiftSites(-1));
    document.getElementById('next-sites').addEventListener('click', () => audPageShiftSites(1));
    document.getElementById('timeline').addEventListener('click', audPageOnTimelineClick);
    document.getElementById('timeline').addEventListener('mousemove', audPageOnTimelinePointerMove);
    document.getElementById('previous-thumbnail').addEventListener('click', () => audPageShiftSelectedBlock(-1));
    document.getElementById('next-thumbnail').addEventListener('click', () => audPageShiftSelectedBlock(1));
    document.getElementById('thumbnail-blur').addEventListener('input', event => {
        audPageApplyThumbnailBlur(event.target.value);
    });
    document.getElementById('close-drawer').addEventListener('click', () => {
        AUDPAGE_thumbnailRequestId++;
        document.getElementById('thumbnail-drawer').hidden = true;
    });
    document.getElementById('unlock-thumbnail').addEventListener('click', () => {
        audPageFetchThumbnail(document.getElementById('thumbnail-password').value);
    });
    document.getElementById('thumbnail-password').addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            audPageFetchThumbnail(event.target.value);
        }
    });
    window.addEventListener('resize', () => {
        if (AUDPAGE_window) {
            audPageRenderTimeline(AUDPAGE_window);
        }
    });

    audPageInitialize().catch(error => {
        audPageSetStatus('mode-status', error.message || String(error), 'error');
    });
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        audPageClampBlur,
        audPageClusterBlocks,
        audPageDefaultBlurForRating,
        audPageRatingForBlock
    };
}
