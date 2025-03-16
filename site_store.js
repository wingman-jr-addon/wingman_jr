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

function ssAddRequestRecord(requestRecord /*user-supplied fields*/ ) {

}

