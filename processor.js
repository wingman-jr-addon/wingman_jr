const PROC_MODEL_PATH = 'sqrxr_112_graphopt/model.json'
const PROC_IMAGE_SIZE = 224;

function procOnModelLoadProgress(percentage) {
    console.log('LIFECYCLE: Model load '+Math.round(percentage*100)+'% at '+performance.now());
}

let PROC_isInReviewMode = false;
let PROC_wingman;
let PROC_loadedBackend;
const procWingmanStartup = async () => {
    console.log('LIFECYCLE: Launching TF.js!');
    let params = (new URL(document.location)).searchParams;
    let backendRequested = params.get('backend');
    console.log('LIFECYCLE: Backend requested '+backendRequested);
    if(backendRequested != 'default') {
        tf.setBackend(backendRequested || 'wasm');
    }

    /* !!!!!!! Enable the line below to make the performance issue go away !!!!!!!!! */
    //tf.env().set('WEBGL_PACK_DEPTHWISECONV', false);
    /* !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!! */

    console.log(tf.env().getFlags());
    tf.enableProdMode();
    await tf.ready();
    PROC_loadedBackend = tf.getBackend();
    console.log('LIFECYCLE: TensorflowJS backend is: '+PROC_loadedBackend);
    if(PROC_loadedBackend == 'cpu') {
        console.log('LIFECYCLE: WARNING! Exiting because no fast predictor can be loaded!');
        PROC_wingman = null;
        return;
    }
    console.log('LIFECYCLE: Loading model...');
    PROC_wingman = await tf.loadGraphModel(PROC_MODEL_PATH, { onProgress: procOnModelLoadProgress });
    console.log('LIFECYCLE: Model loaded: ' + PROC_wingman+' at '+performance.now());

    console.log('LIFECYCLE: Warming up...');
    let dummy_data = tf.zeros([1, PROC_IMAGE_SIZE, PROC_IMAGE_SIZE, 3]);
    let warmup_result = null;
    let timingInfo = await tf.time(()=>warmup_result = PROC_wingman.predict(dummy_data));
    console.log(warmup_result);
    console.log('LIFECYCLE: TIMING LOADING: '+JSON.stringify(timingInfo));
    warmup_result[0].dispose();
    warmup_result[1].dispose();
    console.log('LIFECYCLE: Ready to go at '+performance.now()+'!');
};

procWingmanStartup()
.then(async ()=>
{
    console.log('ALL MODEL LOADING COMPLETE!');
});