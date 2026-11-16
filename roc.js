function rocFindConfidence(threshold) {
    let bestMatch = ROC_VALUES[ROC_VALUES.length-1];
    for(let i=0; i<ROC_VALUES.length; i++) {
        if(ROC_VALUES[i].threshold < threshold) { bestMatch = ROC_VALUES[i]; break; }
    }
    return 1.0-bestMatch.tpr;
}

function rocFindRocEntryByFpr(desiredFPR) {
    let bestMatch = ROC_VALUES[0];
    for(let i=ROC_VALUES.length-1; i>=0; i--) {
        if(ROC_VALUES[i].fpr < desiredFPR) { bestMatch = ROC_VALUES[i]; break; }
    }
    return bestMatch;
}

function rocFindRocEntryByTpr(desiredTPR) {
    let bestMatch = ROC_VALUES[0];
    for(let i=ROC_VALUES.length-1; i>=0; i--) {
        if(ROC_VALUES[i].tpr < desiredTPR) { bestMatch = ROC_VALUES[i]; break; }
    }
    return bestMatch;
}

function rocCalculatePrecision(rocEntry) {
    const predictedPositive = rocEntry.tp + rocEntry.fp;
    return predictedPositive === 0 ? 1.0 : rocEntry.tp / predictedPositive;
}

function rocGetEntryString(rocEntry) {
    return "FPR="+rocEntry.fpr+",TPR="+rocEntry.tpr+",Thresh="+rocEntry.threshold+",TP="+rocEntry.tp+",FP="+rocEntry.fp+",TN="+rocEntry.tn+",FN="+rocEntry.fn;
}

let ROC_VALUES = ROC_N017_VALUES;
let ROC_SQRXR_112_VALUES = null;
let ROC_activeModelSelection = 'n017';
var ROC_trustedRoc;
var ROC_trustedToNeutralPercentage = 0.04;
var ROC_neutralRoc;
var ROC_neutralToUntrustedPercentage = 0.18;
var ROC_untrustedRoc;

function rocApplyValues(values, modelSelection) {
    ROC_VALUES = values;
    ROC_activeModelSelection = modelSelection;
    ROC_trustedRoc = rocFindRocEntryByFpr(0.004);
    ROC_neutralRoc = rocFindRocEntryByFpr(0.015);
    ROC_untrustedRoc = rocFindRocEntryByFpr(0.10);
}

async function rocSelectModel(modelSelection) {
    const normalizedSelection = modelSelection === 'sqrxr_112' ? 'sqrxr_112' : 'n017';
    if (normalizedSelection === 'sqrxr_112' && !ROC_SQRXR_112_VALUES) {
        const relativePath = 'models/sqrxr_112_graphopt/roc.json';
        const url = typeof browser !== 'undefined' && browser.runtime?.getURL
            ? browser.runtime.getURL(relativePath)
            : relativePath;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Unable to load SQRXR 112 ROC data (${response.status})`);
        }
        const values = await response.json();
        if (!Array.isArray(values) || values.length === 0) {
            throw new Error('SQRXR 112 ROC data is empty or invalid');
        }
        ROC_SQRXR_112_VALUES = values;
    }
    rocApplyValues(
        normalizedSelection === 'sqrxr_112' ? ROC_SQRXR_112_VALUES : ROC_N017_VALUES,
        normalizedSelection
    );
    return normalizedSelection;
}

rocApplyValues(ROC_N017_VALUES, 'n017');
