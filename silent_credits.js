document.addEventListener('DOMContentLoaded', function () {
    for(let smi=0; smi<SM_DATA.length; smi++) {
        let d = SM_DATA[smi];
        let a = document.createElement('a');
        a.href = d.credits;
        a.target = '_blank';
        let img = document.createElement('img');
        img.src = d.file;
        a.appendChild(img);
        document.body.appendChild(a);
    }
});