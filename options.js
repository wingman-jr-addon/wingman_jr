function saveOptions() {
    let isDnsBlocking = document.querySelector('input[name="dns_blocking"]:checked').value == "dns_blocking_yes";
    browser.storage.local.set({
      is_dns_blocking: isDnsBlocking
    });
    browser.runtime.sendMessage({ type: 'setDnsBlocking', value: isDnsBlocking });
  }
  
  function restoreOptions() {
    console.log('Restoring saved options');
  
    function setCurrentChoice(rawResult) {
        let result = rawResult.is_dns_blocking;
        console.log('Setting DNS to '+result);
        if(result) {
            document.getElementById('dns_blocking_yes').checked = true;
        } else {
            document.getElementById('dns_blocking_no').checked = true;
        }
        browser.runtime.sendMessage({ type: 'setDnsBlocking', value: result });
    }
  
    function onError(error) {
      console.log(`Error saving: ${error}`);
    }
  
    let getting = browser.storage.local.get("is_dns_blocking");
    getting.then(setCurrentChoice, onError);
  }
  
  document.addEventListener("DOMContentLoaded", restoreOptions);
  var radios = document.forms[0].elements["dns_blocking"];
  for(var i = 0, max = radios.length; i < max; i++) {
      radios[i].onclick = function() {
          saveOptions();
      }
  }