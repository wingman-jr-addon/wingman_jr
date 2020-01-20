window.onload=function()
{
    let rad = document.getElementById('popupForm').zone;
    for (var i = 0; i < rad.length; i++) {
        rad[i].addEventListener('change', function(e) {
            browser.runtime.sendMessage({ type: 'setZone', zone: e.target.id });
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
}