/*
Site-oriented data store.

Goal
--------------
Fast store for keeping track of site visits for a few potential use cases:
- Calculation of statistical priors to use as a trust level indicator for a given site
- Ability to display a list of most commonly visited sites, then show the stats for images blocked etc. by site
- Ability to create something akin to GitHub's commit chart, showing "heat" against day and approximate
    time of day over some recent period

One important nuance here is around the idea of the "site". Firefox allows us to know not only the resource
being requested, but also the site requesting it. So for example you maybe on pinterest.com but requesting images
from i.pinimg.com etc. Raw site visit records will need to keep track of both, and certain aggregate statistics
like trust level will need to factor in both.

Another potential aspect here is a differentiation between the period where raw requests are stored and an aggregate
is stored. So, individual records may be stored for say the last 1-3 months but then rolloff into an aggregate
that is still used to calculate trust levels etc. This is more of a future goal but the interface to the rest
of the addon should not contradict this if possible.

Finally, aggregation of scores is an open question. The underlying scores are themselves highly non-linear,
suggesting simple approaches like direct averaging are inappropriate. Ideally a more linear indicator such as
a ROC score of some sort can be used instead; this translation will be pushed to the call site.
*/

/*
Request record structure:
{
    //User-supplied fields
    pageHost: 'example.com',          // Top-level only domain, sub.example.com -> example.com only
    contentHost: 'cdnimgexample.com', // Top-level only
    score: 0.3,                       // A linear score approximator [0,1] where 0 is safe and 1 is not.
                                      //  Should approximately obey linear aggregations like averaging.
    //DEBUG
    imageBytes: [],                   // Image bytes for debugging purposes

    //Data store-supplied fields
    storeDate: Date,                  // Time of storage (stored as ms since epoch)
    key: 1,                           // Auto incremented. When iterating on a date range for storeDate,
                                      //  iteration until just after storeDate exceeds the end parameter
                                      //  should be a viable alternative if needed to indexed range
                                      //  iteration.
    
}
*/

let ssAllRecords = []

function ssAddRequestRecord(requestRecord /*user-supplied fields*/ ) {
    let copy = {
        pageHost: requestRecord.pageHost,
        contentHost: requestRecord.contentHost,
        score: requestRecord.score,
        imageBytes: requestRecord.imageBytes,
        storeDate: new Date(),
        key: ssAllRecords.length
    };
    ssAllRecords.push(copy);
    console.info('SO: record '+JSON.stringify(copy));
}

// Give an array of [0,1] elements, and this will create a normalized histogram in Unicode
function ssCreateHistogramLine(arr, startBin=0) {
    let bins = [];
    let binCount = 90;
    let binSize = 1/binCount;
    for(let i=0; i<binCount; i++) {
        bins.push(0);
    }
    //Calculate
    for(let i=0; i<arr.length; i++) {
        let value = arr[i];
        let binValue = Math.round(value / binSize);
        if(binValue < 0) {
            binValue = 0;
        } else if(binValue > binCount-1) {
            binValue = binCount - 1;
        }
        bins[binValue]++;
    }
    //Normalize
    let binMax = 0;
    for(let i=startBin; i<bins.length; i++) {
        if(bins[i] > binMax) {
            binMax = bins[i];
        }
    }
    if(binMax == 0) {
        return '[No bin values for histogram]';
    }
    //Histogram
    let histogram = '';
    for(let i=startBin; i<bins.length; i++) {
        let binHeightRaw = bins[i] / binMax;
        //Unicode supports 8ths of a block
        //Here, we'll show 1/8th for zero, so use 8 divisions rather than 9
        let binHeight = Math.round(binHeightRaw*8);
        //Special case - if bin has more than 1 value, don't let it be 0
        if(binHeight == 0 && bins[i] > 0)
            binHeight = 1;
        histogram += String.fromCodePoint(0x2581+binHeight);
    }
    return histogram;
}

function ssBarChart(arr) {
    let arrMax = 0.0;
    for(let i=0; i<arr.length; i++) {
        if(arr[i] > arrMax) {
            arrMax = arr[i];
        }
    }
    let chart = '';
    for(let i=0; i<arr.length; i++) {
        let binHeight = Math.round(arr[i]/arrMax * 8);
        chart += String.fromCodePoint(0x2581+binHeight);
    }
    return chart;
}

// Give an array of [0,1] elements, and this will create a normalized histogram in Unicode
function ssCreateHistogramLineSplit(arr, startBin=0) {
    let bins = [];
    let binCount = 70;
    let binSize = 1/binCount;
    for(let i=0; i<binCount; i++) {
        bins.push(0);
    }
    //Calculate
    for(let i=0; i<arr.length; i++) {
        let value = arr[i];
        let binValue = Math.round(value / binSize);
        if(binValue < 0) {
            binValue = 0;
        } else if(binValue > binCount-1) {
            binValue = binCount - 1;
        }
        bins[binValue]++;
    }
    //Normalize
    let binSum = 0;
    for(let i=startBin; i<bins.length; i++) {
        binSum += bins[i];
    }
    if(binSum == 0) {
        return '[No bin values for histogram]';
    }
    //Histogram - note rounding may cause slightly wrong widths
    let histogram = '';
    for(let i=startBin; i<bins.length; i++) {
        let binPercentage = bins[i] / binSum;
        let binWidth = Math.round(binPercentage*50);
        if(binWidth > 0) {
            let blockType = (i%2 == 0) ? 0x2588 : 0x2593;
            histogram += String.fromCodePoint(blockType).repeat(binWidth);
        } else {
            //If there's at least *something* show the blip
            if(bins[i] > 0) {
                histogram += String.fromCodePoint(0x2582);
            } else {
                histogram += String.fromCodePoint(0x2581);
            }
        }
    }
    return histogram;
}


