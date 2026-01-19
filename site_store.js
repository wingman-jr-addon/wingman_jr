const SS_MAX_RECORDS = 10000;
const SS_MODEL_VERSION = 'SQRXR112';
const SS_records = [];
let SS_nextKey = 1;

function ssGetModelVersion() {
    return SS_MODEL_VERSION;
}

function ssAddRequestRecord(record) {
    if (!record || record.linearScore === null || record.linearScore === undefined) {
        return;
    }
    const entry = {
        timestamp: record.timestamp ?? Date.now(),
        pageHost: record.pageHost,
        contentHost: record.contentHost,
        threshold: record.threshold,
        linearScore: record.linearScore,
        modelVersion: record.modelVersion ?? SS_MODEL_VERSION,
        key: SS_nextKey++
    };
    SS_records.push(entry);
    if (SS_records.length > SS_MAX_RECORDS) {
        SS_records.shift();
    }
}

function ssGetScoresForPageHost(pageHost) {
    const scores = [];
    for (let i = 0; i < SS_records.length; i++) {
        if (SS_records[i].pageHost === pageHost) {
            scores.push(SS_records[i].linearScore);
        }
    }
    return scores;
}

function ssSuggestAdaptiveThreshold(pageHost, fallbackThreshold, fallbackStdDev, minThreshold, maxThreshold) {
    const scores = ssGetScoresForPageHost(pageHost);
    if (scores.length < 50) {
        return fallbackThreshold;
    }

    let sum = 0;
    for (let i = 0; i < scores.length; i++) {
        sum += scores[i];
    }
    const mean = sum / scores.length;

    let varianceSum = 0;
    for (let i = 0; i < scores.length; i++) {
        let delta = scores[i] - mean;
        varianceSum += delta * delta;
    }
    const stddev = Math.sqrt(varianceSum / Math.max(scores.length - 1, 1));

    const scaleFactor = 1 + 8.0 / Math.pow(scores.length, 0.75);
    const pushFromMean = Math.max(stddev * scaleFactor, fallbackStdDev * 2);
    const suggested = mean + pushFromMean;

    let threshold = Math.min(suggested, maxThreshold);
    threshold = Math.max(threshold, minThreshold);
    return threshold;
}
