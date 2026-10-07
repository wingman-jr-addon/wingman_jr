let AUDPAGE_state = null;
let AUDPAGE_window = null;
let AUDPAGE_selectedBlock = null;
let AUDPAGE_selectedBlocks = [];
let AUDPAGE_selectedBlockIndex = 0;
let AUDPAGE_thumbnailRequestId = 0;
let AUDPAGE_thumbnailBlur = 5;
let AUDPAGE_sitePage = 0;
let AUDPAGE_detailsExpanded = false;
let AUDPAGE_cellPopover = null;
const AUDPAGE_SITES_PER_PAGE = 50;
const AUDPAGE_HOURS_PER_DAY = 24;
const AUDPAGE_DAYS_PER_WEEK = 7;

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
        ? 'Private browsing included'
        : 'Private browsing not included';
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
        ? 'At least 8 characters. You will need it to view blocked images or lower this mode.'
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
                ? 'Private browsing is included.'
                : 'Private browsing is still not included.',
            AUDPAGE_state.privateAccessAllowed ? 'saved' : 'error'
        );
        await audPageLoadTimeline();
    } catch (error) {
        audPageSetStatus('mode-status', error.message || String(error), 'error');
    }
}

async function audPageResetPassword() {
    if (!confirm('Erase all saved history and blocked images, turn tracking off, and record that the history was reset?')) {
        return;
    }
    audPageSetStatus('mode-status', 'Erasing saved history…');
    try {
        AUDPAGE_state = await browser.runtime.sendMessage({ type: 'audit.resetPassword' });
        audPageRenderModeControls();
        audPageSetStatus('mode-status', 'Saved history erased. The reset was recorded.', 'saved');
        await audPageLoadTimeline();
    } catch (error) {
        audPageSetStatus('mode-status', error.message || String(error), 'error');
    }
}

function audPageHeatLevel(heat) {
    if (!Number.isFinite(heat)) {
        return -1;
    }
    if (heat < -3) {
        return 0;
    }
    if (heat < -0.75) {
        return 1;
    }
    if (heat < 0.75) {
        return 2;
    }
    if (heat < 3) {
        return 3;
    }
    return 4;
}

function audPageBinIndex(timestamp, startTime, endTime, binCount = 168) {
    if (!Number.isFinite(timestamp)
        || !Number.isFinite(startTime)
        || !Number.isFinite(endTime)
        || endTime <= startTime
        || binCount <= 0
        || timestamp < startTime
        || timestamp >= endTime) {
        return -1;
    }
    return Math.min(
        binCount - 1,
        Math.max(0, Math.floor((timestamp - startTime) / (endTime - startTime) * binCount))
    );
}

function audPageIntervalOverlapsBin(interval, binStart, binEnd) {
    return interval && interval.start < binEnd && interval.end > binStart;
}

function audPageCountLabel(count) {
    return count > 99 ? '99+' : String(count || '');
}

function audPageWorstRating(blocks) {
    const ranks = { safe: 0, q: 1, r: 2, x: 3 };
    let worst = null;
    for (const block of blocks || []) {
        const rating = audPageRatingForBlock(block);
        if (rating && (worst === null || ranks[rating] > ranks[worst])) {
            worst = rating;
        }
    }
    return worst;
}

function audPageRelativeLogit(score, threshold) {
    if (!Number.isFinite(score) || !Number.isFinite(threshold)) {
        return null;
    }
    const epsilon = 1e-6;
    const safeScore = Math.max(epsilon, Math.min(1 - epsilon, score));
    const safeThreshold = Math.max(epsilon, Math.min(1 - epsilon, threshold));
    return Math.log(safeScore / (1 - safeScore))
        - Math.log(safeThreshold / (1 - safeThreshold));
}

function audPageBlockedHeatLevel(blocks) {
    const ratingLevel = { safe: 2, q: 2, r: 3, x: 4 };
    let level = ratingLevel[audPageWorstRating(blocks)] ?? 2;
    for (const block of blocks || []) {
        const relativeHeat = audPageRelativeLogit(block.score, block.threshold);
        if (relativeHeat !== null) {
            level = Math.max(level, audPageHeatLevel(relativeHeat));
        }
    }
    return Math.max(2, level);
}

