(() => {
    let lastContextPoint = null;

    const updatePoint = event => {
        lastContextPoint = {
            x: event.clientX,
            y: event.clientY,
        };
    };

    document.addEventListener('contextmenu', updatePoint, true);
    document.addEventListener('pointerdown', event => {
        if (event.button === 2) {
            updatePoint(event);
        }
    }, true);

    if (typeof browser !== 'undefined' && browser.runtime?.onMessage) {
        browser.runtime.onMessage.addListener(message => {
            if (message?.type !== 'wingmanRevealGetContextPoint') {
                return;
            }
            return Promise.resolve(lastContextPoint);
        });
    }
})();