// Give an array of [0,1] elements, and this will create a normalized histogram in Unicode
function ssCreateHistogramFull(arr, startBin=0) {
    let bins = [];
    let binCount = 30;
    let binSize = 1/binCount;
    for(let i=0; i<binCount; i++) {
        bins.push(0);
    }
    //Calculate
    for(let i=0; i<arr.length; i++) {
        let value = arr[i];
        let binValue = Math.round(value / binSize);
        if(binValue < 0) {
            binValue = 0;
        } else if(binValue > binCount-1) {
            binValue = binCount - 1;
        }
        bins[binValue]++;
    }
    //Normalize
    let binMax = 0;
    for(let i=startBin; i<bins.length; i++) {
        if(bins[i] > binMax) {
            binMax = bins[i];
        }
    }
    if(binMax == 0) {
        return '[No bin values for histogram]';
    }
    //Histogram
    let histogram = '';
    for(let i=startBin; i<bins.length; i++) {
        let binHeightRaw = bins[i] / binMax;
        //Unicode supports 8ths of a block
        //Here, we'll show 1/8th for zero, so use 8 divisions rather than 9
        let binHeight = Math.round(binHeightRaw*80);
        //Special case - if bin has more than 1 value, don't let it be 0
        if(binHeight == 0 && bins[i] > 0)
            binHeight = 1;
        histogram += String.fromCodePoint(0x2588).repeat(binHeight) + '\r\n';
    }
    return histogram;
}

function ssCreateStatsForPageHost(pageHost) {
    let scores = [];
    for(let i=0; i<ssAllRecords.length; i++) {
        if(ssAllRecords[i].pageHost == pageHost) {
            scores.push(ssAllRecords[i].score);
        }
    }
    let histogram = ssCreateHistogramLineSplit(scores);
    return histogram;
}

function ssDumpPageHostHistory(pageHost) {
    //Gather scores
    let scores = [];
    for(let i=0; i<ssAllRecords.length; i++) {
        if(ssAllRecords[i].pageHost == pageHost) {
            scores.push(ssAllRecords[i].score);
        }
    }
    if(scores.length <= 1) {
        return 'Not enough records found';
    }
    // Normalize and dump out relative heats
    let report = 'Resources for '+pageHost+' relative scores\r\n==============================\r\n';
    let max = 0;
    let sum = 0;
    for(let i=0; i<scores.length; i++) {
        sum += scores[i];
        if(scores[i] > max) {
            max = scores[i];
        }
    }
    let mean = sum / scores.length;
    let varianceSum = 0;
    for(let i=0; i<scores.length; i++) {
        varianceSum += (scores[i] - mean)*(scores[i] - mean);
    }
    let stddev = Math.sqrt(varianceSum / (scores.length - 1));
    let zScores = [];

    for(let i=0; i<scores.length; i++) {
        let z = (scores[i] - mean) / stddev;
        zScores.push(z);
        //Asymmetrically use level 2 as baseline for z=0 to show
        //bad deviations more clearly
        let shiftedZ = Math.round(z);
        if(shiftedZ < -1)
            shiftedZ = -1;
        else if(shiftedZ > 6)
            shiftedZ = 6;
        shiftedZ += 1;

        report+=String.fromCodePoint(0x2581+shiftedZ);
        if(i%80 === 79) {
            report += '\r\n';
        }
    }
    console.log(zScores);
    return report;
}

function ssSuggestThresholdStdDev(pageHost, fallbackThreshold) {
    //Gather scores
    let scores = [];
    for(let i=0; i<ssAllRecords.length; i++) {
        if(ssAllRecords[i].pageHost == pageHost) {
            scores.push(ssAllRecords[i].score);
        }
    }
    if(scores.length <= 70) {
        return fallbackThreshold;
    }

    // Calculate mean and stddev
    let sum = 0;
    for(let i=0; i<scores.length; i++) {
        sum += scores[i];
    }
    let mean = sum / scores.length;
    let varianceSum = 0;
    for(let i=0; i<scores.length; i++) {
        varianceSum += (scores[i] - mean)*(scores[i] - mean);
    }
    let stddev = Math.sqrt(varianceSum / (scores.length - 1));
    
    let suggested = mean + stddev*3;
    console.warn(`SO: threshold pick. Mean ${mean} Stddev ${stddev} Suggested: ${suggested} Fallback ${fallbackThreshold}`);
    return Math.min(suggested, fallbackThreshold);
}

function ssSuggestThresholdStdDevAdaptive(pageHost, fallbackThreshold, fallbackStdDev) {
    //Gather scores
    let scores = [];
    for(let i=0; i<ssAllRecords.length; i++) {
        if(ssAllRecords[i].pageHost == pageHost) {
            scores.push(ssAllRecords[i].score);
        }
    }
    if(scores.length <= 50) {
        return fallbackThreshold;
    }

    // Calculate mean and stddev
    let sum = 0;
    for(let i=0; i<scores.length; i++) {
        sum += scores[i];
    }
    let mean = sum / scores.length;
    let varianceSum = 0;
    for(let i=0; i<scores.length; i++) {
        varianceSum += (scores[i] - mean)*(scores[i] - mean);
    }
    let stddev = Math.sqrt(varianceSum / (scores.length - 1));
    let scaleFactor = 2 + 30.0 / Math.pow(scores.length, 1.5); //Scale to a reasonable sigma at infinity
    let pushFromMean = stddev*scaleFactor;
    //When the distribution first starts out and only really good images are encountered
    //the std dev is way too small, this helps constrain it.
    let fallbackPushFromMean = fallbackStdDev*3;
    let suggestedPushFromMean = Math.max(pushFromMean, fallbackPushFromMean);
    
    let suggested = mean + suggestedPushFromMean;
    console.warn(`SO: threshold pick. ${pageHost} Mean ${mean} Stddev ${stddev} Scale ${scaleFactor} Suggested: ${suggested} Fallback ${fallbackThreshold}`);
    return Math.min(suggested, fallbackThreshold);
}

