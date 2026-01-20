const SS_MAX_RECORDS = 10000;
const SS_MODEL_VERSION = 'SQRXR112';
const SS_records = [];
let SS_nextKey = 1;
const SS_BURST_BUFFER_SIZE = 30;
const SS_BURST_HIGH_RISK_LINEAR = 85;
const SS_BURST_SPIKE_RATIO = 0.35;
const SS_BURST_COOLDOWN_REQUESTS = 30;
const SS_BURST_FAST_ALPHA = 0.25;
const SS_BURST_SLOW_ALPHA = 0.05;
const SS_BURST_SLOW_FAST_DELTA = 7.5;
const SS_burstState = new Map();

function ssGetBurstState(pageHost) {
    if (!SS_burstState.has(pageHost)) {
        SS_burstState.set(pageHost, {
            scores: new Array(SS_BURST_BUFFER_SIZE),
            index: 0,
            size: 0,
            highRiskCount: 0,
            cooldownRemaining: 0,
            fastEma: null,
            slowEma: null
        });
    }
    return SS_burstState.get(pageHost);
}

function ssUpdateBurstMetrics(pageHost, linearScore) {
    if (!pageHost) {
        return;
    }
    const state = ssGetBurstState(pageHost);
    if (state.size === SS_BURST_BUFFER_SIZE) {
        const oldScore = state.scores[state.index];
        if (oldScore > SS_BURST_HIGH_RISK_LINEAR) {
            state.highRiskCount -= 1;
        }
    } else {
        state.size += 1;
    }

    state.scores[state.index] = linearScore;
    if (linearScore > SS_BURST_HIGH_RISK_LINEAR) {
        state.highRiskCount += 1;
    }
    state.index = (state.index + 1) % SS_BURST_BUFFER_SIZE;

    if (state.fastEma === null) {
        state.fastEma = linearScore;
    } else {
        state.fastEma = SS_BURST_FAST_ALPHA * linearScore + (1 - SS_BURST_FAST_ALPHA) * state.fastEma;
    }
    if (state.slowEma === null) {
        state.slowEma = linearScore;
    } else {
        state.slowEma = SS_BURST_SLOW_ALPHA * linearScore + (1 - SS_BURST_SLOW_ALPHA) * state.slowEma;
    }

    if (state.cooldownRemaining > 0) {
        state.cooldownRemaining -= 1;
        if (state.cooldownRemaining === 0) {
            console.warn('[SS][BURST] exit_cooldown ' + JSON.stringify({
                pageHost: pageHost,
                highRiskFraction: state.size ? state.highRiskCount / state.size : 0,
                bufferSize: state.size,
                fastEma: state.fastEma,
                slowEma: state.slowEma
            }));
        }
    }

    if (state.size < SS_BURST_BUFFER_SIZE) {
        return;
    }

    const highRiskFraction = state.highRiskCount / state.size;
    const fastSlowDelta = state.fastEma - state.slowEma;
    if (highRiskFraction >= SS_BURST_SPIKE_RATIO
        && fastSlowDelta >= SS_BURST_SLOW_FAST_DELTA
        && state.cooldownRemaining === 0) {
        state.cooldownRemaining = SS_BURST_COOLDOWN_REQUESTS;
        console.warn('[SS][BURST] enter_cooldown ' + JSON.stringify({
            pageHost: pageHost,
            highRiskFraction: highRiskFraction,
            bufferSize: state.size,
            cooldownRequests: SS_BURST_COOLDOWN_REQUESTS,
            fastEma: state.fastEma,
            slowEma: state.slowEma,
            fastSlowDelta: fastSlowDelta,
            fastAlpha: SS_BURST_FAST_ALPHA,
            slowAlpha: SS_BURST_SLOW_ALPHA
        }));
    }
}

function ssGetBurstOverrideThreshold(pageHost, untrustedThreshold) {
    const state = SS_burstState.get(pageHost);
    if (!state || state.cooldownRemaining === 0) {
        return null;
    }
    return untrustedThreshold;
}

function ssIsBurstActive(pageHost) {
    const state = SS_burstState.get(pageHost);
    return !!(state && state.cooldownRemaining > 0);
}

function ssGetModelVersion() {
    return SS_MODEL_VERSION;
}

function ssAddRequestRecord(record) {
    if (!record || record.rocScore === null || record.rocScore === undefined) {
        return;
    }
    const linearScore = rocEstimateLinearScoreAtThreshold(record.rocScore);
    if (linearScore === null || linearScore === undefined) {
        return;
    }
    console.info('[SS] record_input ' + JSON.stringify({
        timestamp: record.timestamp ?? Date.now(),
        pageHost: record.pageHost,
        contentHost: record.contentHost,
        threshold: record.threshold,
        rocScore: record.rocScore,
        linearScore: linearScore,
        modelVersion: record.modelVersion ?? SS_MODEL_VERSION
    }));
    const entry = {
        timestamp: record.timestamp ?? Date.now(),
        pageHost: record.pageHost,
        contentHost: record.contentHost,
        threshold: record.threshold,
        linearScore: linearScore,
        modelVersion: record.modelVersion ?? SS_MODEL_VERSION,
        key: SS_nextKey++
    };
    SS_records.push(entry);
    if (SS_records.length > SS_MAX_RECORDS) {
        SS_records.shift();
    }
    ssUpdateBurstMetrics(entry.pageHost, entry.linearScore);
}

function ssGetScoresForPageHost(pageHost) {
    const scores = [];
    for (let i = 0; i < SS_records.length; i++) {
        if (SS_records[i].pageHost === pageHost) {
            scores.push(SS_records[i].linearScore);
        }
    }
    console.info('[SS] scores_for_host ' + JSON.stringify({
        pageHost: pageHost,
        count: scores.length
    }));
    return scores;
}

function ssSuggestAdaptiveThreshold(pageHost, fallbackThreshold, fallbackStdDev, minThreshold, maxThreshold) {
    const scores = ssGetScoresForPageHost(pageHost);
    if (scores.length < 50) {
        console.info('[SS] threshold_fallback ' + JSON.stringify({
            pageHost: pageHost,
            sampleCount: scores.length,
            fallbackThreshold: fallbackThreshold
        }));
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
    const suggestedLinear = mean + pushFromMean;
    const mappedThreshold = rocFindThresholdForLinearScore(suggestedLinear);

    let threshold = Math.min(mappedThreshold ?? suggestedLinear, maxThreshold);
    threshold = Math.max(threshold, minThreshold);
    console.info('[SS] threshold_calc ' + JSON.stringify({
        pageHost: pageHost,
        sampleCount: scores.length,
        mean: mean,
        stddev: stddev,
        scaleFactor: scaleFactor,
        pushFromMean: pushFromMean,
        suggestedLinear: suggestedLinear,
        mappedThreshold: mappedThreshold,
        minThreshold: minThreshold,
        maxThreshold: maxThreshold,
        threshold: threshold
    }));
    return threshold;
}
