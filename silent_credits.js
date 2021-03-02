document.addEventListener('DOMContentLoaded', function () {
    for(let smi=0; smi<SM_DATA.length; smi++) {
        let d = SM_DATA[smi];
        document.body.insertAdjacentHTML('beforeend',`<a href="${d.credits}" target="_blank"><img src="${d.file}" /></a>`);
    }
});