let PROC_processorId = 'inprocwebgl';
function bkTryStartupBackgroundJsProcessor() {
    // In Firefox 83, background.js Tensorflow.js inference fell back to CPU for
    // many users, essentially making the browsing experience unusuable. The addon
    // was rewritten in a client/server architecture to allow for a hidden tab to
    // use a "normal" environment to spawn the WebGL context.
    // However, the hidden tab has been the #2/#3 reason why users are leaving
    // according to the addon's exit survey.
    // This code is an attempt to create an "in proc" client as an attempt to
    // dodge the need for a hidden tab when possible so users don't get angry.
    //
    // First, perform similar detection to what Tensorflow.js will do
    // and only proceed if detection succeeds. Otherwise, Tensorflow.js
    // will fail and the hidden tab approach must be used instead
    console.log('INPROC: Performing Tensorflow.js WebGL check for background.js...');
    let inferenceCanvas = document.createElement('canvas');
    let inferenceCtx = inferenceCanvas.getContext('webgl2',
    {
        alpha: false,
        antialias: false,
        premultipliedAlpha: false,
        preserveDrawingBuffer: false,
        depth: false,
        stencil: false,
        failIfMajorPerformanceCaveat: true
    });
    if(!inferenceCtx) {
        console.log('INPROC: Tensorflow.js WebGL check for background.js failed, falling back to hidden tab.');
        return null;
    }
    
    let inferenceCtxType = `${inferenceCtx}`;
    console.log(`INPROC: Tensorflow.js WebGL check for background.js succeeded, continuing in-process! (${inferenceCtxType})`);
    delete inferenceCtx;
    delete inferenceCanvas;
    //Initialize and fake out a port pair for processor and background
    procWingmanStartup('webgl')
    .then(async ()=>
    {
        let backgroundPort = null;
        let listenersBackgroundSide = [];
        let listenersProcessorSide = [];
        PROC_port = {
            name: PROC_processorId,
            postMessage: function(m) {
                WJR_DEBUG && console.debug('INPROC: postMessage (proc side) '+m.type);
                listenersBackgroundSide.forEach(lb => {
                    try { lb(m); } catch { }
                })
            },
            onMessage: {
                addListener: function(listenerFunction) {
                    WJR_DEBUG && console.log('INPROC: Adding new listener to fake port (proc side)');
                    listenersProcessorSide.push(listenerFunction);
                }
            },
            destroy: function() {
                listenersProcessorSide.length = 0;
            }
        };
        
        backgroundPort = {
            name: PROC_processorId,
            postMessage: function(m) {
                WJR_DEBUG && console.debug('INPROC: postMessage (background side)'+m.type);
                listenersProcessorSide.forEach(lp => {
                    try { lp(m); } catch { }
                });
            },
            onMessage: {
                addListener: function(listenerFunction) {
                    WJR_DEBUG && console.log('INPROC: Adding new listener to fake port (background side)');
                    listenersBackgroundSide.push(listenerFunction);
                }
            },
            destroy: function() {
                listenersBackgroundSide.length = 0;
            }
        };
        PROC_port.onMessage.addListener(procOnPortMessage);
        bkOnClientConnected(backgroundPort);
        PROC_port.postMessage({
            type: 'registration',
            tabId: 'fake',
            processorId: PROC_processorId,
            backend: PROC_loadedBackend
        });
    });
    return inferenceCtxType;
}