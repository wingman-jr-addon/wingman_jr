let PROC_processorId = (new URL(document.location)).searchParams.get('id');
const PROC_startupUrl = new URL(document.location);
procWingmanStartup(
    PROC_startupUrl.searchParams.get('backend'),
    PROC_startupUrl.searchParams.get('model')
)
.then(async ()=>
{
    PROC_port = browser.runtime.connect(browser.runtime.id, {name:PROC_processorId});
    PROC_port.onMessage.addListener(procOnPortMessage);
    PROC_port.postMessage({
        type: 'registration',
        tabId: (await browser.tabs.getCurrent()).id,
        processorId: PROC_processorId,
        backend: PROC_loadedBackend,
        model: PROC_activeModelSelection
    });
});
