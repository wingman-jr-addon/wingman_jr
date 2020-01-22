window.onload=function()
{
    let rad = document.getElementById('popupForm').zone;
    for (var i = 0; i < rad.length; i++) {
        rad[i].addEventListener('change', function(e) {
            browser.runtime.sendMessage({ type: 'setZone', zone: e.target.id });
            browser.runtime.sendMessage({ type: 'setZoneAutomatic', isZoneAutomatic: false });
            window.close();
        });
    }
    let sending = browser.runtime.sendMessage({type:'getZone'});
    sending.then(
        function(message)
        {
            console.log('Restoring zone visual state to '+message.zone);
            document.getElementById(message.zone).checked = true;
        },
        function(error)
        {
            console.log('Error getting zone: '+error);
        }
    )
    let autoBox = document.getElementById('popupForm').zoneAuto;
    autoBox.addEventListener('change', function(e) {
        browser.runtime.sendMessage({ type: 'setZoneAutomatic', isZoneAutomatic: e.target.checked });
        window.close();
    });
    let automatic = browser.runtime.sendMessage({type:'getZoneAutomatic'});
    automatic.then(
        function(message)
        {
            console.log('Restoring zone visual state for automatic to '+message.isZoneAutomatic);
            document.getElementById('isZoneAutomatic').checked = message.isZoneAutomatic;
        },
        function(error)
        {
            console.log('Error getting zone automatic: '+error);
        }
    );
}