function ssMedian(sortedValues) {
    if(sortedValues.length % 2 == 1) {
        return sortedValues[(sortedValues.length - 1)/2];
    }
    return (sortedValues[sortedValues.length/2 - 1] + sortedValues[sortedValues.length/2]) / 2;
}

//So I got this working but unfortunately MAD is too aggressive about lopping off the outliers
//I considered a Tukey's fence approach too, but I think it'd run into the same problem
//In short, we do need the initial outliers to still factor in, so a distribution based approach
//models this a bit better
function ssSuggestThresholdMAD(pageHost, fallbackThreshold) {
    //Gather scores
    let scores = [];
    for(let i=0; i<ssAllRecords.length; i++) {
        if(ssAllRecords[i].pageHost == pageHost) {
            scores.push(ssAllRecords[i].score);
        }
    }
    if(scores.length <= 30) {
        return fallbackThreshold;
    }

    // Calculate Median Absolute Deviation
    scores.sort();
    let median = ssMedian(scores);
    let absDeviations = [];
    for(let i=0; i<scores.length; i++) {
        absDeviations.push(Math.abs(scores[i] - median));
    }
    absDeviations.sort();
    let mad = ssMedian(absDeviations);
    let suggested = median + 3*mad;
    console.warn(scores);
    console.warn(absDeviations);
    console.warn(`SO: threshold pick. Median ${median} MAD ${mad} Suggested: ${suggested} Fallback ${fallbackThreshold}`);

    return Math.min(suggested, fallbackThreshold);
}

function ssDumpStats() {
    // Sort all records by page host
    let scoresByPageHost = {};
    for(let i=0; i<ssAllRecords.length; i++) {
        let r = ssAllRecords[i];
        let entry = scoresByPageHost[r.pageHost];
        if(entry === undefined) {
            entry = { scores: [] };
            scoresByPageHost[r.pageHost] = entry;
        }
        entry.scores.push(r.score);
    }
    // Now dump histograms
    let fullReport = '';
    for (const [key, value] of Object.entries(scoresByPageHost)) {
        let histogram = ssCreateHistogramLineSplit(value.scores);
        fullReport += histogram+' '+key + '\r\n';
    }
    return fullReport;
}

function ssDumpStatsFull() {
    // Sort all records by page host
    let scoresByPageHost = {};
    for(let i=0; i<ssAllRecords.length; i++) {
        let r = ssAllRecords[i];
        let entry = scoresByPageHost[r.pageHost];
        if(entry === undefined) {
            entry = { };
            scoresByPageHost[r.pageHost] = entry;
        }
        let subEntry = entry[r.contentHost];
        if(subEntry === undefined) {
            subEntry = { scores: [] };
            entry[r.contentHost] = subEntry;
        }
        subEntry.scores.push(r.score);
    }
    // Now dump histograms
    let fullReport = '';
    for (const [pageHost, entry] of Object.entries(scoresByPageHost)) {
        fullReport+= pageHost + '\r\n==========================\r\n';
        for(const [contentHost, value] of Object.entries(entry)) {
            let histogram = ssCreateHistogramLineSplit(value.scores);
            fullReport += histogram+' '+ contentHost + '(' + value.scores.length + ')' + '\r\n';
        }
        fullReport+='\r\n';
    }
    return fullReport;
}


const ssLoadImagePromise = url => new Promise( (resolve, reject) => {
    const img = new Image()
    img.onerror = e => reject(e)
    img.onload = () => resolve(img)
    img.decoding = 'sync'
    img.src = url
});

async function ssLogImage(imageBytes) {
    let url = null;
    let SS_logCanvas = document.createElement('canvas');
    SS_logCanvas.width = 128;
    SS_logCanvas.height = 128;
    let SS_logCtx = SS_logCanvas.getContext('2d', { alpha: false});
    try {
        let blob = new Blob([imageBytes]);
        url = URL.createObjectURL(blob);
        let img = await ssLoadImagePromise(url);
        let maxSide = Math.max(img.width, img.height);
        let ratio = PROC_LOG_IMG_SIZE/maxSide;
        let newWidth = img.width*ratio;
        let newHeight = img.height*ratio;
        SS_logCtx.clearRect(0,0,SS_logCanvas.width,SS_logCanvas.height);
        SS_logCtx.drawImage(img, 0, 0, newWidth, newHeight);
        let logDataUrl = SS_logCanvas.toDataURL('image/jpeg', 0.7);
        let blockedCSS = 'color: #00FF00; padding: 75px; line-height: 150px; background-image: url('+logDataUrl+'); background-size: contain; background-repeat: no-repeat;';
        console.warn('%c '+'A message', blockedCSS);
    } catch(ex) {
        console.error(ex);
    }
    if(url != null) {
        URL.revokeObjectURL(url);
    }
}

async function ssLogImageTest() {
    for(let i=0; i<100; i++) {
        let entry = ssAllRecords[ssAllRecords.length-1-i];
        if(entry.imageBytes === undefined) {
            console.warn('Undefined image!');
        } else {
            await ssLogImage(entry.imageBytes);
        }
    }
}