function audPageDisplayHeatLevel(bin, blocks) {
    const rawBaseLevel = Math.max(0, audPageHeatLevel(bin?.heat));
    const blockCount = blocks?.length || 0;
    if (!blockCount) {
        return audPageHeatLevel(bin?.heat);
    }
    const checkCount = Math.max(blockCount, Number(bin?.count) || blockCount);
    const blockShare = Math.min(1, blockCount / checkCount);
    const checkEvidence = 1 - Math.exp(-checkCount / 12);
    const baseLevel = rawBaseLevel * checkEvidence;
    const volumeEvidence = 1 - Math.exp(-blockCount / 12);
    const evidence = Math.min(1, volumeEvidence * 0.6 + Math.sqrt(blockShare) * 0.4);
    const severityLevel = audPageBlockedHeatLevel(blocks);
    let displayLevel = Math.round(baseLevel + (severityLevel - baseLevel) * evidence);
    if (evidence >= 0.55 || blockShare >= 0.15) {
        displayLevel = Math.max(2, displayLevel);
    }
    return Math.max(0, Math.min(4, displayLevel));
}

function audPageAppendCountLabel(cell, count) {
    const label = document.createElement('span');
    label.className = 'timeline-count-label';
    if (count > 99) {
        label.append(document.createTextNode('99'));
        const plus = document.createElement('span');
        plus.className = 'timeline-count-plus';
        plus.textContent = '+';
        label.append(plus);
    } else {
        label.textContent = String(count);
    }
    cell.append(label);
}

function audPageDismissCellPopover() {
    if (AUDPAGE_cellPopover) {
        AUDPAGE_cellPopover.remove();
        AUDPAGE_cellPopover = null;
    }
}

function audPageShowCellPopover(cell, message) {
    audPageDismissCellPopover();
    const popover = document.createElement('div');
    popover.className = 'timeline-cell-popover';
    popover.setAttribute('role', 'status');
    popover.textContent = message;
    document.body.append(popover);

    const cellBounds = cell.getBoundingClientRect();
    const popoverBounds = popover.getBoundingClientRect();
    const margin = 8;
    const centeredLeft = cellBounds.left + cellBounds.width / 2 - popoverBounds.width / 2;
    const left = Math.max(margin, Math.min(window.innerWidth - popoverBounds.width - margin, centeredLeft));
    const below = cellBounds.bottom + 6;
    const top = below + popoverBounds.height <= window.innerHeight - margin
        ? below
        : Math.max(margin, cellBounds.top - popoverBounds.height - 6);
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
    AUDPAGE_cellPopover = popover;
}

function audPageAggregateRows(rows, binCount) {
    const aggregateBins = new Map();
    const aggregate = {
        hostname: 'All sites',
        count: 0,
        blocked: 0,
        privateCount: 0,
        bins: [],
        blocks: []
    };
    for (const row of rows || []) {
        aggregate.count += row.count || 0;
        aggregate.blocked += row.blocked || 0;
        aggregate.privateCount += row.privateCount || 0;
        for (const bin of row.bins || []) {
            if (bin.index < 0 || bin.index >= binCount) {
                continue;
            }
            let target = aggregateBins.get(bin.index);
            if (!target) {
                target = { index: bin.index, count: 0, heatTotal: 0, privateCount: 0 };
                aggregateBins.set(bin.index, target);
            }
            target.count += bin.count;
            target.heatTotal += bin.heat * bin.count;
            target.privateCount += bin.privateCount || 0;
        }
        for (const block of row.blocks || []) {
            aggregate.blocks.push({ ...block, hostname: row.hostname });
        }
    }
    aggregate.bins = Array.from(aggregateBins.values()).map(bin => ({
        index: bin.index,
        count: bin.count,
        heat: bin.count ? bin.heatTotal / bin.count : 0,
        privateCount: bin.privateCount
    }));
    return aggregate;
}

