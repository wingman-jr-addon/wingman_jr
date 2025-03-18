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
    let scaleFactor = 2.5 + 8.0 / Math.pow(scores.length, 1.5); //Scale to a reasonable sigma at infinity
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
    //Create collage
    /*
    let imageSize = 128;
    let imagesPerRow = 7;
    for(let i=0; i<entriesByLevels.length; i++) {
        let logCanvas = document.createElement('canvas');
        logCanvas.width = imageSize*5;
        logCanvas.height = imageSize;
        let logCtx = logCanvas.getContext('2d', { alpha: false});
        let entry = entriesByLevels[i];
        console.warn('Entry '+i+' has '+entry.recordIndices.length+' image entries');
        let y = 0;
        let x = 0;
        for(let j=0; j<entry.recordIndices.length && j<imagesPerRow; j++ ) {
            let record = ssAllRecords[entry.recordIndices[j]];
            let url = null;
            let didAvance = false;
            try {
                let blob = new Blob([record.imageBytes], {type: 'image/*'});
                url = URL.createObjectURL(blob);
                let img = await ssLoadImagePromise(url);
                let maxSide = Math.max(img.width, img.height);
                let ratio = imageSize/maxSide;
                let newWidth = img.width*ratio;
                let newHeight = img.height*ratio;
                logCtx.clearRect(x,y,imageSize,imageSize);
                logCtx.drawImage(img, x, y, newWidth, newHeight);
                console.warn('Drew at '+y+','+x+' - advancing');
                x += imageSize;
                didAvance = true;
            } catch(ex) {
                console.error(ex);
            }
            if(url != null) {
                URL.revokeObjectURL(url);
            }

            //Try forcing svg
            if(!didAvance) {
                console.warn('Fallback to svg attempt...');
                url = null;
                try {
                    let blob = new Blob([record.imageBytes], {type: 'image/svg+xml'});
                    url = URL.createObjectURL(blob);
                    let img = await ssLoadImagePromise(url);
                    let maxSide = Math.max(img.width, img.height);
                    let ratio = imageSize/maxSide;
                    let newWidth = img.width*ratio;
                    let newHeight = img.height*ratio;
                    logCtx.clearRect(x,y,imageSize,imageSize);
                    logCtx.drawImage(img, x, y, newWidth, newHeight);
                    console.warn('Drew at '+y+','+x+' - advancing');
                    x += imageSize;
                } catch(ex) {
                    console.error(ex);
                }
                if(url != null) {
                    URL.revokeObjectURL(url);
                }
            }
        }
        let logDataUrl = logCanvas.toDataURL('image/jpeg', 0.7);
        let blockedCSS = 'color: #00FF00; display: inline-block; font-size: 0; ' +
            'width: '+(logCanvas.width+10) + 'px; '+
            'height: '+(logCanvas.height+10) + 'px; background-image: url('+logDataUrl+'); background-size: cover; background-repeat: no-repeat;';
        console.warn('%c '+'Score '+(i*divider), blockedCSS);


    }
    */
    let html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"/></head>
    <body><table>`;
    let imageSize = 128;
    let imagesPerRow = 30;
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