async function ssReadFileAsDataURL (inputFile) {
    const temporaryFileReader = new FileReader();
  
    return new Promise((resolve, reject) => {
        temporaryFileReader.addEventListener("error", function () {
        temporaryFileReader.abort();
        reject(new DOMException("Problem parsing input file."));
      },false);
  
      temporaryFileReader.addEventListener("load", function () {
        resolve(temporaryFileReader.result);
      }, false);
      temporaryFileReader.readAsDataURL(inputFile);
    });
  };

async function ssLogLevelCollage() {
    //Setup
    let divider = 1;
    let entriesByLevels = [];
    for(let i=0; i<100/divider; i++) {
        let capturedI = i;
        entriesByLevels.push({ level: capturedI, recordIndices:[] });
    }
    //Sort
    let maxIndex = (100/divider - 1);
    for(let i=0; i<ssAllRecords.length; i++) {
        let capturedI = i;
        let entry = ssAllRecords[i];
        let score = Math.round(entry.score*100/divider);
        if(score < 0) {
            score = 0;
        } else if (score > maxIndex) {
            score = maxIndex;
        }

        let collageEntry = entriesByLevels[score];
        collageEntry.recordIndices.push(capturedI);
    }
    
    let html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"/></head>
    <body><table>`;
    let imageSize = 128;
    let imagesPerRow = 10;
    for(let i=0; i<entriesByLevels.length; i++) {
        let entry = entriesByLevels[i];
        html += '<tr>';
        html += '<td>Score '+(i*divider)+'</td>\r\n';
        for(let j=0; j<entry.recordIndices.length; j++ ) {
            let record = ssAllRecords[entry.recordIndices[j]];
            let imageBytesB64 = await ssReadFileAsDataURL(new Blob([record.imageBytes]));
            html += `<td><img src="${imageBytesB64}" style="max-width: ${imageSize}px; max-height: ${imageSize}px;"  /></td>\r\n`;
            if(j % imagesPerRow == imagesPerRow-1) {
                html += '</tr><tr><td></td>';
            }
        }
        html+= '</tr>\r\n';
    }
    html += `</table></body></html>`;



    const htmlBlob = new Blob([html], { type: "text/html" });
    const htmlBlobUrl = URL.createObjectURL(htmlBlob);

    browser.tabs.create({ url: htmlBlobUrl });
}

async function ssLogLevelCollageSorted() {
    let allRecordsSorted = ssAllRecords.slice(0);
    allRecordsSorted.sort((a,b)=>a.score-b.score);
    
    let html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"/></head>
    <body><table><tr>`;
    let imageSize = 128;
    let imagesPerRow = 10;
    for(let i=0; i<allRecordsSorted.length; i++) {
        let record = allRecordsSorted[i];
        let imageBytesB64 = await ssReadFileAsDataURL(new Blob([record.imageBytes]));
        html += `<td><img src="${imageBytesB64}" style="max-width: ${imageSize}px; max-height: ${imageSize}px;" title="${record.score}" /></td>\r\n`;
        if(i % imagesPerRow == imagesPerRow-1) {
            html += '</tr><tr><td></td>';
        }
    }
    html += `</tr></table></body></html>`;

    const htmlBlob = new Blob([html], { type: "text/html" });
    const htmlBlobUrl = URL.createObjectURL(htmlBlob);

    browser.tabs.create({ url: htmlBlobUrl });
}

//The idea is to split the ROC cuve into bins suggested by TPR or FPR bins of a certain step size
function ssCreateRocBins() {
    let step = 0.0033;

    let clonedStart = {
        ...(ROC_VALUES[0]),
        tprWeight: 0.0,
        fprWeight: 0.0
     };
    let breaks = [ clonedStart ];

    let lastBreak = clonedStart;
    for(let i=1; i<ROC_VALUES.length - 1; i++) {
        let current = ROC_VALUES[i];
        if(current.tpr - lastBreak.tpr >= step
            || current.fpr - lastBreak.fpr >= step) {
            let breakEntry = {
                ...(ROC_VALUES[i]),
                tprWeight: (current.tpr-lastBreak.tpr),
                fprWeight: (current.fpr-lastBreak.fpr)
            };
            breaks.push(breakEntry);
            lastBreak = breakEntry;
        }
    }

    let lastRoc = ROC_VALUES[ROC_VALUES.length-1];
    let clonedEnd = {
        ...lastRoc,
        tprWeight: lastRoc.tpr - lastBreak.tpr,
        fprWeight: lastRoc.fpr - lastBreak.fpr
    };
    breaks.push(clonedEnd);

    let tprAcc = 0.0;
    let fprAcc = 0.0;
    for(let i=0; i<breaks.length; i++) {
        let b = breaks[i];
        tprAcc += b.tprWeight;
        fprAcc += b.fprWeight;
        //console.log(`TPR: ${b.tpr.toFixed(4)} W: ${b.tprWeight.toFixed(3)} FPR: ${b.fpr.toFixed(4)} W: ${b.fprWeight.toFixed(3)} Thresh: ${b.threshold.toFixed(6)}`);
    }
    //console.log(`Normalization check. TPR Sum: ${tprAcc} FPR Sum: ${fprAcc}`);

    return breaks;
}

function ssCreateHistogramFromRocBins(values, breaks) {
    let hist = []
    for(let i=0; i<breaks.length; i++) {
        hist.push(0);
    }

    //TODO make smarter to avoid n*m by using binary search etc.
    for(let i=0; i<values.length; i++) {
        for(let j=0; j<breaks.length; j++) {
            if(breaks[j].threshold <= values[i]) {
                hist[j]++;
                break;
            }
        }
    }
    //Normalize
    for(let i=0; i<hist.length; i++) {
        hist[i] /= values.length;
    }

    return hist;
}

