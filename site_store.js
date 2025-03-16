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
        storeDate: new Date(),
        key: ssAllRecords.length
    };
    ssAllRecords.push(copy);
    console.info('SO: record '+JSON.stringify(copy));
}

// Give an array of [0,1] elements, and this will create a normalized histogram in Unicode
function ssCreateHistogram(arr, startBin=1) {
    let bins = [];
    let binCount = 50;
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
        histogram += String.fromCodePoint(0x2581+binHeight);
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
    let histogram = ssCreateHistogram(scores);
    return histogram;
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
        let histogram = ssCreateHistogram(value.scores);
        fullReport += histogram+' '+key + '\r\n';
    }
    return fullReport;
}


