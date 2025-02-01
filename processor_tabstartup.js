let PROC_processorId = (new URL(document.location)).searchParams.get('id');
procWingmanStartup((new URL(document.location)).searchParams.get('backend'))
.then(async ()=>
{
    PROC_port = browser.runtime.connect(browser.runtime.id, {name:PROC_processorId});
    PROC_port.onMessage.addListener(procOnPortMessage);
    PROC_port.postMessage({
        type: 'registration',
        tabId: (await browser.tabs.getCurrent()).id,
        processorId: PROC_processorId,
        backend: PROC_loadedBackend
    });
});