function audPageHourLabel(startTime, binIndex) {
    const start = new Date(startTime + binIndex * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const day = start.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
    const time = `${start.toLocaleTimeString(undefined, { hour: 'numeric' })}–${end.toLocaleTimeString(undefined, { hour: 'numeric' })}`;
    return `${day}, ${time}`;
}

function audPageShortHourLabel(startTime, binIndex) {
    const start = new Date(startTime + binIndex * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const formatter = new Intl.DateTimeFormat(undefined, { hour: 'numeric' });
    if (typeof formatter.formatRange === 'function') {
        return formatter.formatRange(start, end);
    }
    return `${formatter.format(start)}–${formatter.format(end)}`;
}

function audPageActivityCellLabel(startTime, binIndex, checks, blockCount) {
    const checkLabel = `${checks.toLocaleString()} ${checks === 1 ? 'check' : 'checks'}`;
    const blockLabel = blockCount
        ? `, ${blockCount.toLocaleString()} ${blockCount === 1 ? 'block' : 'blocks'}`
        : '';
    return `${audPageShortHourLabel(startTime, binIndex)}, ${checkLabel}${blockLabel}`;
}

function audPageEventLabel(type) {
    const labels = {
        'mode-changed': 'Mode changed',
        'tracking-turned-off': 'Tracking turned off',
        'tracking-runtime-started': 'Wingman Jr. started',
        'score-buffer-overflow': 'Some older activity was removed',
        'accountability-reset': 'History reset',
        'private-coverage-enabled': 'Private browsing included',
        'private-coverage-unavailable': 'Private browsing not included',
        'private-coverage-revoked': 'Private browsing access removed',
        'private-session-started': 'Private browsing started',
        'private-session-observed': 'Private browsing active',
        'private-session-ended': 'Private browsing ended',
        'blocked-image-revealed': 'Blocked image viewed',
        'page-image-revealed': 'Image viewed',
        'master-filtering-changed': 'Filtering changed',
        'master-filtering-paused': 'Filtering paused',
        'site-mode-changed': 'Site filtering mode changed',
        'setting-changed': 'Setting changed'
    };
    return labels[type] || type.replace(/-/g, ' ');
}

function audPageCreateTimelineHeading(data) {
    const duration = data.endTime - data.startTime;
    const heading = document.createElement('div');
    heading.className = 'timeline-heading-row';
    heading.append(document.createElement('span'));
    for (let day = 0; day < AUDPAGE_DAYS_PER_WEEK; day++) {
        const label = document.createElement('div');
        label.className = 'timeline-day-heading';
        label.textContent = new Date(data.startTime + duration * day / AUDPAGE_DAYS_PER_WEEK)
            .toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
        heading.append(label);
    }
    return heading;
}

function audPageCreateSignalRow(data) {
    const duration = data.endTime - data.startTime;
    const binDuration = duration / data.binCount;
    const eventBins = Array.from({ length: data.binCount }, () => []);
    for (const event of data.events) {
        const index = audPageBinIndex(event.timestamp, data.startTime, data.endTime, data.binCount);
        if (index >= 0) {
            eventBins[index].push(event);
        }
    }

    const signalRow = document.createElement('div');
    signalRow.className = 'timeline-signal-row';
    const signalLabel = document.createElement('div');
    signalLabel.className = 'timeline-site-label';
    const signalTitle = document.createElement('strong');
    const signalDetail = document.createElement('small');
    signalTitle.textContent = 'Private browsing & changes';
    signalDetail.textContent = 'Activity and important events';
    signalLabel.append(signalTitle, signalDetail);
    signalRow.append(signalLabel);
    for (let day = 0; day < AUDPAGE_DAYS_PER_WEEK; day++) {
        const dayGrid = document.createElement('div');
        dayGrid.className = 'timeline-day-grid';
        for (let hour = 0; hour < AUDPAGE_HOURS_PER_DAY; hour++) {
            const index = day * AUDPAGE_HOURS_PER_DAY + hour;
            const binStart = data.startTime + index * binDuration;
            const binEnd = binStart + binDuration;
            const privateActive = data.privateSessions.some(interval => audPageIntervalOverlapsBin(interval, binStart, binEnd));
            const coverageGap = data.coverageGaps.some(interval => audPageIntervalOverlapsBin(interval, binStart, binEnd));
            const events = eventBins[index] || [];
            const cell = document.createElement('span');
            cell.className = 'timeline-hour-cell timeline-signal-cell';
            cell.classList.toggle('private-session', privateActive);
            cell.classList.toggle('coverage-gap', coverageGap);
            const descriptions = [];
            if (privateActive) {
                descriptions.push('private browsing active');
            }
            if (coverageGap) {
                descriptions.push('private browsing not included');
            }
            if (events.length) {
                cell.classList.add('has-audit-events');
                const eventLabels = events.slice(0, 4).map(event => audPageEventLabel(event.type));
                if (events.length > eventLabels.length) {
                    eventLabels.push(`+${events.length - eventLabels.length} more`);
                }
                descriptions.push(`${events.length} audit ${events.length === 1 ? 'event' : 'events'}: ${eventLabels.join(', ')}`);
            }
            cell.title = `${audPageHourLabel(data.startTime, index)}${descriptions.length ? ` · ${descriptions.join(' · ')}` : ' · no privacy or audit signals'}`;
            cell.setAttribute('aria-label', cell.title);
            dayGrid.append(cell);
        }
        signalRow.append(dayGrid);
    }
    return signalRow;
}

function audPageCreateActivityRow(row, data, overview = false) {
    const rowElement = document.createElement('div');
    rowElement.className = `timeline-site-row${overview ? ' timeline-overview-row' : ''}`;
    const label = document.createElement('div');
    label.className = 'timeline-site-label';
    const hostname = document.createElement('strong');
    const detail = document.createElement('small');
    hostname.textContent = row.hostname;
    detail.textContent = `${row.count.toLocaleString()} checks · ${(row.blocked || 0).toLocaleString()} blocked${row.privateCount ? ` · ${row.privateCount.toLocaleString()} private` : ''}`;
    label.append(hostname, detail);
    rowElement.append(label);

    const bins = new Map(row.bins.map(bin => [bin.index, bin]));
    const blocks = Array.from({ length: data.binCount }, () => []);
    for (const block of row.blocks) {
        const index = audPageBinIndex(block.timestamp, data.startTime, data.endTime, data.binCount);
        if (index >= 0) {
            blocks[index].push({ ...block, hostname: block.hostname || row.hostname });
        }
    }

    for (let day = 0; day < AUDPAGE_DAYS_PER_WEEK; day++) {
        const dayGrid = document.createElement('div');
        dayGrid.className = 'timeline-day-grid';
        for (let hour = 0; hour < AUDPAGE_HOURS_PER_DAY; hour++) {
            const index = day * AUDPAGE_HOURS_PER_DAY + hour;
            const bin = bins.get(index);
            const cellBlocks = blocks[index];
            const checks = bin?.count || 0;
            const hasSamples = checks > 0;
            const cellLabel = audPageActivityCellLabel(data.startTime, index, checks, cellBlocks.length);
            const cell = document.createElement(cellBlocks.length || hasSamples ? 'button' : 'span');
            cell.className = 'timeline-hour-cell';
            if (cell.tagName === 'BUTTON') {
                cell.type = 'button';
            }
            const heatLevel = audPageDisplayHeatLevel(bin, cellBlocks);
            if (heatLevel >= 0) {
                cell.classList.add(`heat-level-${heatLevel}`);
            }
            if (cellBlocks.length) {
                audPageAppendCountLabel(cell, cellBlocks.length);
                cell.classList.add('has-blocks');
                cell.addEventListener('click', () => {
                    audPageDismissCellPopover();
                    audPageOpenBlockCluster(cellBlocks);
                });
            } else if (hasSamples) {
                cell.addEventListener('click', event => {
                    event.stopPropagation();
                    audPageCloseThumbnailDrawer();
                    audPageShowCellPopover(cell, cellLabel);
                });
            }
            if (bin) {
                cell.classList.toggle('private-checks', bin.privateCount > 0);
            }
            cell.title = cellLabel;
            cell.setAttribute('aria-label', cell.title);
            dayGrid.append(cell);
        }
        rowElement.append(dayGrid);
    }
    return rowElement;
}

function audPageRenderTimeline(data) {
    audPageDismissCellPopover();
    const timeline = document.getElementById('timeline');
    timeline.textContent = '';
    const pageCount = Math.max(1, Math.ceil(data.rows.length / AUDPAGE_SITES_PER_PAGE));
    AUDPAGE_sitePage = Math.max(0, Math.min(AUDPAGE_sitePage, pageCount - 1));
    const pageStart = AUDPAGE_sitePage * AUDPAGE_SITES_PER_PAGE;
    const visibleRows = data.rows.slice(pageStart, pageStart + AUDPAGE_SITES_PER_PAGE);

    timeline.append(audPageCreateTimelineHeading(data));
    const overview = audPageAggregateRows(data.rows, data.binCount);
    timeline.append(audPageCreateActivityRow(overview, data, true));

    const expander = document.createElement('div');
    expander.className = 'timeline-expander';
    const expanderButton = document.createElement('button');
    expanderButton.type = 'button';
    expanderButton.setAttribute('aria-controls', 'timeline-details');
    expander.append(expanderButton);
    timeline.append(expander);

    const details = document.createElement('div');
    details.id = 'timeline-details';
    details.className = 'timeline-details';
    details.append(audPageCreateSignalRow(data));
    for (const row of visibleRows) {
        details.append(audPageCreateActivityRow(row, data));
    }
    timeline.append(details);

    const updateExpandedState = () => {
        details.hidden = !AUDPAGE_detailsExpanded;
        expanderButton.setAttribute('aria-expanded', String(AUDPAGE_detailsExpanded));
        expanderButton.textContent = AUDPAGE_detailsExpanded
            ? '▾ Hide private browsing, changes & sites'
            : `▸ Show private browsing, changes & ${data.rows.length.toLocaleString()} ${data.rows.length === 1 ? 'site' : 'sites'}`;
        document.getElementById('site-pager').hidden = !AUDPAGE_detailsExpanded;
    };
    expanderButton.addEventListener('click', () => {
        AUDPAGE_detailsExpanded = !AUDPAGE_detailsExpanded;
        updateExpandedState();
    });
    updateExpandedState();

    const pageEnd = Math.min(data.rows.length, pageStart + visibleRows.length);
    document.getElementById('site-page').textContent = data.rows.length
        ? `Sites ${pageStart + 1}–${pageEnd} of ${data.rows.length}`
        : 'Sites 0–0 of 0';
    document.getElementById('previous-sites').disabled = AUDPAGE_sitePage === 0;
    document.getElementById('next-sites').disabled = AUDPAGE_sitePage >= pageCount - 1;
    audPageSetStatus('timeline-status', data.rows.length ? '' : 'No browsing activity this week.');
}

function audPageRenderIntegrity(integrity) {
    const badge = document.getElementById('integrity-status');
    const valid = integrity?.valid === true;
    if (!integrity || integrity.checked === 0) {
        badge.dataset.covered = 'true';
        badge.textContent = 'No changes recorded';
    } else if (valid) {
        badge.dataset.covered = 'true';
        badge.textContent = integrity.headChecked
            ? 'No tampering detected'
            : 'No tampering detected through this week';
    } else {
        badge.dataset.covered = 'false';
        badge.textContent = 'History may have been changed';
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
        cell.textContent = 'No events recorded this week.';
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

function audPageCloseThumbnailDrawer() {
    AUDPAGE_thumbnailRequestId++;
    document.getElementById('thumbnail-drawer').hidden = true;
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
    document.getElementById('thumbnail-meta').textContent = `${new Date(block.timestamp).toLocaleString()} · ${ratingLabel}${block.private ? ' · private window' : ''}`;
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
        audPageSetStatus('thumbnail-status', 'This block remains in history, but its image has expired.', 'error');
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
    document.getElementById('previous-thumbnail').addEventListener('click', () => audPageShiftSelectedBlock(-1));
    document.getElementById('next-thumbnail').addEventListener('click', () => audPageShiftSelectedBlock(1));
    document.getElementById('thumbnail-blur').addEventListener('input', event => {
        audPageApplyThumbnailBlur(event.target.value);
    });
    document.getElementById('close-drawer').addEventListener('click', audPageCloseThumbnailDrawer);
    document.getElementById('unlock-thumbnail').addEventListener('click', () => {
        audPageFetchThumbnail(document.getElementById('thumbnail-password').value);
    });
    document.getElementById('thumbnail-password').addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            audPageFetchThumbnail(event.target.value);
        }
    });
    document.getElementById('timeline').parentElement.addEventListener('scroll', audPageDismissCellPopover);
    document.addEventListener('click', event => {
        if (!(event.target instanceof Element) || !event.target.closest('.timeline-hour-cell')) {
            audPageDismissCellPopover();
        }
    });
    window.addEventListener('resize', audPageDismissCellPopover);
    audPageInitialize().catch(error => {
        audPageSetStatus('mode-status', error.message || String(error), 'error');
    });
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        audPageAggregateRows,
        audPageBinIndex,
        audPageBlockedHeatLevel,
        audPageClampBlur,
        audPageCountLabel,
        audPageDefaultBlurForRating,
        audPageDisplayHeatLevel,
        audPageHeatLevel,
        audPageIntervalOverlapsBin,
        audPageRatingForBlock,
        audPageRelativeLogit,
        audPageWorstRating
    };
}