function ssGetValuesForPageHost(pageHost) {
    let values = [];
    for(let i=0; i<ssAllRecords.length; i++) {
        if(ssAllRecords[i].pageHost == pageHost) {
            values.push(ssAllRecords[i].score);
        }
    }
    return values;
}


function ssWassersteinDistance1D(p, q, binWidths) {  
    // 1) Compute cumulative sums (CDFs) for p and q.
    const cdfP = [];
    const cdfQ = [];
    let runningP = 0;
    let runningQ = 0;
    for (let i = 0; i < p.length; i++) {
      runningP += p[i];
      runningQ += q[i];
      cdfP.push(runningP);
      cdfQ.push(runningQ);
    }
  
    // 2) Wasserstein distance is the integral of |CDF_p(x) - CDF_q(x)| over x.
    //    Discretely, we sum up the absolute difference of CDFs across each bin,
    //    multiplied by the bin width.
    let distance = 0;
    // We'll treat cdfP[i] and cdfQ[i] as the CDF values at binEdges[i+1].
    // So each step uses the difference between binEdges[i+1] and binEdges[i].
    for (let i = 0; i < p.length; i++) {
      const diffCDF = Math.abs(cdfP[i] - cdfQ[i]);
      distance += diffCDF * binWidths[i];
    }
  
    return distance;
  }

function ssEstimatePostiveRate(valueHist, breaks) {
    // Given a 1) set of "breaks" of the original ROC with TPR and FPR weights
    // and 2) a histogram of observed values as binned by the same breaks then
    // find a such that a*TPR(i) + (1-a)*FPR(i) most closly matches the observed
    // histogram of values

    let bestMatchScore = 9999999;
    let bestMatchA = -1;

    //TODO HMMMMM.......
    let binWidths = [];
    for(let i=0; i<breaks.length-1; i++) {
        binWidths.push(breaks[i].threshold-breaks[i+1].threshold);
    }
    binWidths.push(0);

    for(let a=0; a<1.0; a+=0.0033) {
        //TODO consider caching the calculated breaks-histograms over different a values
        
        let hTheorySum = 0.0;
        let hTheoryHist = [];
        for(let i=0; i<breaks.length; i++) {
            let hTheory = a*breaks[i].tprWeight + (1-a)*breaks[i].fprWeight;
            hTheorySum += hTheory;
            hTheoryHist.push(hTheory);
        }
        //Normalize and score
        /*
        let score = 0.0;
        for(let i=0; i<breaks.length; i++) {
            let hTheory = hTheoryHist[i] / hTheorySum;
            let hActual = valueHist[i];
            score += (hTheory-hActual)*(hTheory-hActual);
        }
        */
        let score = ssWassersteinDistance1D(hTheoryHist, valueHist, binWidths);

        console.log(`Best A: ${bestMatchA} Best match: ${bestMatchScore} Current score: ${score} A: ${a}`);
        //console.log(`Theory:   ${ssBarChart(hTheoryHist)}`);
        //console.log(`Observed: ${ssBarChart(valueHist)}`);
        if(score < bestMatchScore) {
            bestMatchScore = score;
            bestMatchA = a;
        }
    }

    return bestMatchA;
}

function ssCheckAlpha(a) {
    let breaks = ssCreateRocBins();
    let values = [];
    for(let i=0; i<breaks.length; i++) {
        let hTheory = a*breaks[i].tprWeight + (1-a)*breaks[i].fprWeight;
        values.push(hTheory);
    }
    let hist = ssCreateHistogramLine(values);
    console.log(`Alpha: ${a}  ${hist}`);
}

function ssTest(pageHost) {
    let breaks = ssCreateRocBins();

    let tprHistReport = ssBarChart(breaks.map(b=>b.tprWeight));
    let fprHistReport = ssBarChart(breaks.map(b=>b.fprWeight));

    //let values = testValues;
    let values = ssGetValuesForPageHost(pageHost);
    let valueHist = ssCreateHistogramFromRocBins(values, breaks);
    let valueHistReport = ssBarChart(valueHist);

    console.log('ROC TPR Hist:  '+tprHistReport);
    console.log('ROC FPR Hist:  '+fprHistReport);
    console.log('Observed Hist: '+valueHistReport);

    let p = ssEstimatePostiveRate(valueHist, breaks);
    console.log(`Estimate of positive rate: ${p}`);
    return p;
}



//From browsing Amazon Daily Deals
let testValues = [
    0.0002967285399790853,
    0.0002970545901916921,
    0.0002966742031276226,
    0.0003185091190971434,
    0.00032074906630441546,
    0.0002982873993460089,
    0.00029874546453356743,
    0.0002974665549118072,
    0.0003052540705539286,
    0.0003023003228008747,
    0.0002978845441248268,
    0.00029872808954678476,
    0.00029731541872024536,
    0.00029713803087361157,
    0.000478768051834777,
    0.00029719556914642453,
    0.00029711113893426955,
    0.00029970589093863964,
    0.00029874645406380296,
    0.0003044663753826171,
    0.00029712900868617,
    0.00029670106596313417,
    0.0003002313897013664,
    0.00029715022537857294,
    0.00029720913153141737,
    0.00030616926960647106,
    0.0003006531042046845,
    0.0003081497270613909,
    0.00037696101935580373,
    0.0002991747751366347,
    0.0002976191171910614,
    0.00029764368082396686,
    0.00029658933635801077,
    0.00029824304510839283,
    0.0002994022215716541,
    0.00029713078401982784,
    0.0002967018517665565,
    0.0002984031452797353,
    0.0002978869015350938,
    0.0002981019497383386,
    0.0003109949466306716,
    0.00030257130856625736,
    0.0002979524724651128,
    0.00031331993523053825,
    0.00029805765370838344,
    0.0002970108180306852,
    0.0002967528416775167,
    0.0005647661746479571,
    0.009041041135787964,
    0.000296907004667446,
    0.00029822668875567615,
    0.2906407117843628,
    0.0003000082797370851,
    0.000300484272884205,
    0.00029685249319300056,
    0.000297524529742077,
    0.00029810648993588984,
    0.00029891214217059314,
    0.00029857788467779756,
    0,
    0.00045044414582662284,
    0.000296736165182665,
    0.0003002841549459845,
    0.00030035560484975576,
    0.0002976146060973406,
    0.000297112506814301,
    0.00029900201479904354,
    0.0002991223882418126,
    0.0002985709870699793,
    0.0003025771293323487,
    0.000297080900054425,
    0.0002970182686112821,
    0.00030173329287208617,
    0.00030177715234458447,
    0.0002994307142216712,
    0.0002984192979056388,
    0.00029760340112261474,
    0.00029709565569646657,
    0.00030607497319579124,
    0.0002969095658045262,
    0.0003059637383557856,
    0.00029878001078031957,
    0.00033724511740729213,
    0.000296961166895926,
    0.0003020379226654768,
    0.000298529164865613,
    0.00029955580248497427,
    0.000297006918117404,
    0.0002988139749504626,
    0.00030621132464148104,
    0.00029794007423333824,
    0.00029763762722723186,
    0.0002969087800011039,
    0.0002969806082546711,
    0.0004646860179491341,
    0.00029748582164756954,
    0.0003011561930179596,
    0.0002989672648254782,
    0.00029731838731095195,
    0.0002983063168358058,
    0,
    0.0004255369130987674,
    0.00031177050550468266,
    0.0003015472902916372,
    0.000305869965814054,
    0.03575680032372475,
    0.00030357835930772126,
    0.001743655069731176,
    0.0003253475297242403,
    0.0003235448675695807,
    0.0003122176858596504,
    0.00030139111913740635,
    0.00029760910547338426,
    0.00029853606247343123,
    0.0003019660653080791,
    0.0002968361950479448,
    0.00029713392723351717,
    0.0002978672564495355,
    0.00029704379267059267,
    0.00030296528711915016,
    0.00030643705395050347,
    0.0002997133997268975,
    0.0002979639102704823,
    0.00030709628481417894,
    0.0002968328772112727,
    0.0003721474204212427,
    0.0002969849156215787,
    0.00030083893216215074,
    0.0013766917400062084,
    0.000298104714602232,
    0.00029720639577135444,
    0.0002971910871565342,
    0.00029786056256853044,
    0.0002976258110720664,
    0.00036999848089180887,
    0.00029811731656081975,
    0.00030035560484975576,
    0.0002986361214425415,
    0.0002984187158290297,
    0.0002993220987264067,
    0.00030120654264464974,
    0.0003062886535190046,
    0.00030538946157321334,
    0.0003322760749142617,
    0.00030870188493281603,
    0.00030261429492384195,
    0.00030336136114783585,
    0.00032155681401491165,
    0.00030409678583964705,
    0.0002975402749143541,
    0.0002991425571963191,
    0.0002978632983285934,
    0,
    0.00029991252813488245,
    0.0002997550182044506,
    0.0003025463374797255,
    0.00030638277530670166,
    0.000297897175187245,
    0.00030541146406903863,
    0.0003237805503886193,
    0.00031386123737320304,
    0.00030206487281247973,
    0,
    0.00035178533289581537,
    0.00029709760565310717,
    0.000303092849208042,
    0,
    0.00029854514286853373,
    0.0003083609917666763,
    0.00029837258625775576,
    0.00031858953298069537,
    0.0003309174790047109,
    0.00032358954194933176,
    0.00030284179956652224,
    0.0003148394462186843,
    0.000306289060972631,
    0.0003010015934705734,
    0.00031302255229093134,
    0.00029885960975661874,
    0.00029843076481483877,
    0.00031904628849588335,
    0.00029767004889436066,
    0,
    0.0003003657329827547,
    0.0002973704249598086,
    0.00029921927489340305,
    0.00029704594635404646,
    0.00029715514392592013,
    0.00029673578683286905,
    0.0002974008966702968,
    0.0002970400673802942,
    0.0003026483173016459,
    0.00029759277822449803,
    0.0002986357139889151,
    0.00029718223959207535,
    0.00029927503783255816,
    0.00029726611683145165,
    0.0002992101653944701,
    0.00029757703305222094,
    0.0002982450241688639,
    0.00029901822563260794,
    0.00029676497797481716,
    0.0003025101323146373,
    0.0003004594473168254,
    0.0002969276101794094,
    0.00029972431366331875,
    0.0003008818603120744,
    0.00029954154160805047,
    0.00032566802110522985,
    0.00030037426040507853,
    0,
    0.00029719696613028646,
    0.0002986846666317433,
    0.0003970422549173236,
    0.0003013323585037142,
    0.00031788775231689215,
    0.00030235364101827145,
    0.0002991710207425058,
    0.0003057204303331673,
    0.000321076309774071,
    0.00029814866138622165,
    0.00030384387355297804,
    0.00030234985752031207,
    0.0002979146665893495,
    0.0002974354720208794,
    0.0002984794555231929,
    0.0003095058782491833,
    0.00030168204102665186,
    0,
    0.00029803538927808404,
    0.00029994998476468027,
    0.000313302967697382,
    0.0003016375994775444,
    0.00030540276202373207,
    0.9996356964111328,
    0.0002970336063299328,
    0.00030914059607312083,
    0.00030087013146840036,
    0.00029741073376499116,
    0.00043371174251660705,
    0.00029836606699973345,
    0.0002986264298669994,
    0.00030012070783413947,
    0.0002976018295157701,
    0.0002978469419758767,
    0.0003125923976767808,
    0.00029778829775750637,
    0.0002987563202623278,
    0.00029999599792063236,
    0.0003033627581316978,
    0.0003192234435118735,
    0.0003067486686632037,
    0.00029657542472705245,
    0.00029689876828342676,
    0.00037334076478146017,
    0.00030228550895117223,
    0.0003554194699972868,
    0.0003086159995291382,
    0.0003008415224030614,
    0.00030068669002503157,
    0.00030450097983703017,
    0.000299113686196506,
    0.0002995955874212086,
    0.00031279114773496985,
    0.00030015758238732815,
    0.8238690495491028,
    0.00030051861540414393,
    0.000480876857182011,
    0.00031361536821350455,
    0.0003017508424818516,
    0.0002979184209834784,
    0.0003095584106631577,
    0.0003027413331437856,
    0.0005194664699956775,
    0.00031369595672003925,
    0.0006760549149475992,
    0.00030293726013042033,
    0.0003024135949090123,
    0.000300692452583462,
    0.0003006266779266298,
    0.00029961401014588773,
    0.00032550623291172087,
    0.959879994392395,
    0.00030668338877148926,
    0.0002970210334751755,
    0.00032582817948423326,
    0.000299886945867911,
    0.0002979272685479373,
    0.9972622394561768,
    0.0002975046809297055,
    0.00029896272462792695,
    0.00034196992055512965,
    0.00032096533686853945,
    0.0003342974232509732,
    0.0002976606192532927,
    0.00030017783865332603,
    0.0003096257569268346,
    0.00029826295212842524,
    0.00030170538229867816,
    0.0002971808426082134,
    0.00039894049405120313,
    0.00029760695178993046,
    0.0003294547204859555,
    0.000300015410175547,
    0.00029802692006342113,
    0.0002981455181725323,
    0.00030272791627794504,
    0.0003107708180323243,
    0.00029893446480855346,
    0.9996438026428223,
    0.0003171827120240778,
    0.0003018944407813251,
    0.00029722641920670867,
    0.00030002175481058657,
    0.0002979306154884398,
    0.00029988953610882163,
    0.00029873225139454007,
    0.000300796382362023,
    0.00033419448300264776,
    0.0002993302186951041,
    0.0002973509836010635,
    0.00029781958437524736,
    0.0003010702203027904,
    0.0005231265677139163,
    0.00029733567498624325,
    0.0002966604952234775,
    0.0002972372167278081,
    0.00029671736410818994,
    0.0003001881414093077,
    0.0002971323556266725,
    0.000297170045087114,
    0.00030472924117930233,
    0.00029792668647132814,
    0.0003033387183677405,
    0.0002973018563352525,
    0.00029926374554634094,
    0.0003009725478477776,
    0.00029656014521606266,
    0.0002990338543895632,
    0.00030566001078113914,
    0.0004978907527402043,
    0.0002968642511405051,
    0.00029796845046803355,
    0.00031039767782203853,
    0.0003032094391528517,
    0.00030329020228236914,
    0.00029984634602442384,
    0.00030299590434879065,
    0.0003020856238435954,
    0.0002986309991683811,
    0.0002976439136546105,
    0.0004141527460888028,
    0.00029982731211930513,
    0.00029713334515690804,
    0.0003039183793589473,
    0.0003000233555212617,
    0.00029811987769789994,
    0.00030023971339687705,
    0.00029791309498250484,
    0.0002999255957547575,
    0.00030115002300590277,
    0.00029705872293561697,
    0.00029861973598599434,
    0.00030327794956974685,
    0.0002972276124637574,
    0.0003027263155672699,
    0.0003057979920413345,
    0.0002992135123349726,
    0.00029932745383121073,
    0.0002973820373881608,
    0.0003133338177576661,
    0.00029738497687503695,
    0.0003402496222406626,
    0.0002984717721119523,
    0.00030690518906340003,
    0.00037957075983285904,
    0.000296923506539315,
    0.0002972686488647014,
    0.0003081132599618286,
    0.0004790262319147587,
    0.00029965181602165103,
    0.00029749347595497966,
    0.0002973439113702625,
    0.00029758509481325746,
    0.0002978837874252349,
    0.00029822668875567615,
    0.000940635334700346,
    0.0002975561947096139,
    0.00030166489887051284,
    0.00029720523161813617,
    0.0002982649311888963,
    0.0002995888644363731,
    0.00030050810892134905,
    0.000309580733301118,
    0.0002975809620693326,
    0.0003004794998560101,
    0.0002997049014084041,
    0.00030047650216147304,
    0.00029780936893075705,
    0.00029688916401937604,
    0.00029733721748925745,
    0.0003127277013845742,
    0.0002973541268147528,
    0.0002969870693050325,
    0.0002987034386023879,
    0.0002969492052216083,
    0.0002976842224597931,
    0.0002997233241330832,
    0.000298848346574232,
    0.0003016298287548125,
    0.00030630119726993144,
    0.00029764368082396686,
    0.00029730735695920885,
    0.00030006279121153057,
    0.00029717653524130583,
    0.0002986217150464654,
    0.0002990142966154963,
    0.0002972525544464588,
    0.0003005782200489193,
    0.00029673066455870867,
    0.00030651179258711636,
    0.0002969863126054406,
    0.0003045162884518504,
    0.00030141283059492707,
    0.0002999553398694843,
    0.00029754775459878147,
    0.0002982797159347683,
    0.00030349910957738757,
    0.00029790503322146833,
    0.00029853233718313277,
    0.00029792473651468754,
    0.0002981165307573974,
    0.9995676875114441,
    0.00030700763454660773,
    0.0002995356044266373,
    0.0002979658602271229,
    0,
    0.00030052498914301395,
    0,
    0,
    0,
    0,
    0.00030214074649848044,
    0.0003208478447049856,
    0.00029741524485871196,
    0.0003089380043093115,
    0.00033632508711889386,
    0.0013080372009426355,
    0.0002989510539919138,
    0.00029684483888559043,
    0.0002973912633024156,
    0.00030459213303402066,
    0.00029851103317923844,
    0.0003097757580690086,
    0.0003135465376544744,
    0.9974351525306702,
    0,
    0.001001484808512032,
    0.000305931200273335,
    0.0002976741816382855,
    0.0003042026946786791,
    0.00029754440765827894,
    0.00029676774283871055,
    0.0002970765926875174,
    0.00030696808244101703,
    0.00029794874717481434,
    0.000469366495963186,
    0.0003011163789778948,
    0.00029705598717555404,
    0.0003038157883565873,
    0.00029807674582116306,
    0.000297215417958796,
    0.0003017506387550384,
    0.021239276975393295,
    0.9996566772460938,
    0.00036634530988521874,
    0.00030785787384957075,
    0.00029982574051246047,
    0.00030744393006898463,
    0.000300159357720986,
    0.9982079267501831,
    0.0003238453937228769,
    0.0003576470189727843,
    0.00031781592406332493,
    0.0003028704086318612,
    0.9874995350837708,
    0.00030034707742743194,
    0.0002967018517665565,
    0.00030144170159474015,
    0.00037382583832368255,
    0.0003024989564437419,
    0.00030112871900200844,
    0.00029699865262955427,
    0.9996423721313477,
    0.00029678811552003026,
    0.00031902981572784483,
    0.0003034347319044173,
    0.0002992924128193408,
    0.0003090376267209649,
    0.00029750409885309637,
    0.0003035494592040777,
    0.00029751588590443134,
    0.0003000909637194127,
    0.0002984972088597715,
    0.00029700278537347913,
    0.05461299791932106,
    0.0002995886607095599,
    0.0002974822709802538,
    0.00032015700708143413,
    0.995322048664093,
    0.00029762263875454664,
    0.00037984777009114623,
    0.00029787293169647455,
    0.0002981874567922205,
    0.00030596478609368205,
    0.0006246414268389344,
    0.00030481244903057814,
    0.00029920839006081223,
    0.9989988207817078,
    0.00029670557705685496,
    0.00030233286088332534,
    0.0002994047827087343,
    0.0002980578283313662,
    0.00033025076845660806,
    0.00030565031920559704,
    0.00031343777664005756,
    0.6143912672996521,
    0.00045123533345758915,
    0.0002987731131725013,
    0.0003036901180166751,
    0.0003052048559766263,
    0.00029915914637967944,
    0.00030076238908804953,
    0.00030098407296463847,
    0.0756022036075592,
    0.0002990723878610879,
    0.0004503759846556932,
    0.00032992989872582257,
    0.0003019327705260366,
    0.00031294560176320374,
    0.00030814361525699496,
    0.0003164628869853914,
    0.00030242398497648537,
    0.00030189784592948854,
    0.00029890541918575764,
    0.999370276927948,
    0.0003110876423306763,
    0.0003073443949688226,
    0.00030026750755496323,
    0.00030006596352905035,
    0.0003023472672794014,
    0.9995877146720886,
    0.9987083673477173,
    0.00029964983696117997,
    0.0003019502910319716,
    0.0002978861448355019,
    0.0002970718778669834,
    0.000317154626827687,
    0.00030199720640666783,
    0.0003009260108228773,
    0.6702607274055481,
    0.983501672744751,
    0.0002968748449347913,
    0.00030095703550614417,
    0.00038565535214729607,
    0.0003181473002769053,
    0.000302984903100878,
    0.0003044412296731025,
    0.00029902829555794597,
    0.0011959954863414168,
    0.00032931301393546164,
    0.00029726611683145165,
    0.0009468954522162676,
    0.0002987332409247756,
    0.0002968969929497689,
    0.0003233437309972942,
    0.00030143134063109756,
    0.0003019475261680782,
    0.0002989044296555221,
    0.00030517319100908935,
    0.0004665519518312067,
    0.00040603565867058933,
    0.9614531993865967,
    0.9809327125549316,
    0.0002992694790009409,
    0.00030009986949153244,
    0.0003455143014434725,
    0.00029973816708661616,
    0.0003095025895163417,
    0.00029794086003676057,
    0.9996445178985596,
    0.00029940539388917387,
    0.0002993666275870055,
    0.00031878158915787935,
    0.0006331968470476568,
    0.0002970689383801073,
    0.00029782982892356813,
    0.00029834004817530513,
    0.00029732679831795394,
    0.0003094453422818333,
    0.00029737810837104917,
    0.0003025831247214228,
    0.00030317637720145285,
    0.00031246268190443516,
    0.00030245917150750756,
    0.00029960015672259033,
    0.0002968569751828909,
    0.0003224509418942034,
    0.0002981220604851842,
    0.0002969992347061634,
    0.00029991072369739413,
    0.0003089957754127681,
    0.00030758618959225714,
    0.0003195970202796161,
    0.000299910141620785,
    0.0002998453564941883,
    0.00029820401687175035,
    0.00029757231823168695,
    0.00037093236460350454
  ];